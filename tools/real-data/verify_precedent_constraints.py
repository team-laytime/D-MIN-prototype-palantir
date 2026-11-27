"""Audit controlled solver replays for the added precedent case types."""

import argparse
from collections import Counter
from datetime import datetime
from hashlib import sha256
import json
from pathlib import Path

from summarize_precedent_round import read_case


def dt(value):
    return datetime.fromisoformat(value)


def compare_operations(control, plan):
    before = {op['vessel_id']: op for op in control['vessels']}
    after = {op['vessel_id']: op for op in plan['vessels']}
    shared = before.keys() & after.keys()
    later = {key: int((dt(after[key]['etb']) - dt(before[key]['etb'])).total_seconds() / 60)
             for key in shared if dt(after[key]['etb']) > dt(before[key]['etb'])}
    return {
        'same_vessel_set': before.keys() == after.keys(),
        'changed_berths': sum(before[key]['berth'] != after[key]['berth'] for key in shared),
        'later_operations': len(later),
        'max_delay_min': max(later.values(), default=0),
    }


def score_constraint(kind, rule, request, plan):
    if kind == 'equipment':
        block, = [block for block in request['blocks'] if block['kind'] == rule['kind']]
        if (block['berths'] != rule['berths'] or dt(block['start']) != dt(rule['start'])
                or dt(block['end']) != dt(rule['end'])):
            raise ValueError('Equipment outage differs from the engine request')
        violations = [op['vessel_id'] for op in plan['vessels'] if op['berth'] in block['berths']
                      and dt(block['start']) <= dt(op['etb']) < dt(block['end'])]
        return {'met': not violations, 'starts_inside_outage': len(violations)}
    if kind == 'fixed_berth':
        fix, = [item for item in request['fixes'] if item['vessel_id'] == rule['vessel_id']]
        if fix['berth'] != rule['berth'] or dt(fix['etb']) != dt(rule['etb']):
            raise ValueError('Fixed berth or ETB differs from the engine request')
        planned = next((op for op in plan['vessels'] if op['vessel_id'] == fix['vessel_id']), None)
        return {'met': bool(planned and planned['berth'] == fix['berth'] and planned['fixed']
                            and dt(planned['etb']) == dt(fix['etb']))}

    if kind != 'urgent_export' or rule not in request['requirements']:
        raise ValueError('Unexpected or missing simulation requirement')
    result, = [item for item in plan['requirements'] if item['kind'] == rule['kind']
               and item['label'] == rule['label'] and dt(item['at']) == dt(rule['at'])]
    if (result['required_t'] != rule['min_qty']
            or result['achieved_t'] != sum(vessel['done_t'] for vessel in result['vessels'])
            or result['short_t'] != max(0, result['required_t'] - result['achieved_t'])
            or result['met'] != (result['short_t'] == 0)):
        raise ValueError('Export quantities do not reconcile')
    return {field: result[field] for field in ('met', 'required_t', 'achieved_t', 'short_t')}


def review_snapshot(path):
    source = path.read_bytes()
    snapshot = json.loads(source)
    if snapshot['status'] not in ('candidate_snapshot_ready', 'candidate_not_produced'):
        raise ValueError(f"{path.name}: snapshot not available ({snapshot['status']})")
    index_row, *_ = read_case(path)
    if (snapshot['provenance'] != 'historical_replay_with_synthetic_constraint_unreviewed'
            or snapshot['human_judgments'] or snapshot['operational_outcome'] is not None):
        raise ValueError(f'{path.name}: incorrect provenance')
    scenario = snapshot['simulated_constraint']
    kind, rule, anchor = (scenario[key] for key in ('type', 'condition', 'anchor'))
    if scenario['provenance'] != 'synthetic_constraint_on_historical_replay':
        raise ValueError(f'{path.name}: scenario origin is missing')
    control = snapshot['control']
    control_plan = control['response']['plan']
    control_operation = next(op for op in control_plan['vessels'] if op['vessel_id'] == anchor['vessel_id'])
    if any(control_operation[key] != value for key, value in anchor.items()):
        raise ValueError(f'{path.name}: control anchor mismatch')
    if (kind == 'equipment' and not dt(rule['start']) <= dt(anchor['etb']) < dt(rule['end'])
            or kind == 'fixed_berth' and dt(rule['etb']) == dt(anchor['etb'])
            or kind == 'urgent_export' and dt(rule['at']) >= dt(anchor['work_end'])):
        raise ValueError(f'{path.name}: constraint does not affect the control anchor')

    if [candidate['slot'] for candidate in snapshot['candidates']] != list('ABC'):
        raise ValueError(f'{path.name}: expected all three candidate statuses')
    rows = []
    for candidate in snapshot['candidates']:
        response = candidate.get('response', {})
        plan = response.get('plan')
        row = {'slot': candidate['slot'], 'status': response.get('status', candidate['status']), 'available': bool(plan)}
        rows.append(row)
        if not plan:
            continue
        if not candidate.get('risks') or response['engine']['version'] != control['response']['engine']['version']:
            raise ValueError(f"{path.name}: missing risk response or engine mismatch in {row['slot']}")
        outcome = score_constraint(kind, rule, candidate['request'], plan)
        if kind in ('equipment', 'fixed_berth') and not outcome['met']:
            raise ValueError(f"{path.name}: hard constraint violated in {row['slot']}")
        selected = next((op for op in plan['vessels'] if op['vessel_id'] == anchor['vessel_id']), None)
        comparisons = compare_operations(control_plan, plan)
        row.update(outcome=outcome, total_cents=plan['total_cents'],
                   dropped=len(response['dropped']), waits=plan['waits'], tank_violation=plan['tank_violation'],
                   anchor_berth=selected['berth'] if selected else None,
                   anchor_etb=selected['etb'] if selected else None,
                   risk_counts=candidate['risks']['counts'], comparisons=comparisons)
    selected_condition = {'equipment': 'blocks', 'fixed_berth': 'fixes', 'urgent_export': 'requirements'}[kind]
    primary = snapshot['candidates'][0]['request']
    original = control['request']
    if (original.get(selected_condition)
            or {key: val for key, val in primary.items() if key != selected_condition}
            != {key: val for key, val in original.items() if key != selected_condition}):
        raise ValueError(f'{path.name}: A replay must change only its explicit constraint')
    return {
        'case_id': snapshot['case_id'], 'snapshot_sha256': sha256(source).hexdigest(), 'type': kind,
        'as_of': snapshot['as_of'], 'solver_window_end': index_row['solver_window_end'],
        'status': snapshot['status'], 'engine_version': control['response']['engine']['version'],
        'condition': rule, 'control_anchor': anchor, 'control_cents': control_plan['total_cents'],
        'candidates': rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshots', nargs='+', type=Path)
    args = parser.parse_args()
    rows = [review_snapshot(path) for path in args.snapshots]
    print(json.dumps({'counts_by_constraint': Counter(row['type'] for row in rows), 'cases': rows},
                     ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
