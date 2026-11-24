// 확정 통보 메일의 받는 부서, 부서별 템플릿, 첨부 규칙 (11-24 실데이터).
//  - 부두 하역팀: 확정안에 배정이 있는 부두(SK 1부두 ~ SK 8부두, 부이, 가스부두)마다 한 곳. 연락처는 lib/teams.js의 가상 값.
//    본문에는 그 부두 일정만 표와 선석별 간트로 넣고, 전 부두 상세는 전체확정일정.xlsx로 붙인다.
//  - 입출항 작업지시자: 전 부두 입출항 일정 + 간트 + xlsx.
//  - 생산팀: 확정안의 탱크 재고 예상(엔진 tanks)과 입고, 출하 선박. 첨부 없음.
//  - 체선료 지불 부서: 체선료 요약 + 접안계획 보고서 첨부.
// 모든 값은 확정 스냅숏(plan)에서 읽는다. 확정 뒤 계획 조건을 고쳐도 메일 내용은 바뀌지 않는다.
import { PIER_TEAMS } from './teams.js'
import { fmt, fmtFull, money, toMin } from './time.js'

export const DEPTS = [
  { id: 'DOCK', label: '부두 하역팀' },
  { id: 'PORT', label: '입출항 작업지시자' },
  { id: 'PROD', label: '생산팀' },
  { id: 'PAY', label: '체선료 지불 부서' },
]

const PIERS = ['1', '2', '3', '4', '5', '6', '7', '8', 'BUOY', 'GAS']

/** 받을 수 있는 곳 전체(연락처는 모두 가상). 실제로 보낼 곳은 groupsFor(plan). */
export const GROUPS = [
  ...PIERS.map((p) => ({ id: `P${p}`, dept: 'DOCK', pier: p, name: PIER_TEAMS[p].team, to: PIER_TEAMS[p].mail, tpl: 'dock', attach: ['xlsx'] })),
  { id: 'PORT', dept: 'PORT', pier: null, name: '입출항 작업 지시 (도선, 예선, 줄잡이)', to: 'port-ops@example.com', tpl: 'port', attach: ['xlsx'] },
  { id: 'PROD', dept: 'PROD', pier: null, name: '생산계획팀', to: 'production@example.com', tpl: 'prod', attach: [] },
  { id: 'PAY', dept: 'PAY', pier: null, name: '해상운송 정산팀', to: 'demurrage-pay@example.com', tpl: 'pay', attach: ['report'] },
]

/** 확정안에 배정이 있는 부두의 하역팀 + 나머지 부서 */
export const groupsFor = (plan) => GROUPS.filter((g) => !g.pier || plan.placements.some((p) => p.pier === g.pier))
export const rowsFor = (plan, g) => (g?.pier ? plan.placements.filter((p) => p.pier === g.pier) : plan.placements)

export const TAGS = [
  ['확정버전', '확정 v1'], ['확정일시', '확정한 시각'], ['받는곳', '받는 부서 이름'], ['담당부두', '부서의 부두'],
  ['일정표', '그 부두 접안 일정 표 (본문에 표로)'], ['작업간트', '그 부두 선석별 간트 (본문에 그림으로)'], ['내일정', '그 부두 접안 일정 (글)'],
  ['입출항일정', '도착, 접안, 이안 시각'], ['입고일정', '입고, 출하 선박'], ['탱크재고', '탱크 묶음별 예상 재고와 안전 범위'],
  ['체선료요약', '예상 체선료 합계와 선박별'], ['판단근거', '확정할 때 적은 이유'], ['주의사항', '야간 접안 등'], ['연락처', '문의처'],
]

export const TEMPLATES = {
  dock: {
    label: '부두 하역팀용',
    subject: '[작업 지시] {{담당부두}} 접안 일정 {{확정버전}}',
    body: `{{받는곳}} 담당자님께,

{{확정일시}}에 접안 계획 {{확정버전}}이 확정되어 {{담당부두}} 작업 일정을 보내드립니다.

■ {{담당부두}} 접안 일정
{{일정표}}

■ {{담당부두}} 선석별 작업 일정
{{작업간트}}

■ 주의사항
{{주의사항}}

전 부두 상세 일정은 첨부한 전체확정일정 파일에 있습니다.
문의: {{연락처}}`,
  },
  port: {
    label: '입출항 작업지시자용',
    subject: '[입출항] 접안 계획 {{확정버전}} 도선, 예선, 줄잡이 배치 요청',
    body: `{{받는곳}} 담당자님께,

접안 계획 {{확정버전}}({{확정일시}} 확정) 기준 입출항 일정입니다. 도선, 예선, 줄잡이 배치를 부탁드립니다.

■ 입출항 일정 (도착 → 접안 → 이안)
{{입출항일정}}

■ 전 부두 선석별 작업 일정
{{작업간트}}

■ 주의사항
{{주의사항}}

첨부: 전체확정일정 (부두별 시트)
문의: {{연락처}}`,
  },
  prod: {
    label: '생산팀용',
    subject: '[생산] 접안 계획 {{확정버전}} 탱크 재고 예상과 입고, 출하 일정',
    body: `{{받는곳}} 담당자님께,

접안 계획 {{확정버전}}이 확정되어 탱크 재고 예상과 입고, 출하 일정을 알려드립니다.

■ 탱크 재고 예상 (확정안 기준, 안전 범위 대비)
{{탱크재고}}

■ 입고, 출하 선박
{{입고일정}}

공정 투입이나 출하 계획이 바뀌면 회신 부탁드립니다.
문의: {{연락처}}`,
  },
  pay: {
    label: '체선료 지불 부서용',
    subject: '[체선료] 접안 계획 {{확정버전}} 예상 체선료 보고',
    body: `{{받는곳}} 담당자님께,

접안 계획 {{확정버전}}({{확정일시}} 확정)의 예상 체선료를 보고드립니다.

■ 예상 체선료
{{체선료요약}}

■ 이 안을 고른 이유
{{판단근거}}

후보 비교, 선박별 체선료, 바뀐 선박과 남은 리스크는 첨부한 접안계획 보고서에 있습니다.
계약 조건은 가상 값이라 금액은 후보끼리 비교하는 용도입니다.
문의: {{연락처}}`,
  },
}

