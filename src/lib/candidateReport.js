// 후보안 비교 보고서 (11-24 실데이터). 화면(ReportDoc), 마크다운, 메일 초안이 같은 모델을 쓴다.
// 금액은 엔진 계산값(센트)을 그대로 쓰고, 문서 속 금액은 useReport의 대조로 엔진 값에서 나왔는지 확인한다.
// 화면에서 체선료를 다시 계산하지 않는다. 차액(후보끼리)만 뺄셈으로 보인다. 실제 접안 실적과는 비교하지 않는다(11-25).
import { changedVs, risksOf } from './plan.js'
import { fmt, fmtDur, fmtFull, money } from './time.js'
import { reportPeriod } from './report.js'

const HIT = (r) => r.state === '해당'
const pct1 = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0')
/** -66.0 → '−66.0%' */
export const signedPct = (a, b) => {
  if (!b) return '-'
  const p = (((a - b) / b) * 100).toFixed(1)
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`
}
export const engineText = (sim) => (sim.status === 'OPTIMAL' || sim.proven ? '최적 증명' : '제한 시간 안의 최선')
const deltaText = (min) => (min === 0 ? '접안 시각 같음' : `접안 ${fmtDur(Math.abs(min))} ${min < 0 ? '앞당김' : '늦춤'}`)
const effectText = (b, p) => {
  if (b.dem.cents > 0 && p.dem.cents === 0) return '체선 없어짐'
  if (b.dem.cents === 0 && p.dem.cents > 0) return `체선 새로 생김 (초과 ${fmtDur(p.dem.excessMin)})`
  if (b.dem.cents === 0 && p.dem.cents === 0) return '체선 없음'
  return `초과 ${fmtDur(b.dem.excessMin)} → ${fmtDur(p.dem.excessMin)}`
}
export const TOP_N = 15

/**
 * @param {{ result, scen, selId, judgment, plan }} args
 *   selId: 선택한 후보 id, judgment: 판단근거, plan: 적용 중인 확정 계획(같은 계획 조건 버전일 때만) 또는 null
 */
export function buildCandidateReport({ result, scen, selId, judgment, plan }) {
  const cands = result.candidates
  const best = cands[0]
  const sel = cands.find((c) => c.id === selId) ?? best
  const base = result.baseline
  const vessels = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  const berths = Object.fromEntries(scen.berths.map((b) => [b.id, b]))
  const vname = (vid) => vessels[vid]?.name ?? vid
  const bname = (bid) => berths[bid]?.name ?? bid
  const bcode = (bid) => { const b = berths[bid]; return !b ? bid : /^\d+$/.test(b.code) ? `${b.code}부두` : b.code }

  const items = cands.map((sim) => {
    const rs = risksOf(sim, scen)
    return {
      id: sim.id, label: sim.label, preset: sim.preset, total: sim.total,
      extra: sim.total - best.total, extraPct: pct1(sim.total - best.total, best.total),
      moves: sim.moves, changedVsBest: sim.id === best.id ? 0 : changedVs(sim, best).length,
      dem: sim.placements.filter((p) => p.dem.cents > 0).length,
      night: sim.placements.filter((p) => p.night).length,
      tank: sim.tankViolation.length,
      engine: engineText(sim), status: sim.status, solveSec: sim.solveSec, notes: sim.notes,
      risks: rs, active: rs.filter(HIT),
    }
  })
  const selItem = items.find((it) => it.id === sel.id)

  // 선박별 체선료 상위 (선택한 안)
  const baseById = base ? Object.fromEntries(base.placements.map((p) => [p.vid, p])) : {}
  const top = [...sel.placements].filter((p) => p.dem.cents > 0).sort((a, b) => b.dem.cents - a.dem.cents).slice(0, TOP_N).map((p) => ({
    vid: p.vid, name: vname(p.vid), product: vessels[p.vid]?.product, dir: vessels[p.vid]?.dir, berth: bname(p.bid), etb: p.etb,
    excessMin: p.dem.excessMin, weatherMin: p.dem.weatherMin, cents: p.dem.cents, baseCents: baseById[p.vid]?.dem.cents ?? null,
  }))
  const demCount = sel.placements.filter((p) => p.dem.cents > 0).length

  // (실적 비교를 빼서 base가 없으므로 비어 있다. 보고서에 쓰지 않음)
  const changes = base ? changedVs(sel, base) : []
  const changed = changes.filter((c) => c.saving !== 0).sort((a, b) => Math.abs(b.saving) - Math.abs(a.saving)).slice(0, TOP_N).map((c) => ({
    vid: c.p.vid, name: vname(c.p.vid),
    what: `${c.berthChanged ? `부두 ${bcode(c.b.bid)} → ${bcode(c.p.bid)}, ` : `${bcode(c.p.bid)} 그대로, `}${deltaText(c.etbDelta)}`,
    effect: effectText(c.b, c.p), baseCents: c.b.dem.cents, cents: c.p.dem.cents, saving: c.saving,
  }))
  const changeSummary = { total: changes.length, berth: changes.filter((c) => c.berthChanged).length, money: changes.filter((c) => c.saving !== 0).length }

  // 리스크: 세 후보 모두 '해당'이면 공통, 일부만 '해당'이면 갈림
  const keys = items[0]?.risks.map((r) => r.key) ?? []
  const stateOf = (it, k) => it.risks.find((r) => r.key === k)
  const common = keys.filter((k) => items.every((it) => HIT(stateOf(it, k)))).map((k) => ({
    key: k, label: stateOf(items[0], k).label, alternative: stateOf(selItem, k).alternative,
    per: items.map((it) => ({ id: it.id, label: it.label, evidence: stateOf(it, k).evidence })),
  }))
  const differing = keys.filter((k) => !common.some((c) => c.key === k) && items.some((it) => HIT(stateOf(it, k)))).map((k) => ({
    key: k, label: stateOf(items[0], k).label, per: items.map((it) => ({ id: it.id, label: it.label, state: stateOf(it, k).state })),
  }))

  // 차트: 안별 합계, 체선료 상위 선박(후보끼리). 실제 접안 실적과는 비교하지 않는다(11-25)
  const totals = [...items.map((it) => ({ id: it.id, label: it.label, total: it.total }))]
  const series = [...items.map((it) => ({ id: it.id, label: it.label }))]
  const sources = [...cands]
  const centsOf = (src, vid) => src.placements.find((p) => p.vid === vid)?.dem.cents ?? 0
  const vids = [...new Set(sources.flatMap((s) => s.placements.filter((p) => p.dem.cents > 0).map((p) => p.vid)))]
    .map((vid) => ({ vid, max: Math.max(...sources.map((s) => centsOf(s, vid))) }))
    .sort((a, b) => b.max - a.max).slice(0, 10)
  const perVessel = vids.map(({ vid }) => ({ vid, name: vname(vid), values: sources.map((s) => ({ id: s.id, cents: centsOf(s, vid) })) }))

  return {
    period: reportPeriod(sel),
    status: plan ? `확정 v${plan.planNo}` : '검토 중',
    confirmed: Boolean(plan),
    sel: selItem, best: items[0], baseTotal: base?.total ?? null,
    judgment: (judgment ?? '').trim(),
    items, top, demCount, changed, changeSummary, common, differing, totals, series, perVessel,
    basis: {
      dataset: scen.name, bundle: scen.bundle, source: scen.summary, builtAt: scen.builtAt, calcAt: result.calcAt,
      start: fmtFull(scen.window.start), end: fmtFull(scen.window.end), vessels: scen.vessels.length, berths: scen.berths.length,
      presets: items.map((it) => `${it.label} ${it.preset?.label ?? ''}: ${it.preset?.desc ?? ''}`),
    },
  }
}

const vsBest = (m) => (m.sel.extra ? `최저안(${m.best.label}) ${money(m.best.total)}보다 ${money(m.sel.extra)}(${m.sel.extraPct}%) 많습니다.` : '세 후보 중 가장 낮습니다.')
const vsBaseLine = () => ''

export function candidateReportMarkdown(m) {
  const L = []
  L.push(`# 울산 부두 접안 계획 후보안 비교 보고 (${m.period})`, '', `${m.status}, 담당자 검토용`, '')
  L.push('## 1. 결론', `${m.confirmed ? '확정한' : '선택한'} 안은 ${m.sel.label}(${m.sel.preset?.label ?? '-'})입니다. 총 예상 체선료는 ${money(m.sel.total)}이며, ${vsBest(m)} ${vsBaseLine(m)}`, '')
  L.push('### 판단근거', m.judgment || '(아직 작성하지 않음)', '')
  L.push('## 2. 후보 비교', '| 안 | 무엇을 바꾼 안 | 총 예상 체선료 | 최저안 대비 | 체선 | 야간 접안 | 남은 리스크 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |')
  for (const it of m.items) {
    L.push(`| ${it.label}${it.id === m.sel.id ? ' (선택)' : ''} | ${it.preset?.label ?? '-'} | ${money(it.total)} | ${it.extra ? `+${money(it.extra)} (+${it.extraPct}%)` : '가장 낮음'} | ${it.dem}척 | ${it.night}척 | ${it.active.length}건 |`)
  }
  L.push('', `## 3. ${m.sel.label} 선박별 체선료 상위`, `체선이 생기는 선박 ${m.demCount}척 중 큰 순서 ${m.top.length}척`, '', '| 선박 | 화물 | 선석 | 접안 | 초과 시간 | 기상 공제 | 체선료 |', '| --- | --- | --- | --- | ---: | ---: | ---: |')
  for (const r of m.top) L.push(`| ${r.name} | ${r.product}, ${r.dir} | ${r.berth} | ${fmt(r.etb)} | ${fmtDur(r.excessMin)} | ${fmtDur(r.weatherMin)} | ${money(r.cents)} |`)
  if (!m.top.length) L.push('| 체선 없음 | | | | | | | |')
  L.push('', '## 4. 남은 리스크', '### 공통 (어느 안을 골라도 남음)')
  if (!m.common.length) L.push('- 없음')
  for (const c of m.common) L.push(`- ${c.label}: ${c.per.find((p) => p.id === m.sel.id)?.evidence ?? ''}. 대응: ${c.alternative}`)
  if (m.differing.length) {
    L.push('', '### 후보마다 갈림')
    for (const d of m.differing) L.push(`- ${d.label}: ${d.per.map((p) => `${p.label} ${p.state}`).join(', ')}`)
  }
  L.push('', '## 계산 기준',
    `- 후보 구성: ${m.basis.presets.join(' / ')}`,
    `- 데이터: ${m.basis.dataset}${m.basis.bundle ? ` (${m.basis.bundle})` : ''}, ${m.basis.vessels}척, 선석 ${m.basis.berths}곳`,
    `- 계획 시각: ${m.basis.start} (계획 구간 끝 ${m.basis.end})`,
    '- 후보는 A 기본 · B 상황형(탱크 · 풍속 중 리스크가 큰 쪽 대비) · C 배별 지연 대비이며 A가 기본 선택입니다.')
  return L.join('\n')
}

