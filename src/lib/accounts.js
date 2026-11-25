// 관리자 프로토타입 전용 저장소. 서버 인증/메일 발송과 분리하며 기존 업무 저장소는 수정하지 않는다.
export const ACCOUNT_KEY = 'dmin.admin.accounts.v1'
export const ROLE_LABELS = { user: '일정 이용자', scheduler: '선박 스케줄러' }
export const TEAMS = ['SK 3부두 하역 1팀', 'SK 5부두 하역 1팀', 'SK 6부두 하역 2팀', '선박 대리점']
export const SCHEDULER_TEAM = '물류운영팀 선박 스케줄'
const KST = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
export const accountTime = (at) => KST.format(new Date(at)).replace(',', '').replaceAll('-', '.')
const stamp = (time) => new Date(`2026-11-25T${time}:00+09:00`).toISOString()
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
    ...sample.map(([name, id, role, team, email], i) => ({ id, name, role, team, email, status: 'pending', requestedAt: stamp(`09:${String(42 - i * 6).padStart(2, '0')}`), managerApproved: false, identityChecked: false, demo: true })),
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
function read() {
  try {
    const data = JSON.parse(storage()?.getItem(ACCOUNT_KEY) ?? 'null')
    if (data?.version === 1 && Array.isArray(data.accounts) && Array.isArray(data.history) && data.accounts.every(a => typeof a.id === 'string' && typeof a.name === 'string' && typeof a.email === 'string' && ROLE_LABELS[a.role] && ['pending', 'active', 'inactive', 'rejected'].includes(a.status))) return data
  } catch { /* 저장된 형식이 잘못되면 시연 초기값으로 연다. */ }
  return fresh()
}
export function getAccounts() { return snapshot ??= read() }
export function subscribeAccounts(listener) { listeners.add(listener); return () => listeners.delete(listener) }
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => {
  if (e.key === ACCOUNT_KEY || e.key === null) { snapshot = read(); listeners.forEach(l => l()) }
})
function save(next) {
  try { storage()?.setItem(ACCOUNT_KEY, JSON.stringify(next)) } catch { throw new Error('저장 공간에 접근할 수 없습니다. 브라우저 설정을 확인해 주세요.') }
  snapshot = next
  listeners.forEach(l => l())
}
function latest() { if (storage()) snapshot = read(); return getAccounts() }
export function changeAccount(id, action, options = {}) {
  const data = latest()
  const account = data.accounts.find(a => a.id === id)
  if (!account) throw new Error('계정을 찾을 수 없습니다.')
  const at = new Date().toISOString()
  let patch, label
  if (action === 'check') {
    if (account.status !== 'pending') throw new Error('대기 중인 신청만 검토할 수 있습니다.')
    patch = { identityChecked: Boolean(options.identityChecked ?? account.identityChecked), managerApproved: Boolean(options.managerApproved ?? account.managerApproved) }
  } else if (action === 'approve') {
    if (account.status !== 'pending') throw new Error('이미 처리된 신청입니다.')
    if (!account.identityChecked || (account.role === 'scheduler' && !account.managerApproved)) throw new Error('사번 · 소속 · 담당 부두와 팀장 승인을 확인해 주세요.')
    patch = { status: 'active', approvedAt: at }; label = '계정 승인'
  } else if (action === 'reject') {
    if (account.status !== 'pending') throw new Error('이미 처리된 신청입니다.')
    const reason = options.reason?.trim()
    if (!reason || reason.length > 300) throw new Error('반려 사유를 1~300자로 입력해 주세요.')
    patch = { status: 'rejected', reason }; label = '계정 신청 반려'
  } else if (action === 'role') {
    if (!['active', 'inactive'].includes(account.status)) throw new Error('승인된 계정만 권한을 변경할 수 있습니다.')
    if (!ROLE_LABELS[options.role] || !(options.role === 'scheduler' ? [SCHEDULER_TEAM] : TEAMS).includes(options.team)) throw new Error('역할과 소속 팀을 확인해 주세요.')
    if (options.role === 'scheduler' && !options.managerApproved) throw new Error('스케줄러 권한은 팀장 승인이 필요합니다.')
    patch = { role: options.role, team: options.team, managerApproved: options.role === 'scheduler' && options.managerApproved }; label = '권한 변경'
  } else if (action === 'toggle') {
    if (!['active', 'inactive'].includes(account.status)) throw new Error('승인된 계정만 상태를 변경할 수 있습니다.')
    patch = { status: account.status === 'active' ? 'inactive' : 'active' }; label = patch.status === 'active' ? '계정 활성화' : '계정 비활성화'
  } else throw new Error('지원하지 않는 계정 처리입니다.')
  const updated = { ...account, ...patch }
  const event = { id: crypto.randomUUID(), accountId: id, name: account.name, action: label, at, who: '시스템 관리자', detail: action === 'role' ? `${ROLE_LABELS[updated.role]} · ${updated.team}` : options.reason?.trim() || '', notifyRequested: Boolean(options.notify), email: account.email }
  save({ ...data, accounts: data.accounts.map(a => a.id === id ? updated : a), history: label ? [event, ...data.history] : data.history })
  return updated
}
