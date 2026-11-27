"""Build a case index from saved 72-hour precedent snapshots."""

import argparse
from collections import Counter
from datetime import date, datetime, timedelta
from hashlib import sha256
import json
from os.path import commonpath, relpath
from pathlib import Path


DEMO_STARTS = [datetime.fromisoformat(f'2025-{date}T09:00:00+09:00')
               for date in ('03-01', '03-10', '10-15', '11-09')]
HORIZON = timedelta(days=3)


def candidate_summary(candidate):
    response = candidate.get('response', {})
    plan = response.get('plan')
    risk_response = candidate.get('risks') or {}
    risks = risk_response.get('risks', [])
    evidence = {}
    for risk in risks:
        kind = risk['kind']
        if kind == 'TANK':
            kind = f"TANK_{risk['evidence']['side']}"
        evidence.setdefault(kind, []).append(risk['id'])
    return {
        'slot': candidate['slot'],
        'preset': (candidate.get('preset') or {}).get('id'),
        'status': response.get('status', candidate['status']),
        'engine_version': (response.get('engine') or {}).get('version'),
        'risk_version': (risk_response.get('model') or {}).get('version'),
        'schedule_id': candidate.get('schedule_id'),
        'placement_id': candidate.get('placement_id'),
        'expected_demurrage_cents': plan['total_cents'] if plan else None,
        'bound_cents': plan['bound_cents'] if plan else None,
        'unnecessary_waits': plan['waits'] if plan else None,
        'planned_operations': len(plan['vessels']) if plan else None,
        'dropped_operations': len(response['dropped']) if 'dropped' in response else None,
        'tank_violation': plan['tank_violation'] if plan else None,
        'requirements': plan['requirements'] if plan else None,
        'risk_counts': risk_response.get('counts'),
        'risk_evidence_ids': evidence,
    }


def read_case(path):
    raw = path.read_bytes()
    data = json.loads(raw)
    start = datetime.fromisoformat(data['as_of'])
    nominal_end = datetime.fromisoformat(data['nominal_window_end'])
    if nominal_end - start != HORIZON or data['search_eligible']:
        raise ValueError(f'{path.name}: expected a 72-hour unreviewed snapshot')
    candidates = data['candidates']
    if data['status'] == 'candidate_snapshot_ready' and [c['slot'] for c in candidates] != list('ABC'):
        raise ValueError(f'{path.name}: three slots are required for a complete snapshot')
    end = nominal_end
    for candidate in [*candidates, *([data['control']] if 'control' in data else [])]:
        if 'request' in candidate:
            request = candidate['request']
            if datetime.fromisoformat(request['start']) != start or request['params']['horizon']['days'] != 3:
                raise ValueError(f'{path.name}: candidate request window mismatch')
        window = candidate.get('response', {}).get('window')
        if window:
            if datetime.fromisoformat(window['start']) != start:
                raise ValueError(f'{path.name}: solver window start mismatch')
            end = max(end, datetime.fromisoformat(window['end']))
    overlaps_demo = any(start < demo + HORIZON and demo < end for demo in DEMO_STARTS)
    if overlaps_demo != (data['status'] == 'excluded_demo_overlap'):
        raise ValueError(f'{path.name}: demo overlap status mismatch')
    prep = data.get('prep') or {}
    voyage_ids = {vid.rsplit('-', 1)[0] for vid in prep.get('planned_vessel_ids', prep.get('pilot_vessel_ids', []))}
    placement_ids = {c['placement_id'] for c in candidates if c.get('placement_id')}
    displayed_ids = {c['schedule_id'] for c in data.get('displayed') or []}
    item = {
        'case_id': data['case_id'],
        'snapshot': path.name,
        'snapshot_sha256': sha256(raw).hexdigest(),
        'input_dataset_sha256': data['sources']['input_dataset_sha256'],
        'as_of': start.isoformat(),
        'nominal_window_end': nominal_end.isoformat(),
        'solver_window_end': end.isoformat(),
        'collection_status': data['status'],
        'calculation_mode': data.get('calculation_mode', 'prototype_defaults'),
        'search_eligible': False,
        'judgment_count': len(data['human_judgments']),
        'rate_model_version': prep.get('version'),
        'used_past_shipments': prep.get('used_past_shipments'),
        'excluded_later_shipments': prep.get('excluded_after_start'),
        'distinct_calculated_placements': len(placement_ids) if placement_ids else None,
        'distinct_displayed_schedules': len(displayed_ids) if displayed_ids else None,
        'candidates': [candidate_summary(candidate) for candidate in candidates],
    }
    if 'simulated_constraint' in data:
        item['simulated_constraint_type'] = data['simulated_constraint']['type']
    return item, start, end, voyage_ids


