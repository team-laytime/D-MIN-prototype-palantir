// 확정 통보 메일의 받는 곳, 부서별 템플릿, 첨부 규칙.
// 11-25 개편: 업무에서 바로 쓰는 짧은 메일. 그림과 표가 먼저, 글은 주의사항과 요청만.
//  - 부두 하역팀: 그 부두 간트 → 접안 일정 표 → 주의사항, 기타. 첨부 전체확정일정.xlsx
//  - 입출항 작업지시자: 전 부두 간트 → 24시간 주의 선박 표(체선, 사용 불가 구간) → 주의사항(야간 도선 제한, 야간 접안 건수). 첨부 xlsx
//  - 생산계획팀: 탱크 묶음(제품)별 재고 흐름 그래프, 생산계획, 입고와 출하 선박
//  - 체선료 지불 부서: 체선 선박 브리핑 표 + 고른 이유, 접안계획 보고서 첨부
// 본문의 {{태그}}는 화면에서는 이름표(칩)로만 보이고, 미리보기와 보낼 때 실제 내용으로 바뀐다.
// 모든 값은 확정 스냅숏(plan)에서 읽는다. 확정 뒤 계획 조건을 고쳐도 메일 내용은 바뀌지 않는다.
import { PIER_TEAMS } from './teams.js'
import { NOW, fmt, fmtDur, fmtFull, money } from './time.js'

export const DEPTS = [
  { id: 'DOCK', label: '부두 하역팀' },
  { id: 'PORT', label: '입출항 작업지시자' },
  { id: 'PROD', label: '생산계획팀' },
  { id: 'PAY', label: '체선료 지불 부서' },
]

const PIERS = ['1', '2', '3', '4', '5', '6', '7', '8', 'BUOY', 'GAS']
// 11-25 생산계획팀은 부두처럼 제품(탱크 묶음)마다 따로 받는다
const TANKS = ['원유', '반입 원료', '양방향', '석유제품 반출', '화학 반출', '윤활유 반출', '특수 반출']
export const WINDOW_MIN = 24 * 60 // 하역팀, 입출항 메일은 현재부터 24시간만

/** 받을 수 있는 곳 전체. 실제로 보낼 곳은 groupsFor(plan). */
export const GROUPS = [
  ...PIERS.map((p) => ({ id: `P${p}`, dept: 'DOCK', pier: p, name: PIER_TEAMS[p].team, to: PIER_TEAMS[p].mail, tpl: 'dock', attach: ['xlsx'] })),
  { id: 'PORT', dept: 'PORT', pier: null, name: '입출항 작업 지시 (도선, 예선, 줄잡이)', to: 'port-ops@example.com', tpl: 'port', attach: ['xlsx'] },
  ...TANKS.map((t, i) => ({ id: `T${i}`, dept: 'PROD', pier: null, tank: t, side: t, name: `생산계획팀 (${t})`, to: 'production@example.com', tpl: 'prod', attach: [] })),
  { id: 'PAY', dept: 'PAY', pier: null, name: '해상운송 정산팀', to: 'demurrage-pay@example.com', tpl: 'pay', attach: ['report'] },
]

/** 확정안에 배정이 있는 부두의 하역팀 + 나머지 부서 */
export const groupsFor = (plan) => GROUPS.filter((g) => (g.pier ? plan.placements.some((p) => p.pier === g.pier) : g.tank ? (plan.tanks ?? []).some((k) => k.tank === g.tank) : true))
export const rowsFor = (plan, g) => (g?.pier ? plan.placements.filter((p) => p.pier === g.pier) : g?.tank ? plan.placements.filter((p) => p.tank === g.tank) : plan.placements)

