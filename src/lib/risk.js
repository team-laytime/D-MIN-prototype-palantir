// 11-25 팀 리스크 모델(berth_risk) 응답을 화면 말로 바꾼다. 판정 규칙은 엔진 저장소 API.md §1.3.
// 한 줄 문구 규칙은 D-MIN-optimization-front(js/app.js label())와 같다. 숫자는 evidence 그대로 쓴다.
import { fmt, money, toMin } from './time.js'

export const SEV = { HIGH: { tone: 'high', text: '높음' }, MEDIUM: { tone: 'mid', text: '중간' }, LOW: { tone: 'low', text: '낮음' } }
export const KIND = { WORK_GAP: '작업 간격', WEATHER: '기상', TANK: '탱크 재고', LAYTIME: '정박시간', RATE_BASIS: '하역 속도 근거', BERTH_FIT: '부두 한도', DELAY: '지연 시 조건 위반' }
/** 확정 전에 확인할 리스크 심각도. 낮음은 목록에만 둔다 */
export const CHECK_SEV = ['HIGH', 'MEDIUM']

const t = (iso) => fmt(toMin(iso))
const perHour = (r) => (r.cost_per_hour ? ` · 시간당 ${money(Math.round(r.cost_per_hour.amount * 100))}` : '')

/** 리스크 한 줄. name(vid) → 선박명 */
export function riskLabel(r, name) {
  const e = r.evidence ?? {}
  const [a, b] = (r.vessel_ids ?? []).map(name)
  const delay = {
    TANK: () => `${r.tank} ${e.side === 'SHORT' ? '하한' : '상한'} 벗어남 (${t(r.start)}~)`,
    REQUIREMENT: () => `${e.requirement} ${e.amount?.toLocaleString()}t 부족`,
    FIX: () => `고정 ${b ?? ''} 접안 ${e.amount}h 밀림`,
  }
  switch (r.kind) {
    case 'WORK_GAP': return `${r.berth} ${a}${e.prev_working ? '(작업 중)' : ''} → ${b} 간격 ${e.gap_h}h, 필요 ${e.required_h}h${perHour(r)}`
    case 'WEATHER': return `${r.berth} ${a} 접안 중 ${(e.causes ?? []).join(', ')} ${e.max_wind_ms}m/s (${t(r.start)}~)`
    case 'TANK': return e.gap_pct != null
      ? `${r.tank} ${e.side === 'SHORT' ? '최저' : '최고'} ${e.worst_pct}%, ${e.gap_pct < 0 ? `마지노선 ${e.limit_pct}% 벗어남` : `마지노선 ${e.limit_pct}%까지 ${e.gap_pct}%p`} (${t(r.start)}~)`
      : `${r.tank} ${e.side === 'SHORT' ? '하한' : '상한'} ${r.severity === 'HIGH' ? '벗어남' : '근접'} (${t(r.start)}~)`
    case 'LAYTIME': return `${a} 정박시간 여유 ${e.slack_h}h${perHour(r)}`
    case 'DELAY': return `${a} ${e.late_h}h 늦으면 ${delay[e.condition]?.() ?? '조건 위반'}`
    case 'RATE_BASIS': return `${r.berth} ${a} 하역 속도 다른 배 평균 (${e.samples}건)`
    default: return (r.vessel_ids ?? []).reduce((s, id) => s.replaceAll(id, name(id)), r.title)
  }
}

/** 누르면 간트에서 짚을 배: 작업 간격은 밀리는 뒤 배 */
export const riskShip = (r) => (r.kind === 'WORK_GAP' ? r.vessel_ids?.[1] : r.vessel_ids?.[0]) ?? null

/** 화면 순서: 심각도 → 지연 시 조건 위반 먼저 → 응답 순서(시작 시각) */
const RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 }
export const sortRisks = (list) => [...list].sort((x, y) => RANK[x.severity] - RANK[y.severity] || (x.kind === 'DELAY' ? 0 : 1) - (y.kind === 'DELAY' ? 0 : 1))
export const checkRisks = (data) => sortRisks((data?.risks ?? []).filter((r) => CHECK_SEV.includes(r.severity)))

