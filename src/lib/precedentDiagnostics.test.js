import assert from 'node:assert/strict'
import { test } from 'node:test'
import { candidateAvailability, initialResults, rankSims } from './dataset.js'
import { checksForConstraint, searchPrecedents } from './precedent.js'
import { solverDiagnosticContext } from './precedentComparison.js'

const scen = {
  request: { start: '2025-12-07T00:00:00Z', vessels: [], params: { solver: { time_limit_s: 15 } } },
  window: { start: 0, end: 4320 },
  vessels: [], blocks: [], fixes: [], params: {},
}
const noPlan = { status: 'NO_PLAN', plan: null }
const planned = { status: 'FEASIBLE', plan: { vessels: [], total_cents: 200 },
  window: { end: '2025-12-10T00:00:00Z' } }

test('checks for a current tank constraint are available on an empty search result', () => {
  const constraint = { kind: 'tank', tank: '석유제품 반출', direction: 'upper', limitPct: 80, marginPct: 5.5, timing: 'extension' }
  const result = searchPrecedents({ formatVersion: 1, cases: [] }, {
    asOf: scen.request.start, mode: 'simulation', intent: 'selection', constraint,
  })
  assert.equal(result.status, 'no_match')
  assert.match(checksForConstraint(constraint).join(' '), /승인 운영 한계.*최신 입출고 및 재고/)
  assert.deepEqual(checksForConstraint({ kind: 'constructor' }), [])
})

test('a missing A skips B, preserves C status, and exposes a diagnostic search without producing confirmable plans', async (t) => {
  const attempts = []
  const stages = []
  let aAvailable = false
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === '/engine/health') return Response.json({})
    assert.equal(url, '/engine/plan-jobs')
    assert.equal(options.method, 'POST')
    assert.ok(options.headers['Idempotency-Key'])
    const request = JSON.parse(options.body)
    attempts.push([request.request_id, request.params.solver.time_limit_s])
    const result = request.request_id === 'base' && !aAvailable ? noPlan : planned
    return Response.json({ job_id: 'test-job', status: 'SUCCEEDED', result })
  })
  const shown = []
  const showA = (a) => shown.push(a)
  const incomplete = await initialResults(scen, (step) => stages.push(step), undefined, showA)
  assert.deepEqual(shown, [])
  assert.deepEqual(stages, ['A', 'C'])
  assert.deepEqual(attempts, [['base', 15], ['base', 20], ['vessel_buffer', 15]])
  const availability = candidateAvailability(incomplete)
  assert.deepEqual(availability.map(({ slot, available, status, timeLimit, reason }) => (
    [slot, available, status, timeLimit, reason]
  )), [['A', false, 'NO_PLAN', 20, undefined], ['B', false, null, null, 'depends_on_a'], ['C', true, 'FEASIBLE', 15, undefined]])
  assert.throws(() => rankSims(incomplete), /NO_PLAN/)

  const context = solverDiagnosticContext(scen, availability)
  const [option] = context.options
  assert.equal(option.intent, 'diagnosis')
  assert.deepEqual(option.constraint, { kind: 'solverFailure', baselineAvailable: false, missingCount: 2 })
  assert.equal(context.keepCandidate, false)
  assert.equal(context.canReassignBerth, false)
  assert.match(checksForConstraint(option.constraint)[0], /계산 한도와 호환 선석 제약/)
  const prior = { caseId: '2025-04-19-ulsan-72h', caseGroupId: 'april', asOf: '2025-04-19T00:00:00Z',
    observableBy: '2025-04-25T00:00:00Z', partition: 'development', operationalEligible: false,
    provenance: 'ai_simulated_scheduler_review', intent: 'diagnosis', constraint: option.constraint, requires: ['rerunSolver'] }
  const index = { formatVersion: 1, cases: [prior] }
  assert.equal(searchPrecedents(index, { ...context, ...option, mode: 'simulation',
    capabilities: { rerunSolver: true } }).matches[0].caseId, prior.caseId)

  aAvailable = true
  stages.length = 0
  const retried = await initialResults(scen, (step) => stages.push(step), undefined, showA)
  assert.deepEqual(shown, [retried[0]])
  assert.deepEqual(stages, ['A', 'BC'])
  assert.deepEqual(rankSims(retried).map((candidate) => candidate.id), ['A', 'B', 'C'])
})

test('a service failure remains a calculation error and does not become a no-plan diagnosis', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => url === '/engine/health' ? Response.json({})
    : Response.json({ detail: 'service unavailable' }, { status: 503 }))
  await assert.rejects(initialResults(scen), /service unavailable/)
})
