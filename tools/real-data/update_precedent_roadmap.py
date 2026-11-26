"""Update the precedent-agent Markdown checklist from local evidence."""

import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROADMAP = ROOT / "docs/precedent-agent-roadmap.md"
DATA_DOC = ROOT / "docs/precedent-agent-data.md"
FIXTURE = ROOT / "docs/fixtures/precedent-agent-synthetic.json"
TASK = re.compile(r"^(- \[)([ x])(\] \*\*(R\d{2})\*\* .*)$", re.MULTILINE)
EVIDENCE_PREFIX = " 완료 근거 [파일]("


def synthetic_snapshot_ready():
    if not FIXTURE.is_file():
        return False
    try:
        snapshot = json.loads(FIXTURE.read_text(encoding="utf-8"))
        cases = snapshot["cases"]
        if not cases or not snapshot["engine_revision"]:
            return False
        return all(
            case["provenance"] == "synthetic_fixture"
            and case["judgment"] is None
            and case["operational_outcome"] is None
            and {candidate["slot"] for candidate in case["candidates"]} == {"A", "B", "C"}
            and len(case["candidates"]) == 3
            and all(
                candidate["status"] == 200
                and candidate["response"]["plan"] is not None
                and candidate["schedule_id"]
                and candidate["request_sha256"]
                and candidate["risks"] is not None
                for candidate in case["candidates"]
            )
            for case in cases
        )
    except (KeyError, TypeError, ValueError):
        return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--check", action="store_true", help="Fail if automatic statuses are out of date")
    actions.add_argument("--complete", nargs=2, metavar=("TASK", "EVIDENCE"), help="Record completion after review")
    args = parser.parse_args()

    original = ROADMAP.read_text(encoding="utf-8")
    automatic = {
        "R01": (DATA_DOC.is_file() and DATA_DOC.stat().st_size > 0, DATA_DOC),
        "R02": (synthetic_snapshot_ready(), FIXTURE),
    }
    manual_id, evidence = None, None
    if args.complete:
        manual_id, value = args.complete
        if manual_id in automatic:
            parser.error(f"{manual_id} is updated from its automatic check")
        if manual_id not in {match[3] for match in TASK.findall(original)}:
            parser.error(f"Unknown roadmap task: {manual_id}")
        evidence = (ROOT / value).resolve()
        if not evidence.is_relative_to(ROOT) or not evidence.is_file() or evidence.stat().st_size == 0:
            parser.error("Evidence must be a nonempty file inside this repository")

    def sync_task(match):
        prefix, checked, text, task_id = match.groups()
        if task_id in automatic:
            complete, task_evidence = automatic[task_id]
        elif task_id == manual_id:
            complete, task_evidence = True, evidence
        else:
            return match.group()
        text = text.partition(EVIDENCE_PREFIX)[0]
        if complete:
            link = os.path.relpath(task_evidence, ROADMAP.parent)
            text += f"{EVIDENCE_PREFIX}<{link}>)"
        return prefix + ("x" if complete else " ") + text

    updated = TASK.sub(sync_task, original)
    if args.check:
        if original != updated:
            parser.exit(1, "Roadmap statuses are out of date. Run without --check.\n")
        print("Roadmap statuses match available evidence.")
    elif original != updated:
        ROADMAP.write_text(updated, encoding="utf-8")
        print("Updated roadmap checklist.")
    else:
        print("Roadmap checklist is up to date.")


if __name__ == "__main__":
    main()
