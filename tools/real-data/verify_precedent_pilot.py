"""Cross-check a pilot decision against fixed-plan replay rather than a second reviewer."""

import argparse
import json
from collections import Counter, defaultdict
from hashlib import sha256
from pathlib import Path


def verify(snapshot_path, replay_path, judgment_path):
    raw = snapshot_path.read_bytes()
    checksum = sha256(raw).hexdigest()
    snapshot = json.loads(raw)
    replay = json.loads(replay_path.read_text())
    candidates = {c['slot']: c for c in snapshot['candidates']}
    if (set(candidates) != set('ABC') or replay['snapshot_sha256'] != checksum
            or replay['case_id'] != snapshot['case_id']):
        raise ValueError('Expected an A/B/C snapshot with a matching replay')

    cohorts = []
    for candidate in candidates.values():
        response = candidate['response']
        plan = response['plan']
        if (response['engine']['version'] != replay['engine_version'] or response['dropped']
                or plan['tank_violation'] or plan['requirements']):
            raise ValueError('Expected complete comparable plans for this pilot')
        cohorts.append({v['vessel_id'] for v in plan['vessels']})
    if not all(cohort == cohorts[0] for cohort in cohorts):
        raise ValueError('Candidate vessel sets differ')

    comparisons = []
    disturbances = {}
    for policy in replay['policies']:
        policy_slot = policy['source_slot']
        if policy['weather_thresholds_ms'] != candidates[policy_slot]['response']['params']['weather']['thresholds_ms']:
            raise ValueError('Replay weather policy does not match the snapshot')
        by_event = defaultdict(dict)
        for row in policy['rows']:
            alternatives = by_event[row['scenario']]
            if row['slot'] in alternatives:
                raise ValueError('Duplicate scenario and candidate')
            alternatives[row['slot']] = row
        for event, rows in by_event.items():
            observed = {(row['vessel_id'], row['eta_delay_h'], row['work_slow_factor']) for row in rows.values()}
            if set(rows) != set(candidates) or len(observed) != 1:
                raise ValueError('Expected the same disturbance in all three plans')
            if disturbances.setdefault(event, observed) != observed:
                raise ValueError('Disturbance changes between weather policies')
            totals = {slot: row['disrupted_replay_cents'] for slot, row in rows.items()}
            best = min(totals.values())
            winners = sorted(slot for slot, total in totals.items() if total == best)
            comparisons.append({
                'policy_source_slot': policy_slot, 'scenario': event,
                'total_cents': totals, 'minimum_cost_slots': winners,
                'subsequent_delayed_berthings': {slot: row['other_etb_delayed_count'] for slot, row in rows.items()},
            })
    wins = Counter(result['minimum_cost_slots'][0] for result in comparisons if len(result['minimum_cost_slots']) == 1)
    tested = {result['scenario'] for result in comparisons}
    if len(comparisons) != 12 or len(tested) != 6 or {p['source_slot'] for p in replay['policies']} != {'A', 'B'}:
        raise ValueError('Pilot requires six disturbances under both common policies')

    judgment = next(item for item in json.loads(judgment_path.read_text())['reviews']
                    if item['case_id'] == snapshot['case_id'])
    selection = judgment['selected_candidate']
    selected = selection['slot'] if selection else None
    consistent = (judgment['snapshot_sha256'] == checksum and wins.get(selected, 0) == len(comparisons)
                  and candidates[selected]['schedule_id'] == selection['schedule_id'])

    return {
        'case_id': snapshot['case_id'], 'snapshot_sha256': checksum,
        'replay_sha256': sha256(replay_path.read_bytes()).hexdigest(),
        'comparison_count': len(comparisons), 'unique_minimum_cost_counts': wins,
        'agrees_with_simulated_selection': consistent, 'comparisons': comparisons,
        'scope': 'Independent numerical check of selected fixed scenarios. Dispatch impact and authorization were unconfirmed.',
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('replay', type=Path)
    parser.add_argument('judgments', type=Path)
    args = parser.parse_args()
    audit = verify(args.snapshot, args.replay, args.judgments)
    print(json.dumps(audit, ensure_ascii=False, indent=2))
    raise SystemExit(0 if audit['agrees_with_simulated_selection'] else 1)
