// 11-25 시뮬레이션 재생 때 배 움직임. 팀 최적화 엔진이 시간을 5분 칸으로 다루므로(berth_sim params horizon.slot_min = 5)
// 재생도 5분씩 나아가고, 배는 그 사이 바다 경로(seaRoutes.js) 위를 따라 이어서 움직인다.
//   입항   : 도착(ETA) 전 ARRIVE분 동안 바다 입구 → 정박지 자리
//   접안 전 : 접안(ETB) 전 APPROACH분 동안 정박지 자리 → 배정 선석 (대기가 그보다 짧으면 대기 시간 전부)
//   이안 뒤 : 이안(ETU) 뒤 DEPART분 동안 선석 → 바다 출구
// 배 방향(cog)은 지금 지나는 구간의 진행 방향, 멈춰 있을 때는 마지막으로 움직인 방향을 쓴다.
import { arriveRoute, leaveRoute, seaRoute } from './seaRoutes.js'

export const STEP_MIN = 5
const ARRIVE = 45
const APPROACH = 60
const DEPART = 45

/** a → b 방향(북 = 0도, 시계 방향) */
export function bearing(a, b) {
  const dy = b[0] - a[0]
  const dx = (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180)
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

const segLen = (a, b) => Math.hypot(b[0] - a[0], (b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180))

/** 경로 위 비율 f(0~1) 지점과 그 구간의 진행 방향 */
export function along(path, f) {
  const lens = path.slice(1).map((p, i) => segLen(path[i], p))
  const total = lens.reduce((s, x) => s + x, 0) || 1
  let d = Math.max(0, Math.min(1, f)) * total
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const r = lens[i] ? Math.min(1, d / lens[i]) : 1
      const a = path[i], b = path[i + 1]
      return { pos: [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r], cog: bearing(a, b) }
    }
    d -= lens[i]
  }
  return { pos: path.at(-1), cog: bearing(path.at(-2) ?? path[0], path.at(-1)) }
}

/**
 * 시각 t의 배 위치와 방향. 지도에 안 그릴 때(아직 멀리 있음, 이미 떠남)는 null.
 * @param spot 이 배가 정박지에서 기다리는 자리
 * @param anchId 'E2' | 'E3'
 * @param berth 배정 선석(moor 좌표 포함)
 */
export function poseAt({ p, v }, t, spot, anchId, berth) {
  const eta = p.eta ?? v.eta
  // 11-25 세 구간 모두 미리 구한 물길(seaRoutes.js)만 따른다: 육지 금지
  const arrive = arriveRoute(spot)
  const toBerth = seaRoute(spot, anchId, berth)
  const leave = leaveRoute(berth)
  const lastArriveCog = bearing(arrive.at(-2), arrive.at(-1))
  const lastApproachCog = bearing(toBerth.at(-2), toBerth.at(-1))
  // 입항
  if (t < eta) {
    if (t < eta - ARRIVE) return null
    const r = along(arrive, (t - (eta - ARRIVE)) / ARRIVE)
    return { ...r, moving: 'in' }
  }
  // 정박지 대기 → 선석으로 이동
  if (t < p.etb) {
    const span = Math.min(APPROACH, p.etb - eta)
    if (t < p.etb - span) return { pos: spot, cog: lastArriveCog, moving: null }
    const r = along(toBerth, (t - (p.etb - span)) / Math.max(1, span))
    return { ...r, moving: 'approach' }
  }
  // 접안 중
  if (t < p.etu) return { pos: berth.moor, cog: lastApproachCog, moving: null }
  // 이안 뒤 바다로
  if (t < p.etu + DEPART) {
    const r = along(leave, (t - p.etu) / DEPART)
    return { ...r, moving: 'out' }
  }
  return null
}
