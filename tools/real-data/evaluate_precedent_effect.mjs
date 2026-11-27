import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { buildScen, toSim } from '../../src/lib/dataset.js'
import { searchPrecedents } from '../../src/lib/precedent.js'
import { comparisonContext } from '../../src/lib/precedentComparison.js'
import { setTimeBase } from '../../src/lib/time.js'

// Reference sets score reuse of a decision or diagnosis under the documented constraints.
// No production judgments, search scores, or card ordering are used as labels.
const review = {
  '2025-08-10': {
    intent: 'selection',
    constraint: { kind: 'tank', timing: 'extension', tank: '석유제품 반출', direction: 'upper', limitPct: 80, marginPct: 5.5 },
    references: {},
    checks: { tankBalance: [/승인.*한계/, /최신.*입출고/, /재고/] },
  },
  '2025-10-03': {
    intent: 'selection',
    constraint: { kind: 'turnaround', timing: 'planning', berth: '1-1', operations: 8, gapHours: 0 },
    references: {
      '2025-05-23': '교대 추가 여유 0시간인 5척 작업에서 선석 조정으로 연쇄 지연을 줄인 사례',
      '2025-07-27': '교대 추가 여유 0시간인 4척 작업에서 순서와 선석을 바꾼 사례',
      '2025-02-10': '교대 추가 여유 0시간인 4척 작업에서 지연을 감수하고 저비용안을 유지한 사례',
    },
    checks: {
      predecessorAndDeadline: [/선행.*종료/, /후속.*확정.*마감/],
      alternativeBerthAuthority: [/대체.*선석.*가용/, /배치.*변경.*권한/],
    },
  },
  '2025-11-23': {
    intent: 'diagnosis',
    constraint: { kind: 'windPolicy', scope: '#3~7', stopLimitsMs: [10, 14] },
    references: {
      '2025-03-23': '같은 부두군에서 10·14m/s 중단 기준을 비교하고 적용 정책을 확인한 사례',
      '2025-05-07': '같은 기준 차이에서 비용 변화를 날씨 자체의 효과로 해석하지 않고 보류한 사례',
    },
    checks: { issuedForecastAndRule: [/기준 시각.*예보/, /적용되는.*부두별.*중단 기준/] },
  },
  '2025-12-07': {
    intent: 'diagnosis',
    constraint: { kind: 'solverFailure', baselineAvailable: false, missingCount: 2 },
    references: {
      '2025-04-19': 'A가 NO_PLAN이고 B가 실행되지 않아 C만 산출된 사례',
    },
    checks: { timeLimitAndCompatibility: [/계산 한도/, /호환 선석 제약/] },
  },
}

const [artifactDir, output] = process.argv.slice(2)
if (!artifactDir || !output) throw new Error('Usage: node evaluate_precedent_effect.mjs ARTIFACT_DIR OUTPUT_JSON')
const read = (path) => JSON.parse(readFileSync(resolve(artifactDir, path), 'utf8'))
const index = read('search-index.json')
const corpus = read('corpus-index.json').cases
const repo = fileURLToPath(new URL('../../', import.meta.url))
const legacyRevision = 'f0c245b'
const legacy = execFileSync('git', ['show', `${legacyRevision}:src/screens/SimilarCases.jsx`], { cwd: repo, encoding: 'utf8' })
const legacyLogic = legacy.slice(legacy.indexOf('const CASES ='), legacy.indexOf('export default'))
const { CASES: mockCases, TOP_K: topK, situationTags } = runInNewContext(`${legacyLogic}\n;({ CASES, TOP_K, situationTags })`)
const dataset = JSON.parse(readFileSync(resolve(repo, 'public/data/index.json'), 'utf8')).find((item) => item.id === 'real-2025')
const demoStarts = ['2025-03-01 09:00', '2025-03-10 09:00', '2025-10-15 09:00', '2025-11-09 09:00']
assert.deepEqual(dataset.shortcuts, demoStarts)
const evaluation = corpus.filter((row) => row.partition === 'evaluation')
const development = corpus.filter((row) => row.partition === 'development')
assert.deepEqual(evaluation.map((row) => row.as_of.slice(0, 10)).sort(), Object.keys(review))
assert.ok(development.every((row) => evaluation.every((heldOut) => row.case_group_id !== heldOut.case_group_id)))
assert.equal(index.cases.length, corpus.length)