/** 현재부터 24시간 안에 작업이 걸치는 배 중 주의할 것이 있는 배와 그 이유 */
export function riskRows(plan, g) {
  const end = NOW + WINDOW_MIN
  const all = plan.placements
  const rows = rowsFor(plan, g).filter((p) => p.etb < end && p.etu > NOW)
  const prevOf = (p) => all.filter((x) => x.bid === p.bid && x.etu <= p.etb).sort((a, b) => b.etu - a.etu)[0]
  return rows.map((p) => {
    const why = []
    if (p.dem > 0) why.push(`체선 ${p.demMin != null ? fmtDur(p.demMin) : ''}`.trim())
    // 앞 배 이안 뒤 간격은 엔진 전환 시간(1~2.5시간) 안이면 정상이라 넣지 않는다. 그보다 짧을 때(고정 배 등)만
    const prev = prevOf(p)
    if (prev && p.etb - prev.etu < 60) why.push(`앞 배 이안 뒤 ${fmtDur(Math.max(0, p.etb - prev.etu))}`)
    if ((plan.blocks ?? []).some((b) => (!b.berths || b.berths.includes(p.bid)) && b.start < p.etu && b.end > p.etb)) why.push('사용 불가 구간과 겹침')
    return { p, why }
  }).filter((r) => r.why.length)
}

// 11-26 그림 · 표 · 긴 글은 본문에 한 번만 (두 번 넣으면 같은 그림 · 표가 반복된다). 이름 · 날짜 같은 짧은 값은 여러 번 써도 된다
export const ONCE_TAGS = new Set(['작업간트', '일정표', '입출항표', '탱크현황', '체선선박', '판단근거', '주의사항', '연락처'])

/** 태그: [이름, 설명]. 화면에는 이름만 칩으로 보인다. */
export const TAGS = [
  ['확정버전', '확정 v1'], ['확정일시', '확정한 시각'], ['받는곳', '받는 부서 이름'], ['담당부두', '부서의 부두'], ['담당제품', '생산계획팀이 맡은 제품(탱크 묶음)'],
  ['작업간트', '현재부터 24시간 선석별 간트 (그림)'], ['일정표', '현재부터 24시간, 주의할 선박 표'], ['입출항표', '현재부터 24시간, 주의할 입출항 표'],
  ['탱크현황', '그 제품 탱크의 재고 그래프와 생산계획, 입고와 출하'], ['체선선박', '체선이 생기는 선박 요약 표'],
  ['판단근거', '확정할 때 적은 이유'], ['주의사항', '야간 접안, 야간 도선 제한, 연속 접안, 사용 불가 구간 건수'], ['연락처', '문의처'],
]

export const TEMPLATES = {
  dock: {
    label: '부두 하역팀용',
    subject: '[{{담당부두}}] 접안 작업 일정 안내 ({{확정버전}})',
    body: `{{받는곳}} 담당자님,

{{확정일시}} 확정된 접안 계획 {{확정버전}} 기준 {{담당부두}}의 앞으로 24시간 작업 일정입니다.

{{작업간트}}

{{일정표}}

■ 주의사항
{{주의사항}}

■ 기타
- 전 부두 일정은 첨부한 전체확정일정 파일을 참고해 주세요.
- 작업이 늦어지거나 일정 변경이 필요하면 바로 회신 부탁드립니다.

{{연락처}}`,
  },
  port: {
    label: '입출항 작업지시자용',
    subject: '[입출항] 도선, 예선, 줄잡이 배치 요청 ({{확정버전}})',
    body: `{{받는곳}} 담당자님,

접안 계획 {{확정버전}}({{확정일시}} 확정) 기준 앞으로 24시간 입출항 일정입니다. 도선, 예선, 줄잡이 배치를 부탁드립니다.

{{작업간트}}

{{입출항표}}

■ 주의사항
{{주의사항}}

{{연락처}}`,
  },
  prod: {
    label: '생산계획팀용',
    subject: '[생산] {{담당제품}} 탱크 재고 예상과 입고, 출하 일정 ({{확정버전}})',
    body: `{{받는곳}} 담당자님,

접안 계획 {{확정버전}} 확정에 따라 {{담당제품}} 탱크 재고 예상과 입고, 출하 일정을 공유드립니다.

{{탱크현황}}

공정 투입이나 출하 계획이 바뀌면 회신 부탁드립니다.

{{연락처}}`,
  },
  pay: {
    label: '체선료 지불 부서용',
    subject: '[체선료] 예상 체선료 보고 ({{확정버전}})',
    body: `{{받는곳}} 담당자님,

접안 계획 {{확정버전}}({{확정일시}} 확정)의 예상 체선료를 보고드립니다.

{{체선선박}}

■ 이 안을 고른 이유
{{판단근거}}

후보 비교와 선박별 상세 내역은 첨부한 접안계획 보고서를 참고해 주세요.

{{연락처}}`,
  },
}

