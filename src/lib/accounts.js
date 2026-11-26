// 관리자 프로토타입 전용 저장소. 서버 인증/메일 발송과 분리하며 기존 업무 저장소는 수정하지 않는다.
export const ACCOUNT_KEY = 'dmin.admin.accounts.v1'
export const ROLE_LABELS = { user: '일정 이용자', scheduler: '선박 스케줄러' }
export const TEAMS = ['SK 3부두 하역 1팀', 'SK 5부두 하역 1팀', 'SK 6부두 하역 2팀', '선박 대리점']
export const SCHEDULER_TEAM = '물류운영팀 선박 스케줄'
const KST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
export const accountTime = (at) => Number.isFinite(new Date(at).getTime()) ? KST.format(new Date(at)).replace(',', '').replaceAll('-', '.') : '—'
const stamp = (time) => new Date(`2026-11-25T${time}:00+09:00`).toISOString()
// 11-25 가입 신청 시연: 오늘 기준 며칠 전(daysAgo)의 KST 시각. 오늘 들어온 요청과 쌓인 요청을 나눠 보이기 위해
const kstDay = (daysAgo) => KST.format(new Date(Date.now() - daysAgo * 864e5)).slice(0, 10)
const requestStamp = (daysAgo, time) => new Date(`${kstDay(daysAgo)}T${time}:00+09:00`).toISOString()
const sample = [
  ['김민수', 'SK10248', 'user', TEAMS[0], 'minsu.kim@sk.com'],
  ['박서연', 'SK10315', 'scheduler', SCHEDULER_TEAM, 'seoyeon.park@sk.com'],
  ['이준호', 'SK10162', 'user', TEAMS[1], 'junho.lee@sk.com'],
  ['정하은', 'SK10407', 'user', TEAMS[2], 'haeun.jung@sk.com'],
  ['최도윤', 'SK10286', 'user', TEAMS[3], 'doyun.choi@sk.com'],
  ['오지우', 'SK10520', 'user', TEAMS[0], 'jiwoo.oh@sk.com'],
]
const fresh = () => ({
  version: 1,
  accounts: [
    ...sample.map(([name, id, role, team, email], i) => ({ id, name, role, team, email, status: 'pending', requestedAt: requestStamp(i < 3 ? 0 : i - 2, `09:${String(42 - i * 6).padStart(2, '0')}`), managerApproved: false, identityChecked: false, demo: true })),
    ...[
      ['김현우', 'SK10104', 'user', TEAMS[0], 'hyunwoo.kim@sk.com', 'active'],
      ['이수빈', 'SK10272', 'user', TEAMS[1], 'subin.lee@sk.com', 'active'],
      ['강태준', 'SK10039', 'scheduler', SCHEDULER_TEAM, 'taejun.kang@sk.com', 'active'],
      ['윤지현', 'SK10386', 'user', TEAMS[2], 'jihyun.yoon@sk.com', 'inactive'],
    ].map(([name, id, role, team, email, status]) => ({ id, name, role, team, email, status, requestedAt: stamp('08:00'), approvedAt: stamp('08:05'), lastLoginAt: stamp('09:20'), identityChecked: true, managerApproved: role === 'scheduler', demo: true })),
    { id: 'scheduler', name: '스케줄러 A', role: 'scheduler', team: SCHEDULER_TEAM, email: 'scheduler@example.com', status: 'active', requestedAt: stamp('08:00'), approvedAt: stamp('08:05'), managerApproved: true, identityChecked: true, demo: true },
    { id: 'user', name: '이용자 B', role: 'user', team: TEAMS[0], email: 'sk3-ops@example.com', status: 'active', requestedAt: stamp('08:00'), approvedAt: stamp('08:05'), identityChecked: true, demo: true },
  ],
  history: [],
})
let snapshot
const listeners = new Set()
const storage = () => { try { return globalThis.localStorage } catch { return null } }
const validDate = value => typeof value === 'string' && Number.isFinite(new Date(value).getTime())
const unreadable = () => ({ version: 1, accounts: [], history: [], storageIssue: '저장된 계정 정보를 읽지 못했습니다. 원본은 보존했으며 새 데이터로 덮어쓰지 않습니다. 저장소를 확인한 뒤 다시 시도해 주세요.' })
const optionalBoolean = value => value === undefined || typeof value === 'boolean'
const optionalText = value => value === undefined || typeof value === 'string'
const validAccount = a => a && typeof a.id === 'string' && a.id.length > 0 && typeof a.name === 'string' && typeof a.email === 'string' && typeof a.team === 'string' && Object.hasOwn(ROLE_LABELS, a.role) && ['pending', 'active', 'inactive', 'rejected'].includes(a.status) && validDate(a.requestedAt) && (!a.approvedAt || validDate(a.approvedAt)) && (!a.lastLoginAt || validDate(a.lastLoginAt)) && optionalBoolean(a.identityChecked) && optionalBoolean(a.managerApproved) && optionalText(a.reason)
const validHistory = h => h && typeof h.id === 'string' && typeof h.accountId === 'string' && typeof h.name === 'string' && typeof h.action === 'string' && typeof h.who === 'string' && validDate(h.at) && optionalText(h.detail) && optionalBoolean(h.notifyRequested)
function read() {
  const store = storage()
  if (!store) return { ...fresh(), storageIssue: '브라우저 저장소에 접근할 수 없습니다. 계정 변경을 저장할 수 없어 처리를 중단했습니다.' }
  try {
    const raw = store.getItem(ACCOUNT_KEY)
    if (raw === null) return fresh()
    const data = JSON.parse(raw)
    const accountsValid = Array.isArray(data?.accounts) && data.accounts.every(validAccount) && new Set(data.accounts.map(a => a.id)).size === data.accounts.length
    const historyValid = Array.isArray(data?.history) && data.history.every(validHistory)
    return data?.version === 1 && accountsValid && historyValid ? data : unreadable()
  } catch { return unreadable() }
}
export function getAccounts() { return snapshot ??= read() }
export function refreshAccounts() { snapshot = read(); listeners.forEach(l => l()) }
export function subscribeAccounts(listener) { listeners.add(listener); return () => listeners.delete(listener) }
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => {
  if (e.key === ACCOUNT_KEY || e.key === null) { snapshot = read(); listeners.forEach(l => l()) }
})
function save(next) {
  try { const store = storage(); if (!store) throw new Error('storage unavailable'); store.setItem(ACCOUNT_KEY, JSON.stringify(next)) } catch { throw new Error('저장 공간에 접근할 수 없습니다. 브라우저 설정을 확인해 주세요.') }
  snapshot = next
  listeners.forEach(l => l())
}
function latest() { if (storage()) snapshot = read(); return getAccounts() }
export function changeAccount(id, action, options = {}) {
  const data = latest()
  if (data.storageIssue) throw new Error(data.storageIssue)
  const account = data.accounts.find(a => a.id === id)
  if (!account) throw new Error('계정을 찾을 수 없습니다.')
  if (options.expected && Object.entries(options.expected).some(([key, value]) => account[key] !== value)) throw new Error('다른 창에서 계정 정보가 변경되었습니다. 내용을 다시 확인한 뒤 처리해 주세요.')
  const at = new Date().toISOString()
  let patch, label
  if (action === 'check') {
    if (['identityChecked', 'managerApproved'].some(key => options[key] !== undefined && typeof options[key] !== 'boolean')) throw new Error('확인 항목은 체크 상태로만 변경할 수 있습니다.')
    if (account.status !== 'pending') throw new Error('대기 중인 신청만 검토할 수 있습니다.')
    patch = { identityChecked: Boolean(options.identityChecked ?? account.identityChecked), managerApproved: Boolean(options.managerApproved ?? account.managerApproved) }
  } else if (action === 'approve') {
    if (account.status !== 'pending') throw new Error('이미 처리된 신청입니다.')
    if (account.identityChecked !== true || (account.role === 'scheduler' && account.managerApproved !== true)) throw new Error('사번, 소속, 담당 부두와 팀장 승인을 확인해 주세요.')
    patch = { status: 'active', approvedAt: at }; label = '계정 승인'
  } else if (action === 'reject') {
    if (account.status !== 'pending') throw new Error('이미 처리된 신청입니다.')
    const reason = options.reason?.trim()
    if (!reason || reason.length > 300) throw new Error('반려 사유를 1~300자로 입력해 주세요.')
    patch = { status: 'rejected', reason }; label = '계정 신청 반려'
  } else if (action === 'role') {
    if (!['active', 'inactive'].includes(account.status)) throw new Error('승인된 계정만 권한을 변경할 수 있습니다.')
    if (!Object.hasOwn(ROLE_LABELS, options.role) || !(options.role === 'scheduler' ? [SCHEDULER_TEAM] : TEAMS).includes(options.team)) throw new Error('역할과 소속 팀을 확인해 주세요.')
    if (options.role === 'scheduler' && options.managerApproved !== true) throw new Error('스케줄러 권한은 팀장 승인이 필요합니다.')
    patch = { role: options.role, team: options.team, managerApproved: options.role === 'scheduler' && options.managerApproved }; label = '권한 변경'
  } else if (action === 'toggle') {
    if (!['active', 'inactive'].includes(account.status)) throw new Error('승인된 계정만 상태를 변경할 수 있습니다.')
    patch = { status: account.status === 'active' ? 'inactive' : 'active' }; label = patch.status === 'active' ? '계정 활성화' : '계정 비활성화'
  } else throw new Error('지원하지 않는 계정 처리입니다.')
  const updated = { ...account, ...patch }
  const event = { id: crypto.randomUUID(), accountId: id, name: account.name, action: label, at, who: '시스템 관리자', detail: action === 'role' ? `${ROLE_LABELS[updated.role]}, ${updated.team}` : action === 'reject' ? patch.reason : '', notifyRequested: ['approve', 'reject'].includes(action) && options.notify === true, email: account.email }
  save({ ...data, accounts: data.accounts.map(a => a.id === id ? updated : a), history: label ? [event, ...data.history] : data.history })
  return updated
}
