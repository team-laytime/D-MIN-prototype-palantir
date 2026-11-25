// 엔진 결과(후보 sim)를 화면에서 읽는 도우미. 계산은 하지 않는다(체선료·시각은 모두 팀 엔진이 낸 값).
import { fmt, fmtDur, hourOf, money } from './time.js'

/** t 시각의 선박 상태. phase: coming(입항 전) · waiting(도착해 정박지 대기) · berthed(접안 중) · left(이안) */
export function stateAt(sim, scen, t) {
  const vById = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  return sim.placements.filter((p) => vById[p.vid]).map((p) => {
    const v = vById[p.vid]
    const phase = t >= p.etu ? 'left' : t >= p.etb ? 'berthed' : t >= (p.eta ?? v.eta) ? 'waiting' : 'coming'
    const progress = phase === 'berthed' ? Math.min(1, (t - p.etb) / Math.max(1, p.etu - p.etb)) : phase === 'left' ? 1 : 0
    return { v, p, phase, progress }
  })
}

/** 부두 상태: busy(접안 중) · blocked(사용 불가 구간) · idle(비어 있음) */
export function berthStatus(sim, scen, berth, t) {
  const occ = sim?.placements.find((p) => p.bid === berth.id && p.etb <= t && t < p.etu)
  const block = scen.blocks.find((b) => (!b.berths || b.berths.includes(berth.id)) && b.start <= t && t < b.end)
  const next = sim?.placements.filter((p) => p.bid === berth.id && p.etb > t).sort((a, b) => a.etb - b.etb)[0]
  const v = (vid) => scen.vessels.find((x) => x.id === vid)
  if (occ) return { key: 'busy', text: `${v(occ.vid)?.name ?? occ.vid} 작업 중`, occupant: { v: v(occ.vid), p: occ, progress: (t - occ.etb) / Math.max(1, occ.etu - occ.etb) }, next }
  if (block) return { key: 'blocked', text: block.kind === 'WEATHER' ? '접안 금지' : '사용 불가', block, next }
  return { key: 'idle', text: '비어 있음', next }
}

export const isNight = (m) => { const h = hourOf(m); return h >= 20 || h < 6 }

/** 후보의 남은 리스크. 엔진 결과에서 바로 읽는다(해당 / 해당 없음). */
export function risksOf(sim, scen) {
  const name = (vid) => scen.vessels.find((v) => v.id === vid)?.name ?? vid
  const dem = sim.placements.filter((p) => p.dem.cents > 0).sort((a, b) => b.dem.cents - a.dem.cents)
  const night = sim.placements.filter((p) => p.night)
  const wx = sim.placements.filter((p) => p.dem.weatherMin > 0)
  const longWait = sim.placements.filter((p) => p.waitMin >= 24 * 60).sort((a, b) => b.waitMin - a.waitMin)
  const tank = sim.tankViolation ?? []
  const r = (key, label, hit, evidence, vessels = [], alternative = '-') => ({ key, label, state: hit ? '해당' : '해당 없음', evidence, vessels, alternative, caution: '-' })
  return [
    r('demurrage', '체선 발생', dem.length > 0, dem.length ? `${dem.length}척, 큰 순서: ${dem.slice(0, 3).map((p) => `${name(p.vid)} ${money(p.dem.cents)}`).join(', ')}` : '체선이 생기는 선박 없음', dem.map((p) => p.vid), '대리점과 NOR·정박시간 개시 확인, 하역 속도 점검'),
    r('night', '야간 접안', night.length > 0, night.length ? `${night.length}척: ${night.slice(0, 4).map((p) => `${name(p.vid)} ${fmt(p.etb)}`).join(', ')}${night.length > 4 ? ' 외' : ''}` : '야간 접안 없음', night.map((p) => p.vid), '도선·예선·줄잡이 야간 인력 미리 배치'),
    r('weather', '기상 하역 중단', wx.length > 0, wx.length ? `${wx.length}척, 합계 ${fmtDur(wx.reduce((s, p) => s + p.dem.weatherMin, 0))} (관측 풍속 기준)` : '기상으로 멈추는 작업 없음', wx.map((p) => p.vid), '풍속 예보 갱신 시 다시 계산'),
    r('wait', '하루 넘는 정박지 대기', longWait.length > 0, longWait.length ? `${longWait.length}척, 가장 긴 대기 ${name(longWait[0].vid)} ${fmtDur(longWait[0].waitMin)}` : '하루 넘게 기다리는 선박 없음', longWait.map((p) => p.vid), '대리점에 예상 접안 시각 안내'),
    r('tank', '탱크 안전 범위 이탈', tank.length > 0, tank.length ? tank.map((x) => `${x.tank ?? x.name}: ${JSON.stringify(x)}`).join(', ') : '안전 범위 안', [], '생산계획팀과 반입·반출 순서 조정'),
  ]
}

/** ref(보통 최저안)와 비교해 부두나 접안 시각이 바뀐 선박 */
export function changedVs(sim, ref) {
  if (!ref) return []
  const base = Object.fromEntries(ref.placements.map((p) => [p.vid, p]))
  return sim.placements.filter((p) => base[p.vid] && (base[p.vid].bid !== p.bid || base[p.vid].etb !== p.etb))
    .map((p) => ({ p, b: base[p.vid], berthChanged: base[p.vid].bid !== p.bid, etbDelta: p.etb - base[p.vid].etb, saving: base[p.vid].dem.cents - p.dem.cents }))
}

/** 계획 기간(시간축) */
export function spanOf(sims) {
  const ps = sims.flatMap((s) => s.placements)
  if (!ps.length) return { start: 0, end: 72 * 60 }
  return { start: Math.floor(Math.min(0, ...ps.map((p) => p.etb)) / 360) * 360, end: Math.ceil(Math.max(...ps.map((p) => p.etu)) / 360) * 360 }
}
