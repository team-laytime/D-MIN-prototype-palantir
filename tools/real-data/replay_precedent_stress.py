"""Check stale work buffers and replay a precedent pilot with the team engine."""

import argparse
import csv
import hashlib
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

KST = timezone(timedelta(hours=9))


def local_time(value):
    return datetime.fromisoformat(value).astimezone(KST).replace(tzinfo=None)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def csv_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def check_buffers(snapshot, bundle, planned_ids):
    from berth_prep.rates import rate_rows, read_past
    from berth_sim.data_files import ship_id

    current = {row["vessel_id"]: row for row in csv_rows(bundle / "dummy/current_shipments.csv")}
    past = read_past(bundle / "dummy/past_shipments.csv")
    request_vessels = {
        ship_id({
            "callsgn": row["call_sign"], "ptentVtsYr": row["entry_year"],
            "vyg": row["voyage"], "stay_seq": row.get("stay_seq") or "",
        }): row
        for row in snapshot["candidates"][0]["request"]["vessels"]
    }
    start = local_time(snapshot["as_of"])
    recomputed_rates = {}
    checked = []
    for row in csv_rows(bundle / "buffer/work_buffer.csv"):
        vessel = current[row["vessel_id"]]
        vessel_id = ship_id(vessel)
        before, after = float(row["qty"]), float(vessel["qty"])
        if vessel_id not in planned_ids or abs(before - after) <= 0.5:
            continue
        berth = row["berth"]
        request = request_vessels[vessel_id]
        if not math.isclose(after, request["qty"], abs_tol=0.001):
            raise ValueError(f"{vessel_id}: corrected bundle quantity does not match the snapshot")
        if vessel_id not in recomputed_rates:
            recomputed_rates[vessel_id] = {
                rate["berth"]: rate for rate in rate_rows([vessel], past, start)
            }
        rate_row = recomputed_rates[vessel_id].get(berth)
        if rate_row is None:
            raise ValueError(f"{vessel_id} {berth}: missing current rate; cannot reproduce buffer")
        rate = rate_row["rate_t_per_h"]
        if not math.isclose(rate, request["rate_t_per_h"][berth], abs_tol=0.001):
            raise ValueError(f"{vessel_id} {berth}: rate differs from the snapshot")
        expected = after / rate
        lower, upper = float(row["min_h"]), float(row["cap_h"])
        raw = expected * (float(row["multiplier"]) - 1) if row["multiplier"] else lower
        buffer = round(min(upper, max(lower, raw)), 2)
        stored = float(row["work_buffer_h"])
        if not math.isclose(stored, request["work_buffer_h"][berth], abs_tol=0.001):
            raise ValueError(f"{vessel_id} {berth}: original buffer differs from the snapshot")
        checked.append({
            "vessel_id": vessel_id, "berth": berth, "original_quantity_t": before,
            "corrected_quantity_t": after, "rate_t_per_h": rate, "rate_basis": rate_row["basis"],
            "rate_samples": rate_row["samples"], "expected_work_h": round(expected, 4),
            "minimum_buffer_h": lower, "maximum_buffer_h": upper,
            "stored_buffer_h": stored, "recalculated_buffer_h": buffer,
            "changed": not math.isclose(stored, buffer, abs_tol=0.001),
        })
    return checked