def assign_groups(cases):
    groups = []
    for index, (_, start, end, voyages) in enumerate(cases):
        matches = [group for group in groups if any(
            (start < cases[member][2] and cases[member][1] < end) or voyages & cases[member][3]
            for member in group
        )]
        merged = {index}
        for group in matches:
            merged.update(group)
            groups.remove(group)
        groups.append(merged)
    for group in groups:
        first = min(group)
        group_id = cases[first][0]['case_id']
        for index in group:
            cases[index][0]['case_group_id'] = group_id


def attach_judgments(records, paths, base):
    by_id = {record['case_id']: record for record in records}
    for path in paths:
        data = json.loads(path.read_text())
        for review in data['reviews']:
            record = by_id.get(review['case_id'])
            if record is None or review['snapshot_sha256'] != record['snapshot_sha256']:
                raise ValueError(f"Judgment has no matching snapshot: {review['case_id']}")
            if 'simulated_judgment' in record or review['judgment_source'] != 'ai_simulated_scheduler_review':
                raise ValueError(f"Expected one AI simulated judgment: {review['case_id']}")
            record['simulated_judgment'] = {
                'file': relpath(path.resolve(), base), 'source': review['judgment_source'],
                'decision': review['decision'], 'selected_candidate': review['selected_candidate'],
            }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sources', type=Path, nargs='+', help='Snapshot directories or individual snapshot files')
    parser.add_argument('--evaluation-day', type=date.fromisoformat, action='append', default=[],
                        help='Reserve the entire case group for evaluation')
    parser.add_argument('--judgments', type=Path, action='append', default=[], help='Link an AI judgment dataset')
    args = parser.parse_args()
    paths = []
    for source in args.sources:
        if not source.exists():
            parser.error(f'Snapshot source does not exist: {source}')
        files = sorted(source.glob('2025-??-??.json')) if source.is_dir() else [source]
        if not files:
            parser.error(f'No dated case snapshots found in {source}')
        paths.extend(path.resolve() for path in files)
    base = Path(commonpath([path.parent for path in paths]))
    cases = []
    for path in paths:
        case = read_case(path)
        case[0]['snapshot'] = relpath(path, base)
        cases.append(case)
    cases.sort(key=lambda case: case[1])
    assign_groups(cases)
    records = [case[0] for case in cases]
    if len({record['case_id'] for record in records}) != len(records):
        parser.error('Case IDs must be unique')
    attach_judgments(records, args.judgments, base)
    if args.evaluation_day:
        by_day = {start.date(): item for item, start, _, _ in cases}
        if not set(args.evaluation_day) <= by_day.keys():
            parser.error('An evaluation day has no snapshot')
        evaluation_groups = {by_day[day]['case_group_id'] for day in args.evaluation_day}
        for record in records:
            if record['collection_status'] == 'excluded_demo_overlap':
                partition = 'excluded_demo'
            else:
                partition = 'evaluation' if record['case_group_id'] in evaluation_groups else 'development'
            record['partition'] = partition
    result = {'counts_by_status': Counter(record['collection_status'] for record in records), 'cases': records}
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
