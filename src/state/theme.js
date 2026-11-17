// 다크/라이트 테마. html[data-theme]가 토큰을 바꾸고, body의 bp6-dark가 Blueprint 컴포넌트를 바꾼다.
// 처음 값: 주소의 ?theme= → 지난번 선택(localStorage) → 다크.
import { useSyncExternalStore } from 'react'

const KEY = 'dmin-theme'
const initial = () => {
  const q = new URLSearchParams(location.search).get('theme')
  if (q === 'light' || q === 'dark') return q
  return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
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
