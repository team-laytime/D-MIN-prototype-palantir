// 지도와 선박 카드가 같은 규칙으로 선박 위치·항행 상태를 정하도록 한 곳에 둔다.
// 정박지(E2·E3)는 울산항 공개 정박지 위치 기준. DWT 3만 톤 이하는 E2, 그보다 큰 선박은 E3에서 기다린다.
export const MAP_CONTEXT = {
  anchorages: [
    { id: 'E2', label: 'E2 정박지', maxDwt: 30000, center: [35.4225, 129.4441],
      spots: [[35.42403, 129.42868], [35.42313, 129.44412], [35.42403, 129.45956], [35.41863, 129.4364], [35.41763, 129.4514], [35.42683, 129.4378]] },
    { id: 'E3', label: 'E3 정박지', maxDwt: Infinity, center: [35.4098, 129.4535],
      spots: [[35.41051, 129.43971], [35.41142, 129.45515], [35.41412, 129.47059], [35.4033, 129.44853], [35.40432, 129.4638], [35.39832, 129.4553]] },
  ],
}

// DWT 3만 톤 이하는 E2, 그보다 큰 선박은 E3 정박지에서 기다린다.
export const anchorageFor = (v) => MAP_CONTEXT.anchorages.find((a) => v.dwt <= a.maxDwt)

// PortWise 문법: 빨강 = 입항 예정·정박지 대기, 초록 = 부두 계류, 회색 = 출항.
export const NAV = {
  coming: { status: '항해(동력)', label: '입항 예정', color: '#e5484d', sog: 11.5, cog: 315 },
  waiting: { status: '정박', label: '정박지 대기', color: '#e5484d', sog: 0.1, cog: 300 },
  berthed: { status: '계류', label: '부두 계류', color: '#2ea043', sog: 0.0, cog: 20 },
  left: { status: '항해(출항)', label: '출항', color: '#9aa0a8', sog: 12.0, cog: 135 },
}

// 위치가 정해지지 않은 상태(입항 전·출항 후)는 항로 입구 근처 점으로 보여 준다.
const SEA_IN = [35.392, 129.47]
const SEA_OUT = [35.395, 129.462]

export function positionOf(state, scen, spotIndex = 0) {
  if (state.phase === 'berthed') return scen.berths.find((b) => b.id === state.p.bid).moor
  if (state.phase === 'waiting') {
    const a = anchorageFor(state.v)
    return a.spots[spotIndex % a.spots.length]
  }
  return state.phase === 'coming' ? SEA_IN : SEA_OUT
}
