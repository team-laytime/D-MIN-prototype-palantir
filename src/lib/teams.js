// 부두(묶음)별 하역팀 연락처. 실데이터 묶음에는 사람·연락처가 없어서 화면 동작용 가상 값이다(표시할 때 「가상」을 붙인다).
import { pierName } from './dataset.js'

const PIERS = ['1', '2', '3', '4', '5', '6', '7', '8', 'BUOY', 'GAS']
export const PIER_TEAMS = Object.fromEntries(PIERS.map((p, i) => [p, {
  pier: p,
  team: `${pierName(p)} 하역팀`,
  lead: '담당 반장',
  tel: `052-000-${String(1000 + i * 111).slice(0, 4)}`,
  mail: `${p === 'BUOY' ? 'buoy' : p === 'GAS' ? 'gas' : `sk${p}`}-ops@example.com`,
}]))
export const teamOf = (berth) => PIER_TEAMS[berth?.pier] ?? null