const SCHEDULER = '선박 스케줄러 052-000-0000 (가상)'
const t = (n) => (n === null || n === undefined ? '-' : `${Math.round(n).toLocaleString()}t`)

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
      [`데이터: ${plan.scenName ?? '-'}${plan.bundle ? ` (${plan.bundle})` : ''}`],
      ['배정과 시각은 팀 엔진(CP-SAT) 계산 결과입니다. 하역팀 연락처는 시연용 가상 값입니다.'],
    ] },
  ]
}

/** 탱크 묶음별 예상 재고: 엔진 tanks의 시간별 재고에서 최저, 최고를 찾아 안전 범위와 비교한다. */
export function tankLines(tanks = []) {
  return tanks.map((k) => {
    const lv = k.levels_t ?? []
    if (!lv.length) return `- ${k.tank}: 재고 자료 없음`
    const t0 = toMin(k.start)
    let iMin = 0, iMax = 0
    lv.forEach((x, i) => { if (x < lv[iMin]) iMin = i; if (x > lv[iMax]) iMax = i })
    const at = (i) => fmt(t0 + i * (k.step_min ?? 60))
    const under = lv.findIndex((x) => x < k.safe_min_t)
    const over = lv.findIndex((x) => x > k.safe_max_t)
    const verdict = under < 0 && over < 0 ? '안전 범위 안' : [under >= 0 && `${at(under)}부터 안전 하한 아래`, over >= 0 && `${at(over)}부터 안전 상한 위`].filter(Boolean).join(', ')
    return `- ${k.tank} (탱크 ${k.tanks}기, 용량 ${t(k.capacity_t)}): 예상 최저 ${t(lv[iMin])} (${at(iMin)}), 최고 ${t(lv[iMax])} (${at(iMax)}), 안전 범위 ${t(k.safe_min_t)} ~ ${t(k.safe_max_t)} → ${verdict}`
  })
}

/** {{태그}}를 부서에 맞는 내용으로 바꾸는 함수. 값은 모두 확정 스냅숏에서 읽는다. */
export function makeFill({ plan }) {
  return (text, g) => {
    const mine = rowsFor(plan, g)
    const row = (p) => `- ${fmt(p.etb)} 접안 → ${fmt(p.etu)} 이안  ${p.name}  ${p.berth}  (${p.product}, ${p.dir}, ${t(p.ton)})`
    const nightRows = mine.filter((p) => p.night)
    const team = g.pier ? PIER_TEAMS[g.pier] : null
    const dem = plan.placements.filter((p) => p.dem > 0).sort((a, b) => b.dem - a.dem)
    const vsBase = plan.baselineTotal ? Math.round(((plan.total - plan.baselineTotal) / plan.baselineTotal) * 1000) / 10 : null
    const vals = {
      확정버전: `v${plan.no}`, 확정일시: plan.at, 받는곳: g.name,
      담당부두: g.pier ? mine[0]?.pierName ?? g.name : '전 부두',
      내일정: mine.length ? mine.map(row).join('\n') : '- 이번 계획에서 배정된 선박 없음',
      일정표: `[[표:${g.id}]]`,
      작업간트: `[[간트:${g.id}]]`,
      입출항일정: plan.placements.map((p, i) => `${i + 1}. ${p.name}  ${p.berth}  도착 ${fmt(p.eta)} → 접안 ${fmt(p.etb)} → 이안 ${fmt(p.etu)}${p.night ? '  (야간 접안)' : ''}`).join('\n'),
      입고일정: plan.placements.map((p) => `- ${fmt(p.etb)} ~ ${fmt(p.etu)}  ${p.in ? '입고' : '출하'}  ${p.name}  ${p.product} ${t(p.ton)}  (${p.berth})`).join('\n'),
      탱크재고: plan.tanks?.length ? tankLines(plan.tanks).join('\n') : '- 엔진 결과에 탱크 자료 없음',
      체선료요약: [
        `- 합계 ${money(plan.total)} (${plan.label}${plan.preset ? `, ${plan.preset.label}` : ''})`,
        ...(plan.baselineTotal !== null && plan.baselineTotal !== undefined ? [`- 실제 계획 ${money(plan.baselineTotal)} 대비 ${vsBase > 0 ? '+' : vsBase < 0 ? '−' : ''}${Math.abs(vsBase)}%`] : []),
        ...(dem.length ? [`- 체선이 생기는 선박 ${dem.length}척`, ...dem.map((p) => `  ${p.name}  ${p.berth}  ${money(p.dem)}`)] : ['- 체선이 생기는 선박 없음']),
      ].join('\n'),
      판단근거: plan.reason || '(확정 사유 없음)',
      주의사항: nightRows.length ? [`- 야간 접안 ${nightRows.length}척: 도선, 계류 인력 미리 배치`, ...nightRows.map((p) => `  ${fmt(p.etb)} ${p.name} (${p.berth})`)].join('\n') : '- 특이사항 없음',
      연락처: team ? `${team.team} ${team.lead}, ${team.tel}` : SCHEDULER,
    }
    return text.replace(/\{\{(.+?)\}\}/g, (m, k) => vals[k] ?? m)
  }
}

