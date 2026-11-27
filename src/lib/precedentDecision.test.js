import assert from 'node:assert/strict'
import { test } from 'node:test'
import { comparisonContext } from './precedentComparison.js'
import { candidateIdentity, decisionScope, decisionsFor } from './precedentDecision.js'
import { cancelPlan, fixPlan, resetWorkspace, setRole, ws } from './workspace.js'

const data = new Map()
const storage = {
  get length() { return data.size }, key: (index) => [...data.keys()][index],
  getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

const candidate = (id, berth, requestId) => ({
  id, label: `후보 ${id}`, total: 50, status: 'FEASIBLE', preset: { id: id === 'A' ? 'base' : requestId },
  req: { request_id: requestId }, resp: { plan: { waits: 0 }, params: { tank: { safe_max_pct: 75 } } },
  placements: [{ vid: 's1', bid: berth, etb: 30, etu: 60, dem: { cents: 50 } }],
})
const scen = { id: 'sample', name: '날짜', request: { start: '2025-10-03T00:00:00Z' }, vessels: [], berths: [] }

test('confirmation saves the version, all candidates and risk evidence once, even when retried', () => {
  resetWorkspace()
  data.clear()
  setRole('scheduler')
  const a = candidate('A', '1', 'wind'), b = candidate('B', '2', 'wind'), c = candidate('C', '3', 'vessel_buffer')
  const candidates = [a, b, c]
  const evidence = { id: 'WORK_GAP-1', evidence: { ships: 4 } }
  const reference = { scope: decisionScope(scen, 1, a, candidates), caseId: '2025-05-23-ulsan-72h', sourceEvidence: { riskId: 'WORK_GAP-2' } }
  const request = { requestId: 'request-1', cand: a, candidates, scen, version: 1, reference, reason: '교대 간격을 비교',
    uncheckedRisks: [], risks: { A: { state: 'done', data: { risks: [evidence] } }, B: { state: 'error' } }, alternativeSlot: 'C', recheck: '출하 마감이 확정될 때' }
  const saved = fixPlan(request)
  assert.equal(fixPlan(request), saved)
  assert.equal(ws.plans.length, 1)
  assert.equal(ws.log.filter((item) => item.action === '계획 확정').length, 1)
  assert.equal(decisionsFor(storage, scen.id).length, 1)
  assert.equal(saved.decision.candidates.length, 3)
  assert.equal(saved.decision.candidates[0].displayPreset, 'base')
  assert.equal(saved.decision.candidates[0].appliedPreset, 'wind')
  assert.equal(saved.decision.candidates[2].placements[0].bid, '3')
  assert.equal(saved.decision.candidates[1].riskState, 'error')
  assert.equal(saved.decision.alternativeSlot, 'C')
  assert.equal(saved.decision.reference.sourceEvidence.riskId, 'WORK_GAP-2')
  evidence.evidence.ships = 9
  assert.equal(saved.decision.candidates[0].risks[0].evidence.ships, 4)
  assert.throws(() => fixPlan({ ...request, requestId: 'wrong-version', version: 2 }), /참고 사례/)
  assert.throws(() => fixPlan({ ...request, cand: b }), /후보 버전/)
  cancelPlan('새 작업을 반영함')
  assert.equal(decisionsFor(storage, scen.id)[0].cancelled, true)
  assert.equal(fixPlan(request).cancelled, true)
  assert.equal(ws.plans.length, 1)
  assert.equal(fixPlan({ ...request, requestId: 'request-2' }).no, 2)
  resetWorkspace()
  assert.equal(decisionsFor(storage, scen.id).length, 2)
})

test('unavailable storage and wrong role do not create a half-confirmed plan', () => {
  resetWorkspace()
  setRole('user')
  const a = candidate('A', '1', 'base')
  const request = { requestId: 'test-failed-write', scen, cand: a, candidates: [a], version: 1, risks: {}, uncheckedRisks: [] }
  assert.throws(() => fixPlan(request), /스케줄러/)
  setRole('scheduler')
  const write = storage.setItem
  try {
    storage.setItem = () => { throw new Error('quota') }
    assert.throws(() => fixPlan(request), /quota/)
    assert.equal(ws.plans.length, 0)
  } finally { storage.setItem = write }
})

test('current search uses the applied tank limit and respects fixed berths', () => {
  const a = candidate('A', '1', 'tank'), b = candidate('B', '2', 'base')
  const risk = { id: 'TANK-1', kind: 'TANK', tank: '석유제품 반출', severity: 'HIGH', start: '2025-10-03T00:15:00Z',
    evidence: { side: 'OVER', worst_pct: 79, limit_pct: 80 } }
  const risks = { A: { state: 'done', data: { risks: [risk] } } }
  const result = comparisonContext(scen, a, [a, b], risks)
  assert.deepEqual(result.options[0].constraint, { kind: 'tank', timing: 'planning', direction: 'upper', tank: '석유제품 반출', limitPct: 75, marginPct: -4 })
  assert.equal(result.canReassignBerth, true)
  assert.equal(comparisonContext({ ...scen, fixes: [{ vid: 's1' }] }, a, [a, b], risks).canReassignBerth, false)
  assert.notEqual(candidateIdentity(a).placementKey, candidateIdentity(b).placementKey)
})