/** 메일 초안(제목, 본문). 보고서와 같은 모델에서 만든다. */
export function candidateMailDraft(m) {
  const subject = `[울산 부두] ${m.period} 접안 계획안 ${m.confirmed ? '확정' : '검토'} 보고 (${m.sel.label}, 예상 체선료 ${money(m.sel.total)})`
  const body = [
    '안녕하세요.',
    `${m.period} 접안 계획으로 ${m.sel.label}(${m.sel.preset?.label ?? '-'})을 ${m.confirmed ? '확정했습니다' : '선택해 검토 중입니다'}.`,
    '',
    `- 총 예상 체선료: ${money(m.sel.total)} (${m.sel.extra ? `최저안 ${m.best.label}보다 ${money(m.sel.extra)} 많음` : '세 후보 중 가장 낮음'})`,
    `- 비교한 후보: ${m.items.map((it) => `${it.label} ${money(it.total)}`).join(', ')}`,
    `- 공통 리스크: ${m.common.map((c) => c.label).join(', ') || '없음'}`,
    `- 판단근거: ${m.judgment || '(작성 전)'}`,
    '',
    '후보 비교, 선박별 체선료, 바뀐 선박은 첨부 보고서를 참고해 주십시오.',
  ].join('\n')
  return { subject, body }
}
