"""Build a compact, simulation-only search index from the audited case corpus."""

import argparse
import json
from datetime import datetime
from hashlib import sha256
from pathlib import Path

from verify_precedent_constraints import score_constraint


ACTIONS = {
    'keep_candidate': ('selection', ['keepCandidate']),
    'resequence_with_berth_changes': ('selection', ['resequence', 'reassignBerth']),
    'review_turnaround': ('diagnosis', ['inspectSchedule']),
    'verify_wind_policy': ('diagnosis', ['verifyWindPolicy']),
    'review_tank_balance': ('diagnosis', ['reviewTankBalance']),
    'rerun_solver': ('diagnosis', ['rerunSolver']),
    'review_equipment': ('diagnosis', ['reviewEquipment']),
    'keep_confirmed_dispatch': ('selection', ['confirmedDispatch']),
    'review_dispatch': ('diagnosis', ['inspectSchedule']),
    'resequence_around_fixed': ('selection', ['resequenceAroundFixed']),
    'review_fixed_berth': ('diagnosis', ['inspectSchedule']),
}


def scenario_constraint(kind, row, review, snapshot):
    scenario = snapshot['simulated_constraint']
    if (scenario['type'] != kind or scenario['provenance'] != 'synthetic_constraint_on_historical_replay'
            or review['conditions_at_decision']['simulated_constraint'] != scenario):
        raise ValueError('Search constraint differs from the audited replay')
    rule = scenario['condition']
    available = [candidate for candidate in snapshot['candidates'] if candidate.get('response', {}).get('plan')]
    outcomes = {
        candidate['slot']: score_constraint(kind, rule, candidate['request'], candidate['response']['plan'])
        for candidate in available
    }
    if not outcomes or (kind in ('equipment', 'fixed_berth') and not all(o['met'] for o in outcomes.values())):
        raise ValueError('Expected an audited response for the simulated hard constraint')
    start = datetime.fromisoformat(row['as_of'])

    def minutes(value):
        return (datetime.fromisoformat(value) - start).total_seconds() / 60

    if kind == 'equipment':
        lead = minutes(rule['start'])
        berths = sorted(set(rule['berths']))
        constraint = {'kind': 'equipment', 'berth': ', '.join(berths), 'berthCount': len(berths),
                      'phase': 'active' if lead <= 0 else 'upcoming', 'leadMin': lead,
                      'durationMin': minutes(rule['end']) - lead}
    elif kind == 'urgent_export':
        if (rule['kind'] != 'LOAD_BY' or rule.get('unit', 'TON') != 'TON'
                or len(rule['material_codes']) != 1 or rule.get('cargo_groups')):
            raise ValueError('Expected an export deadline and tonnage for one material')
        constraint = {'kind': 'urgentExport', 'material': rule['material_codes'][0],
                      'deadlineMin': minutes(rule['at']), 'tonnes': rule['min_qty']}
    else:
        constraint = {'kind': 'fixedBerth', 'berth': rule['berth'],
                      'leadMin': minutes(rule['etb']), 'lock': 'berth_and_etb'}
    return constraint, {'scenarioType': kind, 'outcomesBySlot': outcomes}


def predecessor(plan, fix):
    earlier = [op for op in plan['vessels'] if op['berth'] == fix['berth']
               and datetime.fromisoformat(op['etb']) < datetime.fromisoformat(fix['etb'])]
    return max(earlier, key=lambda op: datetime.fromisoformat(op['etb']))['vessel_id'] if earlier else None


def primary_constraint(profile, row, review, snapshot):
    kind = profile.get('type')
    if kind in ('equipment', 'urgent_export', 'fixed_berth'):
        return scenario_constraint(kind, row, review, snapshot)
    if kind == 'solver_failure':
        slots = {c['slot']: c for c in snapshot['candidates']}
        missing = [slot for slot, c in slots.items() if not c.get('response', {}).get('plan')]
        if not missing:
            raise ValueError('A solver-failure profile requires a missing plan')
        return {'kind': 'solverFailure', 'baselineAvailable': 'A' not in missing, 'missingCount': len(missing)}, {
            'missingSlots': missing, 'statusBySlot': review['engine_status_by_calculated_slot'],
        }
    if kind == 'wind_policy':
        policies = {c['preset']['id']: c['response']['params']['weather']['thresholds_ms'].get('#3~7')
                    for c in snapshot['candidates'] if 'params' in c.get('response', {})}
        slots = [policies.get(key) for key in ('base', 'wind')]
        if any(not limits for limits in slots) or slots[0][0] == slots[1][0]:
            raise ValueError('Wind-policy profile lacks distinct stored thresholds')
        return {'kind': 'windPolicy', 'scope': '#3~7', 'stopLimitsMs': sorted(limits[0] for limits in slots)}, {
            'policySlots': ['base', 'wind'],
        }
    slot, risk_id = profile['risk']
    candidate = next(c for c in snapshot['candidates'] if c['slot'] == slot)
    evidence = next(r for r in candidate['risks']['risks'] if r['id'] == risk_id)
    if not any(r['id'] == risk_id and r['calculated_slot'] == slot and r['schedule_id'] == candidate['schedule_id']
               and r['evidence'] == evidence['evidence'] for r in review['risk_evidence']):
        raise ValueError(f'Risk {slot}/{risk_id} lacks a matching judgment reference')
    values = evidence['evidence']
    timing = 'extension' if datetime.fromisoformat(evidence['start']) >= datetime.fromisoformat(row['nominal_window_end']) else 'planning'
    constraint = {'timing': timing}
    if evidence['kind'] == 'TANK':
        constraint.update(kind='tank', tank=evidence['tank'],
                          direction={'OVER': 'upper', 'SHORT': 'lower'}[values['side']],
                          limitPct=values['limit_pct'], marginPct=values['gap_pct'])
    elif evidence['kind'] == 'WORK_GAP':
        constraint.update(kind='turnaround', berth=evidence['berth'], operations=values['ships'],
                          gapHours=min(values['gaps_h']))
    elif evidence['kind'] == 'LAYTIME' and values['slack_h'] > 0:
        constraint.update(kind='laytime', berth=evidence['berth'], state='remaining', slackHours=values['slack_h'])
    else:
        raise ValueError(f'Unsupported risk profile: {evidence["kind"]}')
    return constraint, {'slot': slot, 'riskId': risk_id, 'scheduleId': candidate['schedule_id']}


