import { toMin } from './time.js'
// 11-25 후보 구성: A 기본 · B 상황형 · C 배별 지연 대비. (11-26 데이터셋에 계산 결과를 넣지 않으므로 규칙은 이 파일 한 곳)
//   B = A 계획의 탱크 등급과 예보 풍속 등급 중 높은 쪽(같으면 탱크). 둘 다 없으면 배별 지연 대비 절반.
//   탱크 등급(기준 시각 ~ +72시간): 재고가 마지노선 20/80%까지 2%p 안 높음 · 3.5%p 안 중간 · 5%p 안 낮음 (리스크 모델과 같은 기준)
//   풍속 등급: 하역 중단 기준까지 여유가 예보 오차 σ의 1배 안 높음 · 2배 안 중간 · 3배 안 낮음
export const SIGMA_MS = 2 // 예보 풍속 오차 σ (m/s), 사용자 설정(11-25, 1 → 2)
const TANK_LIMIT = [20, 80]
const TANK_BANDS = [[3, 2], [2, 3.5], [1, 5]] // 11-26 사용자 결정 (전 1 · 4 · 7)
export const GRADE = ['없음', '낮음', '중간', '높음']
const DEF_WIND = { '#1~2·GAS': [18, 20], '#3~7': [14, 21] }
const WIND_NAME = { '#1~2·GAS': '1~2부두·가스부두', '#3~7': '3~8부두·부이' } // 엔진 풍속 묶음 키 → 화면 이름

// 11-26 탱크는 기준 시각부터 72시간 안만 본다 (풍속 · 화면 · 리스크 모델 tank_horizon_h와 같은 구간). 그 뒤 재고는 이번 계획에 없는 배가 정한다
export const TANK_HORIZON_H = 72
/** 엔진 탱크 곡선에서 판정 구간(분 단위 end까지)의 재고만 */
export const levelsUntil = (t, end) => (end == null ? (t.levels_t ?? []) : (t.levels_t ?? []).filter((_, i) => toMin(t.start) + i * t.step_min <= end))
const horizonEnd = (sim) => (sim?.req?.start ? toMin(sim.req.start) + TANK_HORIZON_H * 60 : null)

export function tankGrade(sim, end = horizonEnd(sim)) {
  let best = { g: 0, d: null }
  for (const t of sim?.tanks ?? []) {
    for (const lv of levelsUntil(t, end)) {
      const pct = (lv / t.capacity_t) * 100
      const gap = Math.round(Math.min(pct - TANK_LIMIT[0], TANK_LIMIT[1] - pct) * 10) / 10
      const g = TANK_BANDS.find(([, w]) => gap < w)?.[0] ?? 0
      if (g > best.g || (g && g === best.g && gap < best.d.gap)) best = { g, d: { tank: t.tank, gap, pct: Math.round(pct * 10) / 10 } }
    }
  }
  return { g: best.g, text: best.d ? `${best.d.tank} 재고 ${best.d.pct}%, 마지노선까지 ${best.d.gap}%p` : '탱크 재고가 마지노선에서 멀음' }
}

/** 계획 기간 예보 최대 풍속 vs 하역 중단 기준(계획 조건에서 고친 값 포함) */
export function windGrade(scen) {
  const th = scen.params.weather?.thresholds_ms ?? scen.windDefault ?? DEF_WIND
  const ws = (scen.wind ?? []).filter((w) => w.t >= scen.window.start && w.t <= scen.window.end && w.ms != null).map((w) => w.ms)
  if (!ws.length) return { g: 0, text: '예보 없음', th }
  const top = Math.max(...ws)
  const [margin, grp] = Object.entries(th).map(([k, v]) => [v[0] - top, k]).sort((a, b) => a[0] - b[0])[0]
  const g = margin < SIGMA_MS ? 3 : margin < 2 * SIGMA_MS ? 2 : margin < 3 * SIGMA_MS ? 1 : 0
  return { g, text: `예보 최대 ${top.toFixed(1)} m/s, ${WIND_NAME[grp] ?? grp} 하역 중단 기준 ${th[grp][0]} m/s까지 ${margin.toFixed(1)} m/s (σ ${SIGMA_MS})`, th }
}

export const BASE_PRESET = { id: 'base', label: '기본', desc: '기본 기준 그대로', params: {} }
export const C_PRESET = { id: 'vessel_buffer', label: '배별 지연 대비', desc: '배마다 늦어질 만큼 앞뒤 간격을 비워 둔 계획 (작업 여유 · 도착 여유, 데이터 팀 안 3)',
  params: { shifting: { vessel_buffer: true } } }
const B_TANK = { id: 'tank', label: '안전재고 강화', desc: '탱크 안전 범위를 20~80%에서 25~75%로 좁힘', params: { tank: { safe_min_pct: 25, safe_max_pct: 75 } } }
const B_HALF = { id: 'buffer_half', label: '배별 지연 대비 절반', desc: '배별 작업 여유를 절반만 둠 (도착 여유는 그대로)', params: { shifting: { vessel_buffer: true, work_buffer_scale: 0.5 } } }

/** A 계획(simA)과 지금 계획 조건으로 B를 고른다. why = 고른 이유 한 줄 */
export function chooseB(scen, simA) {
  const t = tankGrade(simA, scen.window.end), w = windGrade(scen)
  const grades = { tank: t.g, wind: w.g }
  if (!t.g && !w.g) return { ...B_HALF, why: `탱크 · 풍속 리스크 없음 (${t.text} · ${w.text})`, grades }
  if (t.g >= w.g) return { ...B_TANK, why: `탱크 ${GRADE[t.g]}: ${t.text}${w.g ? ` (풍속 ${GRADE[w.g]})` : ''}`, grades }
  const low = Object.fromEntries(Object.entries(w.th).map(([k, v]) => [k, [Math.max(1, v[0] - 2 * SIGMA_MS), v[1]]]))
  return {
    id: 'wind', label: '보수적 풍속 기준', grades,
    desc: `하역 중단 풍속을 예보 오차 2σ만큼 낮춤: ${Object.entries(w.th).map(([k, v]) => `${WIND_NAME[k] ?? k} ${v[0]}→${low[k][0]}`).join(', ')} m/s`,
    params: { weather: { thresholds_ms: low } },
    why: `풍속 ${GRADE[w.g]}: ${w.text}${t.g ? ` (탱크 ${GRADE[t.g]})` : ''}`,
  }
}

/** 다시 계산할 때 보낼 프리셋 3개: A · (지금 A로 다시 고른) B · C */
export function presetsFor(scen, sims) {
  const [a, , c] = scen.presets
  const simA = sims.find((s) => s.preset?.id === a.id) ?? sims[0]
  return [a, simA ? chooseB(scen, simA) : scen.presets[1], c]
}

/** 탱크가 마지노선에서 가장 가까울 때의 거리(%p). 클수록 안전 */
export const tankMargin = (sim, end = horizonEnd(sim)) => Math.min(Infinity, ...(sim.tanks ?? []).flatMap((t) => levelsUntil(t, end).map((lv) => {
  const pct = (lv / t.capacity_t) * 100
  return Math.min(pct - TANK_LIMIT[0], TANK_LIMIT[1] - pct)
})))
