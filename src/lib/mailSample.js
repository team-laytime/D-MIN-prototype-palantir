// 11-26 확정 전 통보 메일 미리보기용 더미 계획. 늘 같은 모양(부두마다 배 몇 척, 체선 · 빠듯한 간격 · 사용 불가 구간 · 야간 접안이
//   한두 건씩)으로, 실제 데이터와 상관없이 간트 · 일정표 · 입출항표 · 탱크 · 체선 표가 모두 채워진다. 시각은 지금(NOW) 기준.
//   모양은 확정 기록(workspace.planSnapshot)과 같다. 확정하면 미리보기는 확정한 계획으로 바뀐다.
import { NOW, toIso } from './time.js'
import { nowText } from './workspace.js'

const PIERS = [['1', '1부두', 2], ['2', '2부두', 2], ['3', '3부두', 2], ['4', '4부두', 2], ['5', '5부두', 2], ['6', '6부두', 2],
  ['7', '7부두', 2], ['8', '8부두', 2], ['BUOY', '부이', 1], ['GAS', '가스부두', 1]]
const NAMES = ['한빛호', '새누리호', '동해스타', '푸른바다호', '대양1호', '오션퀸', '남해호', '코리아스타', '태평호', '은하호',
  '그린오션', '블루마린', '해성호', '미래호', '청해호', '아라호', '한결호', '바다로호', '대한호', '금강호', '세종호', '누리호',
  '한라호', '백두호', '선진호', '광명호', '동방호', '서해호']
const TANKS = [['원유', 17, 1], ['반입 원료', 3, 1], ['양방향', 2, 1], ['석유제품 반출', 3, -1], ['화학 반출', 2, -1], ['윤활유 반출', 2, -1], ['특수 반출', 1, -1]]
const PRODUCT = { 원유: '원유', '반입 원료': '납사', 양방향: '경유', '석유제품 반출': '휘발유', '화학 반출': '벤젠', '윤활유 반출': '윤활기유', '특수 반출': '아스팔트' }
const TANK_TON = Math.round(600000 / 7.33)

export function samplePlan({ no = 1, nightPilot = null } = {}) {
  const placements = []
  let n = 0
  PIERS.forEach(([pier, pierName, berths], pi) => {
    for (let k = 1; k <= berths; k++) {
      const bid = `${pier}-${k}`
      let t = NOW - 240 + ((pi * 2 + k) % 5) * 90 // 지금보다 조금 앞에서 시작하는 배도 있게
      for (let s = 0; s < 3; s++, n++) {
        const [tank, , sign] = TANKS[n % TANKS.length]
        const stay = 600 + (n % 4) * 150
        const etb = t, etu = t + stay
        const dem = [2, 11, 23, 40].includes(n) ? 950_000 + (n % 5) * 120_000 : 0 // 몇 척만 체선
        placements.push({
          vid: `SAMPLE-${n}`, name: NAMES[n % NAMES.length], callSign: null, product: PRODUCT[tank], cargo: null, dir: sign > 0 ? '하역' : '선적', in: sign > 0,
          ton: 8000 + (n % 7) * 3500, dwt: 12000 + (n % 7) * 5000, grt: 6000 + (n % 9) * 4000, draft: 7 + (n % 5), biz: sign > 0 ? 'IM' : 'EX', tank, eta: etb - 90,
          bid, berth: `${pierName} ${k}번`, berthCode: bid, pier, pierName,
          etb, etu, night: [4, 19].includes(n), fixed: false, dem, demMin: dem ? 180 + (n % 4) * 60 : 0,
          ws: etb + 60, wf: etu - 120, ls: null, le: null, hose: null, waitMin: dem ? 120 : 0,
        })
        t = etu + ([0, 15, 33].includes(n) ? 30 : 150) // 세 곳만 이안 뒤 30분 만에 다음 배 (빠듯한 간격)
      }
    }
  })
  // 탱크: 72시간 시간별 재고 (완만한 오르내림)
  const tanks = TANKS.map(([tank, count], i) => {
    const cap = count * TANK_TON
    const levels = Array.from({ length: 73 }, (_, h) => Math.round(cap * (0.5 + 0.18 * Math.sin(h / 14 + i) + 0.05 * Math.sin(h / 5 + i * 2))))
    return { tank, tanks: count, capacity_t: cap, initial_t: levels[0], safe_min_t: Math.round(cap * 0.2), safe_max_t: Math.round(cap * 0.8), start: toIso(NOW), step_min: 60, levels_t: levels }
  })
  const production = TANKS.map(([name, , sign], i) => ({ name, weeks: [{ from: NOW, rate: -sign * (300 + i * 80) }, { from: NOW + 2 * 1440, rate: -sign * (260 + i * 70) }] }))
  const blocks = [{ berths: ['2-1'], start: NOW + 360, end: NOW + 840, kind: 'EQUIPMENT' }]
  return {
    no, candId: 'A', label: '후보 A', total: placements.reduce((s, p) => s + p.dem, 0), reason: '(예시) 확정할 때 적은 판단 근거가 여기에 들어갑니다.',
    appliedChanges: [], skippedChanges: [], checkedRisks: [], uncheckedRisks: [],
    preset: null, baselineTotal: null, moves: null, status: 'FEASIBLE', proven: false, solveSec: null,
    scenName: '미리보기용 예시', bundle: null, at: nowText(), who: '-', version: 0, cancelled: false,
    tanks, production, blocks, nightPilot, placements: placements.sort((a, b) => a.etb - b.etb),
  }
}