def build_case(base, row, profile, review):
    raw = (base / row['snapshot']).read_bytes()
    if (sha256(raw).hexdigest() != row['snapshot_sha256']
            or review['snapshot_sha256'] != row['snapshot_sha256']
            or review['judgment_source'] != 'ai_simulated_scheduler_review'
            or review['operational_search_eligible']):
        raise ValueError('Expected linked simulation-only judgment and snapshot')
    snapshot = json.loads(raw)
    constraint, evidence = primary_constraint(profile, row, review, snapshot)
    action = profile['action']
    intent, requires = ACTIONS[action]
    selected = review['selected_candidate']
    if intent == 'selection':
        if review['decision'] != 'select' or not selected or row['collection_status'] != 'candidate_snapshot_ready':
            raise ValueError('Selection profile requires a complete candidate set and a selection')
        display = next(c for c in snapshot['displayed'] if c['slot'] == selected['slot'])
        candidate = next(c for c in snapshot['candidates'] if c['slot'] == selected['calculated_slot'])
        response = candidate['response']
        if (display['schedule_id'] != selected['schedule_id'] or candidate['schedule_id'] != selected['schedule_id']
                or response['dropped'] or response['plan']['tank_violation'] or response['plan']['waits']
                or any(c.get('met') is not True for c in response['plan']['requirements'])):
            raise ValueError('Selection profile refers to a missing or constrained candidate')
        if action == 'resequence_with_berth_changes':
            baseline = next(c for c in snapshot['candidates'] if c['slot'] == 'A')
            original = {v['vessel_id']: v['berth'] for v in baseline['response']['plan']['vessels']}
            changed = {v['vessel_id']: v['berth'] for v in response['plan']['vessels']}
            if original.keys() != changed.keys() or original == changed:
                raise ValueError('Berth reassignment profile needs a berth change for the same vessel set')
        if action == 'keep_confirmed_dispatch' and not evidence['outcomesBySlot'][candidate['slot']]['met']:
            raise ValueError('Export selection must meet the recorded deadline and tonnage')
        if action == 'resequence_around_fixed':
            rule = snapshot['simulated_constraint']['condition']
            alt = next(c for c in snapshot['candidates'] if c['slot'] == review['alternative']['calculated_slot'])
            before, after = alt['response']['plan'], response['plan']
            if ({v['vessel_id'] for v in before['vessels']} != {v['vessel_id'] for v in after['vessels']}
                    or predecessor(before, rule) == predecessor(after, rule)):
                raise ValueError('Fixed berth selection must change the predecessor for the same vessel set')
    elif review['decision'] not in ('hold', 'recalculate'):
        raise ValueError('Diagnosis profile requires a hold or recalculation')
    return {
        'caseId': row['case_id'], 'caseGroupId': row['case_group_id'], 'asOf': row['as_of'],
        'observableBy': row['solver_window_end'], 'partition': row['partition'],
        'provenance': review['judgment_source'], 'operationalEligible': False,
        'intent': intent, 'action': action, 'requires': requires,
        'constraint': constraint, 'evidence': {**evidence, 'snapshotSha256': row['snapshot_sha256']},
        'decision': review['decision'], 'selected': selected, 'alternative': review['alternative'],
        'title': review['focus'], 'reasoning': review['reasoning'], 'tradeoff': review['tradeoff'],
        'recheck': review['reconsideration_condition'], 'checks': review['confirmation_items'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('corpus', type=Path)
    parser.add_argument('--profiles', type=Path, default=Path(__file__).with_name('precedent_search_profiles.json'))
    parser.add_argument('--development-only', action='store_true', help='Exclude evaluation cases from the browser index')
    args = parser.parse_args()
    base = args.corpus.parent
    profiles = json.loads(args.profiles.read_text())
    corpus = json.loads(args.corpus.read_text())
    judgments = {}
    cases = []
    for row in corpus['cases']:
        date = row['as_of'][:10]
        if (row['partition'] == 'excluded_demo' or (args.development_only and row['partition'] != 'development')
                or not (profile := profiles.get(date))):
            continue
        file = base / row['simulated_judgment']['file']
        if file not in judgments:
            judgments[file] = {r['case_id']: r for r in json.loads(file.read_text())['reviews']}
        try:
            cases.append(build_case(base, row, profile, judgments[file][row['case_id']]))
        except (ValueError, KeyError, StopIteration) as error:
            parser.error(f'{row["case_id"]}: {error}')
    print(json.dumps({'formatVersion': 1, 'cases': cases}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
