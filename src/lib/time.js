// 시각은 데이터셋의 기준 시각 T(계획 시작, KST)를 0으로 둔 분 단위 정수로 다룬다.
// 데이터셋을 불러올 때 setTimeBase()로 T를 정한다. 엔진 결과의 시각(UTC 문자열)은 toMin()으로 분으로 바꾼다.
const KST = 9 * 60 * 60e3
let baseMs = Date.UTC(2025, 10, 9, 0, 0) // 2025-11-09 09:00 KST (불러오기 전 자리값)

/** 기준 시각 T. iso = '2025-11-09T00:00:00Z' 같은 UTC 문자열 */
export function setTimeBase(iso) { baseMs = Date.parse(iso) }
export const baseIso = () => new Date(baseMs).toISOString().replace('.000Z', 'Z')

/** UTC 문자열 → T부터 몇 분 */
export const toMin = (iso) => (iso ? Math.round((Date.parse(iso) - baseMs) / 60000) : null)
/** T부터 몇 분 → 엔진에 보낼 UTC 문자열 */
export const toIso = (min) => new Date(baseMs + min * 60000).toISOString().replace('.000Z', 'Z')

// 시연의 '지금' = 기준 시각 T. 운영 현황·확정 일정의 시간축 왼쪽 끝이고, 남은 시간 계산의 기준이다.
export const NOW = 0

const pad = (n) => String(n).padStart(2, '0')
const kst = (min) => new Date(baseMs + min * 60000 + KST)

export function fmt(min) {
  if (min === null || min === undefined) return '-'
  const d = kst(min)
  return `${d.getUTCMonth() + 1}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
/** 날짜까지: 2025-11-09 09:00 */
export function fmtFull(min) {
  const d = kst(min)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
/** 그 시각의 KST 시(0~23) */
export const hourOf = (min) => kst(min).getUTCHours()
/** 그 시각이 속한 KST 날짜 0시(분) */
export const dayStart = (min) => min - (hourOf(min) * 60 + kst(min).getUTCMinutes())

export function fmtDur(min) {
  const sign = min < 0 ? '-' : ''
  const a = Math.abs(min)
  const h = Math.floor(a / 60)
  const m = Math.round((a % 60) * 10) / 10
  if (h === 0) return `${sign}${m}분`
  return m ? `${sign}${h}시간 ${m}분` : `${sign}${h}시간`
}

/** datetime-local 입력칸 값(KST) */
export function toInput(min) {
  const d = kst(min)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
export function fromInput(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s)
  if (!m) return null
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - KST
  return Math.round((ms - baseMs) / 60000)
}

// 금액은 USD 센트 정수. 화면에서 다시 반올림하지 않는다.
export function money(cents) {
  const sign = cents < 0 ? '-' : ''
  const a = Math.abs(cents)
  const dollars = Math.floor(a / 100).toLocaleString('en-US')
  return `${sign}$${dollars}.${pad(a % 100)}`
}

export function moneyShort(cents) {
  const sign = cents < 0 ? '-' : ''
  const a = Math.abs(cents) / 100
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}k`
  return `${sign}$${Math.round(a)}`
}
