// 다크/라이트 테마. html[data-theme]가 토큰을 바꾸고, body의 bp6-dark가 Blueprint 컴포넌트를 바꾼다.
// 처음 값: 주소의 ?theme= → 라이트. (11-26 라이트 모드만 쓴다: 상단 전환 버튼을 빼고 지난번 다크 선택도 쓰지 않는다. 다크 코드는 남겨 둠)
import { useSyncExternalStore } from 'react'

const KEY = 'dmin-theme'
const initial = () => {
  const q = new URLSearchParams(location.search).get('theme')
  if (q === 'light' || q === 'dark') return q
  return 'light'
}

let theme = initial()
const listeners = new Set()
function apply() {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.body.classList.toggle('bp6-dark', theme === 'dark')
}
apply()

export function setTheme(next) {
  theme = next
  localStorage.setItem(KEY, next)
  apply()
  for (const l of listeners) l()
}
export const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')
export const useTheme = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => theme)
/** Blueprint 포털(드로어·팝오버)에 붙일 테마 클래스. */
export const useDarkClass = () => (useTheme() === 'dark' ? 'bp6-dark' : '')

// 11-24 글씨 크기: 선박 스케줄러는 40~50대 숙련자가 많아 큰 글씨가 필요할 수 있다.
// 화면 글씨가 px로 고정돼 있어 화면 전체를 비율(zoom)로 키운다. 처음 값: 주소의 ?font= → 지난번 선택 → 보통.
export const FONT_SCALES = [
  { id: 'normal', label: '보통', zoom: 1 },
  { id: 'large', label: '크게', zoom: 1.15 },
  { id: 'xlarge', label: '아주 크게', zoom: 1.3 },
]
const FKEY = 'dmin-font'
// 11-25 상단 바의 글씨 크기 버튼을 뺐다(사용자 결정). 예전에 고른 값이 남아 화면이 커져 있지 않게 늘 보통으로 시작한다.
//   (기본 글씨는 theme.css --fs 배율로 이미 키워 두었다. 시연용으로는 주소에 ?font=large 를 붙이면 아직 쓸 수 있다.)
const fontInitial = () => {
  const q = new URLSearchParams(location.search).get('font')
  return FONT_SCALES.some((f) => f.id === q) ? q : 'normal'
}
let font = fontInitial()
const fontListeners = new Set()
function applyFont() { document.documentElement.style.zoom = String(FONT_SCALES.find((f) => f.id === font).zoom) }
applyFont()
export function setFontScale(id) {
  font = id
  try { localStorage.setItem(FKEY, id) } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
  applyFont()
  for (const l of fontListeners) l()
}
/** 11-25 로그인 화면은 글씨 크기 배율(zoom)을 받지 않는다. 화면 전체가 커지면 카드가 아래로 밀리고 푸터가 잘린다.
 *  로그인 화면이 떠 있는 동안 1로 두고, 사라지면 고른 배율로 되돌린다. */
export function suspendFontZoom() {
  document.documentElement.style.zoom = '1'
  return applyFont
}
export const useFontScale = () => useSyncExternalStore((l) => { fontListeners.add(l); return () => fontListeners.delete(l) }, () => font)
