// 시나리오 입력이 바뀐 칸을 사람이 읽는 말로 뽑는다. 변경 이력·활동 기록·알림함이 이 결과를 쓴다.
import { WEATHER_CLAUSE } from './scenarios.js'
import { fmt } from './time.js'

const usd = (n) => `$${Number(n).toLocaleString('en-US')}`
const VESSEL_FIELDS = [
  { field: 'eta', label: '도착 예정(NOR)', get: (v) => v.eta, show: fmt },
  { field: 'laytimeH', label: '허용 시간', get: (v) => v.contract.laytimeH, show: (x) => `${x}h` },
  { field: 'rateUsd', label: '일 체선료', get: (v) => v.contract.rateUsd, show: usd },
  { field: 'norTurnH', label: '정박시간 개시', get: (v) => v.contract.norTurnH, show: (x) => `NOR+${x}h` },
  { field: 'weather', label: '기상 조항', get: (v) => v.contract.weather, show: (x) => WEATHER_CLAUSE[x]?.label ?? x },
]
const wx = (w) => (w ? `${fmt(w.start)} ~ ${fmt(w.end)}` : '예보 없음')

/** @returns {{key, field, label, targetName, from, to, kind}[]} key는 선박 id 또는 'env' */
export function diffScen(prev, next) {
  const out = []
  const before = Object.fromEntries(prev.vessels.map((v) => [v.id, v]))
  for (const v of next.vessels) {
    const p = before[v.id]
    if (!p) continue
    for (const f of VESSEL_FIELDS) {
      const a = f.get(p), b = f.get(v)
      if (a !== b) out.push({ key: v.id, field: f.field, label: f.label, targetName: v.name, from: f.show(a), to: f.show(b), kind: f.field === 'eta' ? 'eta' : 'contract' })
    }
  }
  const a = prev.env.weather, b = next.env.weather
  if (Boolean(a) !== Boolean(b) || (a && b && (a.start !== b.start || a.end !== b.end))) {
    out.push({ key: 'env', field: 'weather', label: '기상 악화 예보', targetName: '기상·조석', from: wx(a), to: wx(b), kind: 'weather' })
  }
  return out
}
