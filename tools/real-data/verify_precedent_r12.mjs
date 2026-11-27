import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildRequest, buildScen, candidateAvailability, rankSims } from '../../src/lib/dataset.js'
import { searchPrecedents, checksForConstraint } from '../../src/lib/precedent.js'
import { comparisonContext, precedentQuery, solverDiagnosticContext } from '../../src/lib/precedentComparison.js'
import { setTimeBase } from '../../src/lib/time.js'

const [corpusPath, indexPath, browserPath] = process.argv.slice(2)
if (!corpusPath || !indexPath || !browserPath) {
  throw new Error('Usage: node verify_precedent_r12.mjs CORPUS FULL_INDEX BROWSER_INDEX')
}
const json = (path) => JSON.parse(readFileSync(path, 'utf8'))
const corpus = json(corpusPath)
const full = json(indexPath)
const browser = json(browserPath)
const caseId = (day) => `2025-${day}-ulsan-72h`
assert.deepEqual(browser.cases, full.cases.filter((card) => card.partition === 'development'))
assert.deepEqual(full.cases.map((card) => card.caseId), corpus.cases.map((row) => row.case_id))
assert.ok(full.cases.filter((card) => card.partition === 'evaluation')
  .every((card) => !browser.cases.some((source) => source.caseGroupId === card.caseGroupId)))

function replay(day, kind) {
  const row = corpus.cases.find((entry) => entry.case_id === caseId(day))
  const snapshot = json(resolve(dirname(corpusPath), row.snapshot))
  const results = snapshot.candidates
  const request = results[0].request
  setTimeBase(request.start)
  const scen = buildScen({ request, days: 3 })
  const replayedRequest = buildRequest(scen, results[0].preset)
  assert.deepEqual(replayedRequest.blocks, request.blocks)
  assert.deepEqual(replayedRequest.fixes, request.fixes)
  assert.deepEqual(replayedRequest.requirements, request.requirements)
  const complete = results.every((candidate) => candidate.response?.plan)
  const candidates = complete ? rankSims(results) : []
  const context = complete ? comparisonContext(scen, candidates[0], candidates, {})
    : solverDiagnosticContext(scen, candidateAvailability(results))
  const option = context.options.find((entry) => entry.constraint.kind === kind)
  assert.ok(option, `No ${kind} option from the saved ${day} request`)
  assert.deepEqual(option.constraint, full.cases.find((card) => card.caseId === row.case_id).constraint)
  return { row, scen, candidates, context, option }
}

const checks = []
function verify(name, query, status, days, index = browser) {
  const result = searchPrecedents(index, query)
  assert.equal(result.status, status, name)
  assert.deepEqual(result.matches.map((card) => card.caseId), days.map(caseId), name)
  const group = full.cases.find((card) => card.caseId === query.caseId)?.caseGroupId
  for (const card of result.matches) {
    assert.equal(card.partition, 'development')
    if (group) assert.notEqual(card.caseGroupId, group)
    assert.ok(Date.parse(card.observableBy) <= Date.parse(query.asOf))
    assert.ok(card.common.length > 0 && card.currentChecks.length > 0)
  }
  checks.push({ name, status, matches: result.matches.map((card) => card.caseId) })
}

// Expectations use the R11 judgments, status and timestamps with groups held out.
const evaluations = [
  ['07-16', 'urgentExport', 'diagnosis', 'no_match', []], // jet fuel recovery has no prior applicable action
  ['08-04', 'equipment', 'diagnosis', 'matched', ['03-15']], // also check tank constraints when reviewing alternatives
  ['09-01', 'equipment', 'diagnosis', 'matched', ['03-15']], // a missing candidate still permits recovery diagnosis
  ['09-25', 'fixedBerth', 'diagnosis', 'no_match', []], // earlier case chose a plan; current B is missing
]
for (const [day, kind, intent, status, expected] of evaluations) {
  const { row, context, option } = replay(day, kind)
  assert.equal(row.partition, 'evaluation')
  assert.ok(checksForConstraint(option.constraint).length)
  const query = precedentQuery(context, option, intent, false)
  verify(`${day} held-out, browser index`, query, status, expected)
  verify(`${day} held-out, full index`, query, status, expected, full)
}