def replay_policy(snapshot, policy_source, plans, disruptions):
    from berth_sim.api.schemas import PlanRequest
    from berth_sim.api.service import blocks_from, dataset_from_request, fixes_from, requirements_from
    from berth_sim.after_etb.s12_demurrage_fee import fee_cents
    from berth_sim.params import from_dict, using
    from berth_sim.plan_run import load_context
    from berth_sim.risk import Disruption, execute

    candidate = next(x for x in snapshot["candidates"] if x["slot"] == policy_source)
    request = PlanRequest.model_validate(snapshot["candidates"][0]["request"])
    policy = from_dict(candidate["response"]["params"], source=f"Common policy from {policy_source}")
    with using(policy):
        ctx = load_context(
            dataset_from_request(request), blocks_from(request),
            [(t.start.astimezone(KST).replace(tzinfo=None), t.end.astimezone(KST).replace(tzinfo=None))
             for t in request.typhoons],
            start=local_time(snapshot["as_of"]), fixes=fixes_from(request),
            requirements=requirements_from(request),
        )

        def outcomes_for(plan, event=()):
            result = execute(ctx, plan, event)
            outcomes = result.by_id()
            if outcomes.keys() != plan.keys() or any(not o.berthable or o.after is None for o in outcomes.values()):
                raise ValueError("Fixed-plan replay returned an incomplete or infeasible outcome")
            return outcomes

        rows = []
        for slot, plan in plans.items():
            before = outcomes_for(plan)
            before_fees = {v: fee_cents(row.fee) for v, row in before.items()}
            before_total = sum(before_fees.values())
            for scenario, vessel, late, slow in disruptions:
                after = outcomes_for(plan, (Disruption(vessel, timedelta(hours=late), slow),))
                changes = [
                    {"vessel_id": v, "berth": row.vessel.berth,
                     "etb_delay_minutes": round((row.etb - before[v].etb).total_seconds() / 60, 2),
                     "fee_change_cents": fee_cents(row.fee) - before_fees[v]}
                    for v, row in after.items()
                ]
                own = next(change for change in changes if change["vessel_id"] == vessel)
                others = [change for change in changes if change["vessel_id"] != vessel]
                delayed = [change for change in others if change["etb_delay_minutes"] > 0]
                delta = sum(change["fee_change_cents"] for change in changes)
                rows.append({
                    "slot": slot, "scenario": scenario, "vessel_id": vessel,
                    "eta_delay_h": late, "work_slow_factor": slow,
                    "undisrupted_replay_cents": before_total,
                    "disrupted_replay_cents": before_total + delta,
                    "incremental_fee_cents": delta,
                    "direct_effect": own,
                    "other_fee_change_cents": sum(change["fee_change_cents"] for change in others),
                    "other_etb_delayed_count": len(delayed),
                    "other_etb_total_delay_minutes": round(sum(change["etb_delay_minutes"] for change in delayed), 2),
                    "other_etb_max_delay_minutes": max((change["etb_delay_minutes"] for change in delayed), default=0),
                    "other_changes": [change for change in others
                                      if change["etb_delay_minutes"] or change["fee_change_cents"]],
                })
        return {"source_slot": policy_source, "weather_thresholds_ms": policy.weather.thresholds_ms, "rows": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", type=Path, required=True, help="Pinned optimization checkout")
    parser.add_argument("--bundle", type=Path, required=True, help="Tank-adjusted replay bundle")
    parser.add_argument("--snapshot", type=Path, required=True, help="Pilot candidate snapshot JSON")
    parser.add_argument("--output", type=Path, required=True, help="Output stress results JSON")
    args = parser.parse_args()
    if args.output.resolve() == args.snapshot.resolve():
        parser.error("--output must be separate from --snapshot")
    sys.path.insert(0, str(args.engine.resolve()))

    from berth_sim.api.service import ENGINE_VERSION

    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    candidates = snapshot["candidates"]
    if [x["slot"] for x in candidates] != list("ABC") or any(
        c["response"]["engine"]["version"] != ENGINE_VERSION for c in candidates
    ):
        raise ValueError("Expected A/B/C candidates produced by the supplied engine revision")
    plans = {
        c["slot"]: {v["vessel_id"]: (v["berth"], local_time(v["etb"])) for v in c["response"]["plan"]["vessels"]}
        for c in candidates
    }
    if any(plans[k].keys() != plans["A"].keys() for k in plans):
        raise ValueError("Candidate vessel sets differ")
    gap = next(r for r in candidates[0]["risks"]["risks"] if r["kind"] == "WORK_GAP" and r["berth"] == "7")
    chain = gap["vessel_ids"]
    first, second = chain[:2]
    checked = check_buffers(snapshot, args.bundle, set(plans["A"]))
    events = [(f"eta_plus_6_chain_{i}", vessel, 6, 1.0) for i, vessel in enumerate(chain, 1)]
    events += [
        ("work_plus_30_chain_1", first, 0, 1.3),
        ("work_plus_30_chain_2", second, 0, 1.3),
    ]
    report = {
        "case_id": snapshot["case_id"], "snapshot_sha256": sha256(args.snapshot),
        "engine_version": ENGINE_VERSION,
        "buffer_status": "replan_required" if any(row["changed"] for row in checked) else "no_buffer_change",
        "buffer_rows": checked, "chain": chain, "chain_evidence_id": gap["id"],
        "scenario_assumptions": [
            "Each event is applied separately to the same vessel in each fixed plan.",
            "All candidates use one common weather operating policy within each comparison.",
            "Work-slow replay scales effective cargo in the engine; inventory impacts are not assessed.",
            "Recorded weather observations and assumed contract inputs are inherited from the snapshot.",
        ],
        "policies": [],
    }
    for slot in ("A", "B"):
        print(f"Replaying under common weather policy {slot}", flush=True)
        report["policies"].append(replay_policy(snapshot, slot, plans, events))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            json.dump(report, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            temporary.replace(args.output)
        finally:
            temporary.unlink(missing_ok=True)
    print(args.output, flush=True)


if __name__ == "__main__":
    main()
