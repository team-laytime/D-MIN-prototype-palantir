import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { searchPrecedents } from '../../src/lib/precedent.js'

const [path] = process.argv.slice(2)
if (!path) throw new Error('Usage: node verify_precedent_search.mjs SEARCH_INDEX')
const index = JSON.parse(readFileSync(path, 'utf8'))
const find = (day) => index.cases.find((card) => card.asOf.startsWith(`2025-${day}T`))
const action = { keepCandidate: true, resequence: true, reassignBerth: true,
  verifyWindPolicy: true, rerunSolver: true, reviewTankBalance: true }
const results = []

function verify(name, query, expectedStatus, expectedDates, source = index) {
  const result = searchPrecedents(source, query)
  assert.equal(result.status, expectedStatus, name)
  assert.deepEqual(result.matches.map((card) => card.asOf.slice(5, 10)), expectedDates, name)
  assert.ok(result.matches.length <= 3, name)
  assert.equal(new Set(result.matches.map((card) => card.caseGroupId)).size, result.matches.length, name)
  for (const match of result.matches) {
    assert.equal(match.partition, 'development', name)
    assert.equal(match.provenance, 'ai_simulated_scheduler_review', name)
    assert.ok(Date.parse(match.observableBy) <= Date.parse(query.asOf), name)
    assert.ok(match.common.length && match.currentChecks.length && Array.isArray(match.differences), name)
    assert.ok(match.requires.every((capability) => query.capabilities[capability] === true), name)
  }
  results.push({ name, status: result.status, matched: result.matches.map((card) => ({
    caseId: card.caseId, decision: card.decision, action: card.action,
    common: card.common, differences: card.differences, currentChecks: card.currentChecks,
  })) })
  return result
}

function evaluationQuery(day, constraint, intent) {
  const target = find(day)
  assert.equal(target.partition, 'evaluation')
  assert.deepEqual(target.constraint, constraint)
  return { mode: 'simulation', asOf: target.asOf, caseId: target.caseId, constraint, intent, capabilities: action }
}

const tank = evaluationQuery('08-10', {
  kind: 'tank', tank: '석유제품 반출', direction: 'upper', limitPct: 80, marginPct: 5.5, timing: 'extension',
}, 'selection')
const turnaround = evaluationQuery('10-03', {
  kind: 'turnaround', berth: '1-1', operations: 8, gapHours: 0, timing: 'planning',
}, 'selection')
const wind = evaluationQuery('11-23', {
  kind: 'windPolicy', scope: '#3~7', stopLimitsMs: [10, 14],
}, 'diagnosis')
const solver = evaluationQuery('12-07', {
  kind: 'solverFailure', baselineAvailable: false, missingCount: 2,
}, 'diagnosis')

verify('08-10 earlier upper-bound selection unavailable', tank, 'no_match', [])
const chain = verify('10-03 turnaround selection', turnaround, 'matched', ['05-23', '07-27', '02-10'])
assert.ok(chain.matches[0].differences.some((diff) => diff.key === 'operations' && diff.delta === 3))
assert.ok(chain.matches[0].differences.some((diff) => diff.key === 'berth' && diff.current === '1-1'))
verify('11-23 wind-policy diagnosis', wind, 'matched', ['05-07', '03-23'])
verify('12-07 incomplete candidate comparison', solver, 'matched', ['04-19'])

const later = { ...tank, asOf: '2025-12-30T09:00:00+09:00' }
verify('same tank and upper limit when past case is available', later, 'matched', ['09-19'])
verify('opposite tank direction stays excluded', { ...later, constraint: { ...tank.constraint, direction: 'lower' } }, 'no_match', [])
const sameLimitOpposite = { ...find('09-19'), constraint: { ...find('09-19').constraint, direction: 'lower' } }
verify('direction alone rejects an otherwise identical case', later, 'no_match', [], { ...index, cases: [sameLimitOpposite] })
verify('different approved tank limit stays excluded', { ...later, constraint: { ...tank.constraint, limitPct: 75 } }, 'no_match', [])
verify('tank breach and remaining margin are distinct', { ...later, constraint: { ...tank.constraint, marginPct: -1 } }, 'no_match', [])
verify('planning and extension constraints are distinct', { ...later, constraint: { ...tank.constraint, timing: 'planning' } }, 'no_match', [])
verify('no matches without a compatible action', { ...turnaround, capabilities: { resequence: true, reassignBerth: false } }, 'action_unconfirmed', [])
verify('unknown berth authority does not pass', { ...turnaround, capabilities: { keepCandidate: true, resequence: true } }, 'matched', ['02-10'])
verify('diagnostic hold does not become a selection', { ...wind, intent: 'selection' }, 'no_match', [])
verify('accrued demurrage and remaining laytime are distinct', { ...later, constraint: {
  kind: 'laytime', state: 'accrued', slackHours: -1, timing: 'planning',
} }, 'no_match', [])
verify('missing constraint direction', { ...tank, constraint: { ...tank.constraint, direction: undefined } }, 'missing_query_context', [])
verify('work chain is outside the comparable size range', { ...turnaround, constraint: {
  ...turnaround.constraint, operations: 25,
} }, 'no_match', [])
verify('computation window must be available before query', { ...later, asOf: '2025-09-20T12:00:00+09:00' }, 'no_match', [])
verify('corpus source group is withheld even if a request supplies a different group', {
  ...later, caseId: find('09-19').caseId, caseGroupId: 'different-group',
}, 'no_match', [])
verify('production-like query is outside the simulation index scope', { ...turnaround, mode: 'operational' }, 'simulation_only', [])
verify('past evaluation cases are unavailable as sources', { ...wind, asOf: '2025-12-30T09:00:00+09:00' }, 'matched', ['05-07', '03-23'])

const source = find('05-23')
const sameGroup = { ...source, caseId: 'same-group-case', asOf: '2025-05-24T09:00:00+09:00' }
const extra = { ...source, caseId: 'fourth-case', caseGroupId: 'another-group', asOf: '2025-05-22T09:00:00+09:00',
  constraint: { ...source.constraint, operations: 4, gapHours: 0.1 } }
verify('return at most three different groups', turnaround, 'matched', ['05-24', '07-27', '02-10'], {
  ...index, cases: [...index.cases, sameGroup, extra],
})

console.log(JSON.stringify({ scenarios: results.length, heldOutScenarios: 4, results }, null, 2))