const SIGN = '선박 스케줄러 드림\n문의 052-000-0000'

/** 부서별 첨부 파일. kind: xlsx(전 부두 상세 일정) | report(접안계획 보고서) */
export function attachmentsFor(g, plan) {
  return g.attach.map((k) => (k === 'xlsx'
    ? { kind: 'xlsx', name: `전체확정일정_v${plan.no}.xlsx` }
    : { kind: 'report', name: `접안계획보고서_v${plan.no}.pdf` }))
}

/** 전체확정일정.xlsx의 시트: 「전체」 + 부두마다 한 장 + 「안내」 */
export function scheduleSheets(plan) {
  const head = ['순서', '부두', '선석', '선박', '호출부호', '화물', '구분', '물량(t)', 'DWT', '도착(ETA)', '접안(ETB)', '이안(ETU)', '접안 시간(h)', '대기(h)', '야간 접안']
  const widths = [6, 10, 14, 16, 10, 12, 9, 10, 9, 17, 17, 17, 11, 9, 9]
  const row = (p, i) => [
    i + 1, p.pierName ?? '', p.berth, p.name, p.callSign ?? '', p.product, p.dir, p.ton ?? '', p.dwt ?? '',
    fmtFull(p.eta), fmtFull(p.etb), fmtFull(p.etu), Math.round((p.etu - p.etb) / 6) / 10, Math.round(Math.max(0, p.etb - p.eta) / 6) / 10, p.night ? '예' : '',
  ]
  const piers = PIERS.filter((pier) => plan.placements.some((p) => p.pier === pier))
  return [
    { name: '전체', widths, rows: [head, ...plan.placements.map(row)] },
    ...piers.map((pier) => {
      const ps = plan.placements.filter((p) => p.pier === pier)
      return { name: ps[0].pierName ?? pier, widths, rows: [head, ...ps.map(row)] }
    }),
    { name: '안내', widths: [90], rows: [
      ['안내'],
      [`접안 계획 v${plan.no} (${plan.label}${plan.preset ? `, ${plan.preset.label}` : ''}), ${plan.at} 확정, ${plan.who}`],
      [`데이터: ${plan.scenName ?? '-'}`],
    ] },
  ]
}

/** 야간 도선 제한 대상인가 (팀 엔진 step2_night_pilot.is_restricted와 같은 규칙) */
export const nightPilotHit = (p, rule) => Boolean(rule) && p.grt != null &&
  (p.grt >= rule.grt_always || (p.grt >= rule.grt_min && p.biz === 'IM' && p.draft != null && p.draft >= rule.draft_min))

/** 주의사항: 부서마다 필요한 것만, 많아도 몇 줄 */