const equipment = replay('08-04', 'equipment')
const outage = precedentQuery(equipment.context, equipment.option, 'diagnosis', false)
verify('future closures and all evaluation rows stay out', { ...outage, asOf: '2025-10-10T00:00:00Z' },
  'matched', ['03-15'], full)
verify('long outage excluded', { ...outage, constraint: { ...outage.constraint, durationMin: 480 } }, 'no_match', [])
verify('active outage distinct from upcoming outage', {
  ...outage, constraint: { ...outage.constraint, phase: 'active', leadMin: -10 },
}, 'no_match', [])
verify('wider berth closure excluded', {
  ...outage, constraint: { ...outage.constraint, berth: '2-4, 2-5', berthCount: 2 },
}, 'no_match', [])
verify('matching outage unavailable before its solver window ends', {
  ...outage, asOf: '2025-03-19T00:00:00Z',
}, 'no_match', [])
const sameGroup = { ...browser, cases: browser.cases.map((card) => card.caseId === caseId('03-15')
  ? { ...card, caseGroupId: equipment.row.case_group_id } : card) }
verify('matching outage from current case group excluded', outage, 'no_match', [], {
  ...sameGroup, cases: [...sameGroup.cases, full.cases.find((card) => card.caseId === equipment.row.case_id)],
})

const dispatch = replay('04-29', 'urgentExport')
const later = { ...dispatch.context, asOf: '2025-07-16T00:00:00Z', caseId: 'confirmation-control' }
const confirmed = precedentQuery(later, dispatch.option, 'selection', true)
verify('comparable export with confirmed deadline and quantity', confirmed, 'matched', ['04-29'])
verify('export terms not confirmed', precedentQuery(later, dispatch.option, 'selection', false), 'action_unconfirmed', [])
verify('earlier deadline outside tolerance', { ...confirmed, constraint: { ...confirmed.constraint, deadlineMin: 240 } },
  'no_match', [])
verify('different export material at the same deadline and quantity', {
  ...confirmed, constraint: { ...confirmed.constraint, material: 'MAT-JET' },
}, 'no_match', [])
verify('same material and deadline but over twice the quantity', {
  ...confirmed, constraint: { ...confirmed.constraint, tonnes: 1500 },
}, 'no_match', [])
const incomplete = { ...dispatch.candidates[0], requirements: [] }
const incompleteContext = comparisonContext(dispatch.scen, incomplete, [incomplete], {})
verify('confirmation without a fulfilled engine requirement is insufficient', {
  ...precedentQuery(incompleteContext, incompleteContext.options[0], 'selection', true),
  asOf: later.asOf, caseId: later.caseId,
}, 'action_unconfirmed', [])

const fixed = replay('11-15', 'fixedBerth')
const fixedQuery = precedentQuery(fixed.context, fixed.option, 'selection', true)
verify('predecessor change available while preserving fixed berth and ETB', fixedQuery, 'matched', ['06-29'])
verify('fixed plan comparison requires permission', precedentQuery(fixed.context, fixed.option, 'selection', false),
  'action_unconfirmed', [])
const altered = fixed.candidates.slice(1).map((candidate) => ({ ...candidate,
  placements: candidate.placements.map((p) => p.fixed ? { ...p, etb: p.etb + 5 } : p),
}))
const broken = comparisonContext(fixed.scen, fixed.candidates[0], [fixed.candidates[0], ...altered], {})
verify('an alternative that moves a locked vessel does not count as available',
  precedentQuery(broken, broken.options.find((o) => o.constraint.kind === 'fixedBerth'), 'selection', true),
  'action_unconfirmed', [])
verify('fixed berth time outside tolerance', { ...fixedQuery, constraint: { ...fixedQuery.constraint, leadMin: 120 } },
  'no_match', [])
verify('selection cannot be returned as an incomplete-plan diagnosis',
  { ...fixedQuery, intent: 'diagnosis' }, 'no_match', [])

console.log(JSON.stringify({ heldOutWindows: evaluations.length, checks }, null, 2))