const caseData = new Map()
for (const row of corpus) {
  const start = Date.parse(row.as_of)
  const nominalEnd = Date.parse(row.nominal_window_end)
  const solverEnd = Date.parse(row.solver_window_end)
  assert.ok(Number.isFinite(solverEnd) && nominalEnd === start + dataset.days * 864e5, row.case_id)
  for (const demo of demoStarts) {
    const reserved = Date.parse(`${demo.replace(' ', 'T')}:00+09:00`)
    assert.ok(start >= reserved + dataset.days * 864e5 || Math.max(nominalEnd, solverEnd) <= reserved, row.case_id)
  }

  const bytes = readFileSync(resolve(artifactDir, row.snapshot))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.snapshot_sha256, row.case_id)
  const snapshot = JSON.parse(bytes)
  const card = index.cases.find((item) => item.caseId === row.case_id)
  assert.equal(snapshot.case_id, row.case_id)
  assert.equal(card.caseGroupId, row.case_group_id)
  assert.equal(card.partition, row.partition)
  assert.equal(card.evidence.snapshotSha256, row.snapshot_sha256)
  assert.equal(Date.parse(card.observableBy), Math.max(nominalEnd, solverEnd))
  const request = snapshot.candidates[0].request
  setTimeBase(request.start)
  const successful = snapshot.candidates.filter((item) => item.response?.plan)
  const slots = snapshot.displayed
    ? snapshot.displayed.map((entry) => [entry.slot, successful.find((item) => item.schedule_id === entry.schedule_id)])
    : successful.map((item) => [item.slot, item])
  const scen = buildScen({ id: row.case_id, request, days: dataset.days }, slots[0]?.[1].response)
  const candidates = slots.map(([slot, item]) => ({ ...toSim(item.response, item.preset, slot), resp: item.response }))
  const risks = Object.fromEntries(slots.map(([slot, item]) => [slot, {
    state: item.risks ? 'done' : 'error', data: item.risks,
  }]))
  const tags = [...situationTags(scen, candidates, risks, scen.incidents.filter((incident) => incident.change)).tags]
  caseData.set(row.case_id, { scen, candidates, risks, tags, snapshot })
}

const eligiblePast = (row, query) => row.partition === 'development'
  && row.case_group_id !== query.case_group_id
  && Date.parse(row.as_of) < Date.parse(query.as_of)
  && Math.max(Date.parse(row.nominal_window_end), Date.parse(row.solver_window_end)) <= Date.parse(query.as_of)

function rankTags(cases, tags) {
  const current = new Set(tags)
  return cases.map((row) => ({ ...row, hit: row.tags.filter((tag) => current.has(tag)).length }))
    .sort((a, b) => b.hit - a.hit || b.date.localeCompare(a.date))
}

function distinctTop(ranked) {
  const byGroup = new Map()
  for (const row of ranked) {
    if (!byGroup.has(row.group)) byGroup.set(row.group, row)
    if (byGroup.size === topK) break
  }
  return [...byGroup.values()]
}

function checksVisible(lines, checks) {
  return Object.entries(checks).filter(([, concepts]) => lines.some((line) => (
    /확인|점검|검증/.test(line) && concepts.every((pattern) => pattern.test(line))
  ))).map(([name]) => name)
}

const tagCases = development.map((row) => ({
  row, date: row.as_of.slice(0, 10), group: row.case_group_id, tags: caseData.get(row.case_id).tags,
}))
const strategies = {
  legacyMock: (item) => rankTags(mockCases, item.tags).slice(0, topK),
  legacySameCorpus: (item) => distinctTop(rankTags(tagCases.filter(({ row }) => eligiblePast(row, item.row)), item.tags)),
  structured: (item) => searchPrecedents(index, item.query).matches,
}
const inputs = evaluation.map((row) => {
  const date = row.as_of.slice(0, 10)
  const target = review[date]
  const { scen, candidates, risks, tags, snapshot } = caseData.get(row.case_id)
  setTimeBase(scen.request.start)
  let current
  if (target.constraint.kind === 'solverFailure') {
    // Candidate comparison has no A plan to display. Inspect the existing calculation status offline.
    current = [{ intent: 'diagnosis', constraint: {
      kind: 'solverFailure', baselineAvailable: candidates.some((candidate) => candidate.id === 'A'),
      missingCount: snapshot.candidates.length - candidates.length,
    } }]
  } else {
    current = comparisonContext(scen, candidates[0], candidates, risks).options
  }
  const selected = current.find((option) => option.intent === target.intent &&
    Object.entries(target.constraint).every(([key, value]) => JSON.stringify(option.constraint[key]) === JSON.stringify(value)))
  assert.ok(selected, `Current solver snapshot does not support the evaluation constraint on ${date}`)
  for (const ref of Object.keys(target.references)) {
    assert.ok(development.some((source) => source.as_of.startsWith(ref) && eligiblePast(source, row)), ref)
  }
  const query = { mode: 'simulation', asOf: row.as_of, caseId: row.case_id, intent: target.intent,
    constraint: selected.constraint, capabilities: {
      keepCandidate: true, resequence: true, reassignBerth: true,
      verifyWindPolicy: true, rerunSolver: true, reviewTankBalance: true,
    } }
  const baseLines = Object.values(risks).flatMap(({ data }) => (data?.risks ?? []).map((risk) => risk.title))
  baseLines.push(...current.map((option) => option.label).filter(Boolean))
  if (target.constraint.kind === 'solverFailure') baseLines.push('다시 계산하지 못했습니다', ...snapshot.candidates.map((item) => (
    `${item.slot} ${item.response?.status ?? item.status} ${item.reason ?? ''}`
  )))
  return { row, query, target, date, tags, baseLines }
})