function cautions(plan, g, mine) {
  const out = []
  // 11-25 야간 접안, 야간 도선 제한은 표에는 넣지 않고 주의사항에 건수로만 적는다
  const night = mine.filter((p) => p.night)
  if (g.dept === 'PORT') {
    const rule = plan.nightPilot
    const np = plan.placements.filter((p) => nightPilotHit(p, rule))
    if (np.length) out.push([`- 야간 도선 제한 대상 ${np.length}척 (${rule.night_start}~${rule.release} 접안 불가)`, ...np.map((p) => `    ${p.name}`)].join('\n'))
    if (night.length) out.push(`- 야간 접안 ${night.length}척`)
    const blocks = plan.blocks ?? []
    if (blocks.length) out.push([`- 사용 불가 구간 ${blocks.length}건`, ...blocks.map((b) => `    ${fmt(b.start)} ~ ${fmt(b.end)}`)].join('\n'))
  } else {
    if (night.length) out.push(`- 야간 접안 ${night.length}척, 계류 인력을 미리 배치해 주세요`)
    // 같은 선석에서 이안 뒤 2시간 안에 다음 배가 붙는 곳: 건수와 가장 짧은 간격만 한 줄로
    const tight = []
    const byBerth = {}
    for (const p of mine) (byBerth[p.bid] ??= []).push(p)
    for (const list of Object.values(byBerth)) {
      list.sort((a, b) => a.etb - b.etb)
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].etb - list[i - 1].etu
        if (gap < 120) tight.push({ gap: Math.max(0, gap), p: list[i] })
      }
    }
    if (tight.length) {
      const m = tight.reduce((a, b) => (b.gap < a.gap ? b : a))
      out.push(`- 이안 뒤 2시간 안에 다음 배가 붙는 곳 ${tight.length}건\n    가장 짧은 간격 ${fmtDur(m.gap)}: ${m.p.berth} ${fmt(m.p.etb)} ${m.p.name}`)
    }
    const bids = new Set(mine.map((p) => p.bid))
    const blocks = (plan.blocks ?? []).filter((b) => !b.berths || b.berths.some((x) => bids.has(x)))
    if (blocks.length) out.push([`- 사용 불가 구간 ${blocks.length}건`, ...blocks.map((b) => `    ${fmt(b.start)} ~ ${fmt(b.end)}`)].join('\n'))
  }
  return out.length ? out.join('\n\n') : '- 특이사항 없음'
}

/** {{태그}}를 부서에 맞는 내용으로 바꾸는 함수. 그림과 표 자리는 [[종류:그룹]] 표시로 두고 MailBody가 그린다. */
export function makeFill({ plan }) {
  return (text, g) => {
    const mine = rowsFor(plan, g)
    const team = g.pier ? PIER_TEAMS[g.pier] : null
    const vals = {
      확정버전: `v${plan.no}`, 확정일시: plan.at.slice(0, 16), 받는곳: g.name,
      담당부두: g.pier ? mine[0]?.pierName ?? g.name : '전 부두',
      담당제품: g.tank ?? '전 제품',
      작업간트: `[[간트:${g.id}]]`,
      일정표: `[[표:${g.id}]]`,
      입출항표: `[[입출항:${g.id}]]`,
      탱크현황: `[[탱크:${g.id}]]`,
      체선선박: `[[체선:${g.id}]]`,
      판단근거: plan.reason || '-',
      주의사항: cautions(plan, g, mine),
      연락처: team ? `${SIGN}\n(${team.team} ${team.lead} ${team.tel})` : SIGN,
    }
    return text.replace(/\{\{(.+?)\}\}/g, (m, k) => vals[k] ?? m)
  }
}

/** 탱크 묶음별 요약 (복사용 글) */
export function tankLines(plan, tank) {
  const prod = Object.fromEntries((plan.production ?? []).map((t) => [t.name, t.weeks]))
  return (plan.tanks ?? []).filter((k) => !tank || k.tank === tank).map((k) => {
    const lv = k.levels_t ?? []
    const pct = (x) => `${Math.round((x / k.capacity_t) * 100)}%`
    const w = prod[k.tank]?.[0]?.rate
    const rate = w == null ? '' : w >= 0 ? `, 생산 ${Math.round(w).toLocaleString()} t/h` : `, 공정 투입 ${Math.round(-w).toLocaleString()} t/h`
    return `- ${k.tank} (탱크 ${k.tanks}기): 현재 ${pct(k.initial_t)}, 기간 중 ${lv.length ? `${pct(Math.min(...lv))} ~ ${pct(Math.max(...lv))}` : '-'}${rate}`
  })
}
export const demLines = (plan) => {
  const dem = plan.placements.filter((p) => p.dem > 0).sort((a, b) => b.dem - a.dem)
  return [`예상 체선료 합계 ${money(plan.total)}, 체선 선박 ${dem.length}척`, ...dem.map((p) => `- ${p.name} (${p.berth}) ${p.demMin != null ? fmtDur(p.demMin) : ''} ${money(p.dem)}`)]
}
