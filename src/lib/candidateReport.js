// 후보안 비교 보고서. 화면(React)과 마크다운 내려받기가 같은 모델을 쓴다.
// 금액은 엔진 계산값(센트)을 그대로 쓰고, 문장 속 금액은 화면에서 계산 결과와 대조한다.
import { risks } from './engine.js'
import { fmt, fmtDur, money } from './time.js'
import { reportPeriod } from './report.js'

const ACTIVE = (r) => r.state !== '해당 없음'
const pct = (part, whole) => (whole ? ((part / whole) * 100).toFixed(1) : '0.0')

/**
 * @param {{ result, scen, selId, judgment, plan }} args
 *   selId: 선택한 후보 id('A'|'B'|'C'), judgment: 숙련자 판단근거, plan: 적용 중인 확정 계획(같은 입력 버전일 때만) 또는 null
 */
export function buildCandidateReport({ result, scen, selId, judgment, plan }) {
  const fcfs = result.fcfs
  const cands = result.candidates
  const sel = cands.find((c) => c.id === selId) ?? cands[0]
  const vessels = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  const berth = (id) => scen.berths.find((b) => b.id === id)

  const analyse = (sim) => {
    const rs = risks(sim, scen)
    const demVessels = sim.placements.filter((p) => p.dem.cents > 0).sort((a, b) => b.dem.cents - a.dem.cents)
      .map((p) => ({ vid: p.vid, name: vessels[p.vid].name, berth: berth(p.bid).name, excessMin: p.dem.excessMin, cents: p.dem.cents, rateUsd: vessels[p.vid].contract.rateUsd }))
    const longestWait = sim.placements.reduce((m, p) => (p.waitMin > m.waitMin ? p : m), sim.placements[0])
    return {
      id: sim.id, label: sim.label, total: sim.total,
      saving: fcfs.total - sim.total, savingPct: pct(fcfs.total - sim.total, fcfs.total),
      changed: sim.changed.map((id) => vessels[id].name),
      demVessels,
      longestWait: { name: vessels[longestWait.vid].name, min: longestWait.waitMin },
      risks: rs,
      active: rs.filter(ACTIVE),
      schedule: [...sim.placements].sort((a, b) => a.etb - b.etb).map((p) => ({
        name: vessels[p.vid].name, berth: berth(p.bid).name, eta: vessels[p.vid].eta, etb: p.etb, etu: p.etu, cents: p.dem.cents,
      })),
    }
  }
  const base = analyse(fcfs)
  const items = cands.map(analyse)

  // 공통 리스크: 세 후보 모두에서 '해당' 또는 '판단 불가'인 항목. 어느 안을 골라도 남는다.
  const keys = items[0]?.risks.map((r) => r.key) ?? []
  const common = keys
    .filter((k) => items.every((it) => ACTIVE(it.risks.find((r) => r.key === k))))
    .map((k) => {
      const per = items.map((it) => ({ id: it.id, label: it.label, risk: it.risks.find((r) => r.key === k) }))
      return { key: k, label: per[0].risk.label, per, alternative: per[0].risk.alternative, caution: per[0].risk.caution }
    })
  // 후보마다 갈리는 리스크: 일부 후보에서만 남는다. 선택 이유를 설명할 때 쓰는 차이.
  const differing = keys
    .filter((k) => !common.some((c) => c.key === k) && items.some((it) => ACTIVE(it.risks.find((r) => r.key === k))))
    .map((k) => ({ key: k, label: items[0].risks.find((r) => r.key === k).label, per: items.map((it) => ({ id: it.id, label: it.label, state: it.risks.find((r) => r.key === k).state })) }))

  // 차트용: 선박별 체선료(기준안 + 후보 3개).
  const vesselOrder = [...scen.vessels].sort((a, b) => a.eta - b.eta)
  const perVessel = vesselOrder.map((v) => ({
    name: v.name,
    values: [fcfs, ...cands].map((s) => ({ id: s.id, cents: s.placements.find((p) => p.vid === v.id)?.dem.cents ?? 0 })),
  }))

  return {
    period: reportPeriod(sel),
    status: plan ? `확정 v${plan.planNo}` : '검토 중',
    confirmed: Boolean(plan),
    sel: items.find((it) => it.id === sel.id),
    judgment: (judgment ?? '').trim(),
    base, items, common, differing, perVessel,
  }
}