const rows = inputs.map((item) => {
  const structured = strategies.structured(item)
  const dateOf = (card) => card.asOf.slice(0, 10)
  assert.ok(structured.every((card) => development.some((row) => row.case_id === card.caseId && eligiblePast(row, item.row))))
  return {
    date: item.date, tags: item.tags, currentConstraint: item.query.constraint, intent: item.target.intent,
    references: item.target.references,
    returned: {
      legacyMock: strategies.legacyMock(item).map(({ date, hit }) => ({ date, hit })),
      legacySameCorpus: strategies.legacySameCorpus(item).map(({ date, hit }) => ({ date, hit })),
      structured: structured.map((card) => ({ date: dateOf(card), action: card.action,
        common: card.common, differences: card.differences, currentChecks: card.currentChecks })),
    },
    checks: {
      required: Object.keys(item.target.checks),
      withoutCards: checksVisible(item.baseLines, item.target.checks),
      withCards: checksVisible([...item.baseLines, ...structured.flatMap((card) => card.currentChecks)], item.target.checks),
    },
  }
})

const ranking = Object.fromEntries(Object.keys(strategies).map((strategy) => {
  const result = { relevant: 0, irrelevant: 0, relevantQueryCount: 0, correctEmptyCount: 0 }
  for (const row of rows) {
    const cards = row.returned[strategy]
    const relevant = cards.filter(({ date }) => Object.hasOwn(row.references, date)).length
    result.relevant += relevant
    result.irrelevant += cards.length - relevant
    result.relevantQueryCount += Number(relevant > 0)
    result.correctEmptyCount += Number(!Object.keys(row.references).length && !cards.length)
  }
  return [strategy, result]
}))

function timedSearch(run) {
  const iterations = 500
  const sample = () => {
    const start = performance.now()
    let resultCount = 0
    for (let i = 0; i < iterations; i++) {
      for (const item of inputs) resultCount += run(item).length
    }
    assert.ok(resultCount > 0)
    return (performance.now() - start) / (iterations * inputs.length)
  }
  for (let i = 0; i < 5; i++) sample()
  const samples = Array.from({ length: 9 }, sample).sort((a, b) => a - b)
  return Number(samples[4].toFixed(6))
}

const stress = read('round-02/ai-review-replay.json').find((item) => item.case_id === '2025-10-03-ulsan-72h')
assert.equal(stress.snapshot_sha256, evaluation.find((row) => row.case_id === stress.case_id).snapshot_sha256)
assert.equal(stress.policies.length, 2)
const costExample = stress.policies.map((policy) => {
  const alternatives = policy.rows.filter((item) => item.scenario === 'work_plus_30pct')
  assert.deepEqual(alternatives.map((item) => item.slot), ['A', 'B', 'C'])
  return {
    windStopMs: policy.weather_thresholds_ms['#3~7'][0],
    alternatives: alternatives.map((item) => ({ slot: item.slot, totalUsd: item.disrupted_replay_cents / 100,
      downstreamDelayed: item.other_etb_delayed_count, maxDownstreamDelayMinutes: item.other_etb_max_delay_minutes })),
  }
})
const checks = Object.fromEntries(['required', 'withoutCards', 'withCards'].map((key) => [
  key, rows.reduce((sum, row) => sum + row.checks[key].length, 0),
]))
const report = {
  mode: 'offline_simulation', legacyRevision, demoStarts, developmentCount: development.length,
  evaluationCount: rows.length, evaluationGroupCount: new Set(evaluation.map((row) => row.case_group_id)).size,
  ranking, currentConstraintAvailable: { withoutCards: rows.length, withCards: rows.length }, checks,
  medianMsPerQuery: Object.fromEntries(Object.entries(strategies).map(([key, rank]) => [key, timedSearch(rank)])),
  costExample, rows,
}
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ ranking, checks, medianMsPerQuery: report.medianMsPerQuery }, null, 2))