export function candidateReportMarkdown(m) {
  const L = []
  L.push(`# 울산 CLX 접안 계획 후보안 비교 보고 (${m.period})`, '', `${m.status} · 담당자 검토용 · 가상 데이터 · 의사결정 보조용`, '')
  L.push('## 1. 결론', `${m.sel.label}을 ${m.confirmed ? '확정한' : '선택한'} 안으로 보고합니다. 총 예상 체선료는 ${money(m.sel.total)}이며, 도착순 기준안 ${money(m.base.total)} 대비 ${money(m.sel.saving)}(${m.sel.savingPct}%) 적습니다.`, '')
  L.push('### 숙련자 판단근거', m.judgment || '(아직 작성하지 않음)', '')
  L.push('## 2. 후보안 비교', '| 안 | 총 예상 체선료 | 기준안 대비 | 절감률 | 변경 선박 | 체선 발생 | 남은 리스크 |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const it of [m.base, ...m.items]) {
    L.push(`| ${it.label}${it.id === m.sel.id ? ' (선택)' : ''} | ${money(it.total)} | ${it.id === 'FCFS' ? '-' : money(it.total - m.base.total)} | ${it.id === 'FCFS' ? '-' : `${it.savingPct}%`} | ${it.changed.length}척 | ${it.demVessels.length}척 | ${it.active.length}건 |`)
  }
  L.push('', '### 선박별 예상 체선료', `| 선박 | ${['기준안', ...m.items.map((it) => it.label)].join(' | ')} |`, `| --- | ${m.items.map(() => '---:').concat('---:').join(' | ')} |`)
  for (const row of m.perVessel) L.push(`| ${row.name} | ${row.values.map((v) => money(v.cents)).join(' | ')} |`)
  L.push('', '## 3. 후보별 분석')
  for (const it of m.items) {
    L.push('', `### ${it.label}${it.id === m.sel.id ? ' (선택)' : ''}`,
      `- 총 예상 체선료 ${money(it.total)} · 기준안 대비 ${money(it.saving)}(${it.savingPct}%) 절감`,
      `- 기준안과 달라진 선박: ${it.changed.join(', ') || '없음'}`,
      `- 가장 긴 대기: ${it.longestWait.name} ${fmtDur(it.longestWait.min)}`)
    L.push(`- 체선 발생: ${it.demVessels.length ? it.demVessels.map((d) => `${d.name}(${d.berth}, 초과 ${fmtDur(d.excessMin)}, ${money(d.cents)})`).join(', ') : '없음'}`)
    L.push(`- 남은 리스크: ${it.active.length ? it.active.map((r) => `${r.label}(${r.state}) ${r.evidence}`).join(' / ') : '없음'}`)
  }
  L.push('', '## 4. 공통 리스크', '어느 후보를 골라도 남는 리스크입니다.')
  if (!m.common.length) L.push('- 없음')
  for (const c of m.common) {
    L.push(`- ${c.label}: ${c.per.map((p) => `${p.label} ${p.risk.state}`).join(' · ')}. 대안: ${c.alternative}${c.caution !== '-' ? ` 주의: ${c.caution}` : ''}`)
  }
  if (m.differing.length) {
    L.push('', '### 후보마다 갈리는 리스크')
    for (const d of m.differing) L.push(`- ${d.label}: ${d.per.map((p) => `${p.label} ${p.state}`).join(' · ')}`)
  }
  L.push('', `## 5. ${m.sel.label} 선박별 일정`, '| 선박 | 부두 | 도착 | 접안 | 작업 종료 | 예상 체선료 |', '| --- | --- | --- | --- | --- | ---: |')
  for (const s of m.sel.schedule) L.push(`| ${s.name} | ${s.berth} | ${fmt(s.eta)} | ${fmt(s.etb)} | ${fmt(s.etu)} | ${money(s.cents)} |`)
  L.push('', '## 계산 기준', '- 체선료 = 초과 시간 ÷ 24시간 × 하루 체선료, 선박별 센트 단위 한 번 반올림(HALF_UP)', '- 정박시간 개시·기상 공제는 선박별 계약 조항을 따름', '- 기준안은 비교용 도착순 배치이며 현행 실적이 아님')
  return L.join('\n')
}

/** 메일 초안(제목·본문). 보고서와 같은 모델에서 만든다. */
export function candidateMailDraft(m) {
  const subject = `[울산 CLX] ${m.period} 접안 계획안 ${m.confirmed ? '확정' : '검토'} 보고 (${m.sel.label}, 예상 체선료 ${money(m.sel.total)})`
  const body = [
    '안녕하세요.',
    `${m.period} 울산 터미널 접안 계획으로 ${m.sel.label}을 ${m.confirmed ? '확정했습니다' : '선택해 검토 중입니다'}.`,
    '',
    `- 총 예상 체선료: ${money(m.sel.total)} (도착순 기준안 ${money(m.base.total)} 대비 ${money(m.sel.saving)}, ${m.sel.savingPct}% 감소)`,
    `- 비교한 후보: ${m.items.map((it) => `${it.label} ${money(it.total)}`).join(', ')}`,
    `- 공통 리스크: ${m.common.map((c) => c.label).join(', ') || '없음'}`,
    `- 판단근거: ${m.judgment || '(작성 전)'}`,
    '',
    '후보별 분석과 차트는 첨부 보고서를 참고해 주십시오.',
    '',
    '※ 가상 데이터 기반 의사결정 보조 자료이며, 담당자 검토용 초안입니다.',
  ].join('\n')
  return { subject, body }
}
