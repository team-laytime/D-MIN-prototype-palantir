import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Dialog, Icon } from '@blueprintjs/core'
import { accountTime, changeAccount, getAccounts, ROLE_LABELS, SCHEDULER_TEAM, subscribeAccounts, TEAMS } from '../lib/accounts.js'
import './admin.css'

const STATUS = { pending: '승인 대기', active: '활성', inactive: '비활성', rejected: '반려' }
const PAGE_SIZE = 5
const compactTime = at => at ? accountTime(at).slice(5).replace('-', '.') : '—'
const today = () => accountTime(new Date()).slice(0, 10)
const Badge = ({ status }) => <span className={`am-badge am-${status}`}>{STATUS[status]}</span>

function Metric({ label, value, hint }) {
  return <div className="am-metric"><div><span>{label}</span><strong>{value}</strong></div><small>{hint}</small></div>
}

function exportAccounts(accounts) {
  const quote = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`
  const rows = [['이름', '사번', '회사 메일', '역할', '담당 부두 · 팀', '상태', '최근 로그인'], ...accounts.map(a => [a.name, a.id, a.email, ROLE_LABELS[a.role], a.team, STATUS[a.status], a.lastLoginAt ? accountTime(a.lastLoginAt) : ''])]
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(r => r.map(quote).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = `D-MIN_전체계정_${today()}.csv`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function Admin({ onLogout }) {
  const data = useSyncExternalStore(subscribeAccounts, getAccounts)
  const [view, setView] = useState('requests')
  const [status, setStatus] = useState('pending')
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const [modal, setModal] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const actionButton = useRef(null)
  const pending = data.accounts.filter(a => a.status === 'pending')
  const active = data.accounts.filter(a => a.status === 'active')
  const inactive = data.accounts.filter(a => a.status === 'inactive')
  const rejected = data.accounts.filter(a => a.status === 'rejected')
  const registered = data.accounts.filter(a => ['active', 'inactive'].includes(a.status))
  const handledToday = data.history.filter(h => accountTime(h.at).startsWith(today()) && ['계정 승인', '계정 신청 반려'].includes(h.action))
  const matches = a => (!query.trim() || `${a.name} ${a.id} ${a.email}`.toLowerCase().includes(query.trim().toLowerCase())) && (!roleFilter || a.role === roleFilter) && (!teamFilter || a.team === teamFilter)
  const filtered = useMemo(() => data.accounts.filter(a => (view === 'accounts' ? ['active', 'inactive'].includes(a.status) && (status === 'all' || a.status === status) : a.status === status) && matches(a)), [data, view, status, query, roleFilter, teamFilter])
  const history = data.history.filter(h => !query.trim() || `${h.name} ${h.accountId} ${h.action} ${h.detail}`.toLowerCase().includes(query.trim().toLowerCase()))
  const total = view === 'history' ? history.length : filtered.length
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, maxPage)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const selected = visible.find(a => a.id === selectedId) ?? visible[0] ?? null
  useEffect(() => { setPage(1) }, [view, status, query, roleFilter, teamFilter])
  function navigate(next) { setView(next); setStatus(next === 'accounts' ? 'all' : 'pending'); setSelectedId(null); setQuery(''); setRoleFilter(''); setTeamFilter(''); setError(''); setMessage('') }
  function update(id, action, options) {
    setError('')
    try {
      const account = changeAccount(id, action, options)
      if (action !== 'check') { setModal(null); setMessage(`${account.name} · ${action === 'approve' ? '승인했습니다.' : action === 'reject' ? '반려했습니다.' : action === 'role' ? '권한을 변경했습니다.' : `${STATUS[account.status]} 상태로 변경했습니다.`}`) }
      return true
    } catch (e) { setError(e.message); return false }
  }
  const tabs = view === 'accounts' ? [['all', '전체 계정', registered.length], ['active', '활성', active.length], ['inactive', '비활성', inactive.length]] : [['pending', '승인 대기', pending.length], ['active', '승인 완료', active.length], ['rejected', '반려', rejected.length]]
  const open = (kind, account) => { actionButton.current = document.activeElement; setError(''); setModal({ kind, id: account.id }) }
  const close = () => { setModal(null); setError(''); actionButton.current?.focus() }
  const modalAccount = data.accounts.find(a => a.id === modal?.id)

  return <div className="dmin-admin">
    <div className="am-brand-line" />
    <header className="am-topbar"><b>D-MIN</b></header>
    <div className="am-layout">
      <aside className="am-sidebar">
        <div className="am-brand"><div><img src="/brand/dmin-logo.png" alt="" width="38" height="38" /><b>D-MIN</b></div><small>시스템 관리자</small></div>
        <hr /><span className="am-nav-label">계정 관리</span>
        <nav aria-label="관리자 메뉴">{[['requests', '가입 신청', 'inbox'], ['accounts', '전체 계정', 'people'], ['history', '처리 이력', 'history']].map(([id, label, icon]) => <button key={id} type="button" className={view === id ? 'on' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon icon={icon} size={18} />{label}{id === 'requests' && <small>{pending.length}</small>}</button>)}</nav>
        <div className="am-sidebar-bottom"><div className="am-profile"><span className="am-avatar">관</span><div><b>시스템 관리자</b><small>admin@sk.com</small></div></div><hr /><button type="button" onClick={onLogout}><Icon icon="log-out" size={18} />로그아웃</button></div>
      </aside>
      <main className={`am-main ${view === 'accounts' ? 'am-directory' : ''}`}>
        <div className="am-page-heading"><h1>{view === 'accounts' ? '전체 계정' : view === 'history' ? '처리 이력' : '계정 관리'}{view === 'accounts' && <span className="am-heading-count">{registered.length}</span>}</h1>{view === 'accounts' && <Button icon="download" text="목록 내보내기" onClick={() => exportAccounts(filtered)} />}</div>
        {view !== 'accounts' && <div className="am-metrics">
          <Metric label="승인 대기" value={pending.length} hint={`오늘 접수 ${pending.filter(a => accountTime(a.requestedAt).startsWith(today())).length}건`} />
          <Metric label="활성 계정" value={active.length} hint={`선박 스케줄러 ${active.filter(a => a.role === 'scheduler').length} · 일정 이용자 ${active.filter(a => a.role === 'user').length}`} />
          <Metric label={view === 'accounts' ? '비활성 계정' : '오늘 처리'} value={view === 'accounts' ? inactive.length : handledToday.length} hint={view === 'accounts' ? '로그인 차단 중' : `승인 ${handledToday.filter(h => h.action === '계정 승인').length} · 반려 ${handledToday.filter(h => h.action === '계정 신청 반려').length}`} />
        </div>}
        {message && <div className="am-message" role="status">{message}<button type="button" aria-label="알림 닫기" onClick={() => setMessage('')}><Icon icon="cross" /></button></div>}
        {error && !modal && <p className="am-error" role="alert">{error}</p>}
        <div className="am-tabs" aria-label="계정 상태">{view !== 'history' && tabs.map(([id, label, count]) => <button type="button" key={id} className={status === id ? 'on' : ''} aria-pressed={status === id} onClick={() => { setStatus(id); setSelectedId(null) }}>{label}<b>{count}</b></button>)}<time>{today().replaceAll('-', '.')} 기준</time></div>
        <div className={`am-workspace ${view === 'history' ? 'am-history-view' : ''}`}>
          <section className="am-card am-list" aria-label={view === 'history' ? '계정 처리 이력' : '계정 목록'}>
            {view !== 'accounts' && <header className="am-list-title"><h2>{view === 'history' ? '계정 처리 이력' : '가입 신청 목록'}</h2><b>{total}건</b></header>}
            <div className="am-filters"><label className="am-search"><Icon icon="search" size={18} /><input aria-label={view === 'history' ? '처리 이력 검색' : '이름, 사번, 회사 메일 검색'} placeholder={view === 'history' ? '이름, 사번, 처리 내용 검색' : '이름, 사번, 회사 메일 검색'} value={query} onChange={e => setQuery(e.target.value)} /></label>{view !== 'history' && <><select aria-label="역할 필터" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="">모든 역할</option>{Object.entries(ROLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select aria-label="담당 부두 · 팀 필터" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="">모든 부두 · 팀</option>{[...TEAMS, SCHEDULER_TEAM].map(t => <option key={t}>{t}</option>)}</select></>}</div>
            <div className="am-table-wrap"><table><thead><tr>{(view === 'history' ? ['사용자', '처리 내용', '상세', '처리 일시', '처리자', '메일 안내'] : [view === 'accounts' ? '사용자' : '신청자', view === 'accounts' ? '역할' : '요청 역할', '담당 부두 · 팀', view === 'accounts' ? '최근 로그인' : '신청 일시', '상태', '']).map((label, i) => <th key={i} scope="col">{label}</th>)}</tr></thead><tbody>
              {view === 'history' ? history.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(h => <tr key={h.id}><td><b>{h.name}</b><small>{h.accountId}</small></td><td>{h.action}</td><td>{h.detail || '—'}</td><td>{compactTime(h.at)}</td><td>{h.who}</td><td>{h.notifyRequested ? '안내 요청됨' : '—'}</td></tr>) : visible.map(a => <tr key={a.id} className={a.id === selected?.id ? 'selected' : ''} onClick={() => setSelectedId(a.id)}><td><button type="button" className="am-row-select" aria-pressed={a.id === selected?.id} onClick={() => setSelectedId(a.id)}>{view === 'accounts' && <span className="am-table-avatar" aria-hidden="true">{a.name.slice(0, 1)}</span>}<span><b>{a.name}</b><small>{a.id}</small></span></button></td><td><span className={view === 'accounts' ? 'am-role-tag' : ''}>{ROLE_LABELS[a.role]}</span></td><td>{a.team}</td><td>{compactTime(view === 'accounts' ? a.lastLoginAt : a.requestedAt)}</td><td><span className={`am-state am-${a.status}`}>{a.status === 'pending' && a.role === 'scheduler' && !a.managerApproved ? '팀장 승인 필요' : STATUS[a.status]}</span></td><td><Icon icon="chevron-right" size={16} /></td></tr>)}
              {total === 0 && <tr><td colSpan="6" className="am-empty">{query || roleFilter || teamFilter ? '검색 조건에 맞는 항목이 없습니다.' : view === 'history' ? '처리 이력이 없습니다.' : '표시할 계정이 없습니다.'}</td></tr>}
            </tbody></table></div>
            <footer className="am-pagination"><span>전체 {total}{view === 'accounts' ? '명' : '건'}{total > 0 && ` 중 ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)}${view === 'accounts' ? '명' : '건'}`}</span><nav aria-label="페이지 이동"><button type="button" aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><Icon icon="chevron-left" size={16} /></button>{Array.from({ length: maxPage }, (_, i) => i + 1).filter(n => n === 1 || n === maxPage || Math.abs(n - currentPage) <= 1).map((n, i, list) => <span key={n}>{i > 0 && n - list[i - 1] > 1 && <span className="am-ellipsis">…</span>}<button type="button" aria-label={`${n}페이지`} aria-current={currentPage === n ? 'page' : undefined} className={currentPage === n ? 'on' : ''} onClick={() => setPage(n)}>{n}</button></span>)}<button type="button" aria-label="다음 페이지" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}><Icon icon="chevron-right" size={16} /></button></nav></footer>
          </section>
          {view === 'accounts' && selected ? <DirectoryDetail account={selected} lastChange={data.history.find(h => h.accountId === selected.id)} open={open} /> : view !== 'history' && (selected ? <section className="am-card am-detail" aria-label="선택 계정 상세" key={selected.id}>
            <header><h2>{view === 'accounts' ? '계정 상세' : '신청 상세'}</h2><Badge status={selected.status} /></header>
            <div className="am-identity"><span className="am-avatar">{selected.name.slice(0, 1)}</span><div><h3>{selected.name}</h3><small>{selected.id}</small></div></div><hr />
            <dl className="am-fields"><div><dt>회사 메일</dt><dd>{selected.email}</dd></div><div><dt>{view === 'accounts' ? '현재 역할' : '요청 역할'}</dt><dd>{ROLE_LABELS[selected.role]}</dd></div><div><dt>담당 부두 · 팀</dt><dd>{selected.team}</dd></div><div><dt>{view === 'accounts' ? '승인 일시' : '신청 일시'}</dt><dd>{accountTime(view === 'accounts' ? selected.approvedAt || selected.requestedAt : selected.requestedAt)}</dd></div></dl><hr />
            {selected.status === 'pending' ? <><h4>승인 전 확인</h4><label className="am-check"><span>사번 · 소속 · 담당 부두</span><span><input type="checkbox" checked={selected.identityChecked} onChange={e => update(selected.id, 'check', { identityChecked: e.target.checked })} />확인 완료</span></label>{selected.role === 'scheduler' ? <label className="am-check"><span>팀장 승인</span><span><input type="checkbox" checked={selected.managerApproved} onChange={e => update(selected.id, 'check', { managerApproved: e.target.checked })} />확인 완료</span></label> : <div className="am-check"><span>팀장 승인</span><span className="am-active">해당 없음</span></div>}<div className="am-detail-actions"><Button text="반려하기" onClick={() => open('reject', selected)} /><Button className="am-primary" text="승인하기" onClick={() => open('approve', selected)} /></div></> : selected.status === 'rejected' ? <><h4>반려 사유</h4><p className="am-reason">{selected.reason}</p></> : <><h4>사용 가능한 기능</h4><p>{selected.role === 'scheduler' ? '접안 계획 작성 · 비교 · 확정' : '확정 일정 조회 · 담당 부두 일정 확인'}</p><h4>최근 변경</h4><p>{data.history.find(h => h.accountId === selected.id)?.action || '계정 승인'}</p><div className="am-detail-actions"><Button text="권한 변경" onClick={() => open('role', selected)} /><Button text={selected.status === 'active' ? '비활성화' : '활성화'} onClick={() => open('toggle', selected)} /></div></>}
          </section> : <section className="am-card am-detail am-empty">선택할 계정이 없습니다.</section>)}
        </div>
      </main>
    </div>
    {modal && modalAccount && <AccountDialog key={`${modal.kind}:${modal.id}`} kind={modal.kind} account={modalAccount} error={error} onClose={close} onSubmit={options => update(modal.id, modal.kind, options)} />}
  </div>
}

function DirectoryDetail({ account, lastChange, open }) {
  const scheduler = account.role === 'scheduler'
  return <section className="am-card am-directory-detail" aria-label="선택 계정 상세">
    <header className="am-directory-detail-head"><h2>계정 상세</h2><Badge status={account.status} /></header>
    <div className="am-directory-person"><span className="am-directory-avatar">{account.name.slice(0, 1)}</span><h3>{account.name}</h3><span className="am-employee-id">{account.id}</span></div>
    <div className="am-detail-section"><h4>기본 정보</h4><dl><div><dt>회사 메일</dt><dd><a href={`mailto:${account.email}`}>{account.email}</a></dd></div><div><dt>담당 부두 · 팀</dt><dd>{account.team}</dd></div><div><dt>승인 일시</dt><dd>{accountTime(account.approvedAt || account.requestedAt)}</dd></div><div><dt>최근 로그인</dt><dd>{account.lastLoginAt ? accountTime(account.lastLoginAt) : '로그인 기록 없음'}</dd></div></dl></div>
    <div className="am-detail-section"><header><h4>권한 및 접근 범위</h4><button type="button" onClick={() => open('role', account)}><Icon icon="edit" size={13} />변경</button></header><span className="am-permission-role"><Icon icon="shield" size={16} />{ROLE_LABELS[account.role]}</span><ul>{(scheduler ? ['접안 계획 작성 및 조건 설정', '최적화 후보 비교 · 일정 확정', '확정 통보 메일 작성'] : ['확정된 접안 일정 조회', '담당 부두 일정 확인']).map(item => <li key={item}><Icon icon="tick" size={12} />{item}</li>)}</ul></div>
    <div className="am-detail-section am-audit"><h4>최근 변경</h4><span className="am-audit-dot" /><div><b>{lastChange?.action || '계정 승인'}</b><span>시스템 관리자</span><time>{accountTime(lastChange?.at || account.approvedAt || account.requestedAt)}</time></div></div>
    <footer><Button icon={account.status === 'active' ? 'disable' : 'tick-circle'} className={account.status === 'active' ? 'am-deactivate' : ''} text={account.status === 'active' ? '계정 비활성화' : '계정 활성화'} onClick={() => open('toggle', account)} /></footer>
  </section>
}

function AccountDialog({ kind, account, error, onClose, onSubmit }) {
  const [notify, setNotify] = useState(true)
  const [reasonType, setReasonType] = useState('소속 · 담당 부두 확인 불가')
  const [reason, setReason] = useState('')
  const [role, setRole] = useState(account.role)
  const [team, setTeam] = useState(account.team)
  const [managerApproved, setManagerApproved] = useState(account.managerApproved)
  const heading = kind === 'approve' ? '계정을 승인할까요?' : kind === 'reject' ? '계정 신청 반려' : kind === 'role' ? '계정 권한 변경' : `계정을 ${account.status === 'active' ? '비활성화' : '활성화'}할까요?`
  const action = kind === 'approve' ? '승인하기' : kind === 'reject' ? '반려하기' : kind === 'role' ? '변경하기' : account.status === 'active' ? '비활성화' : '활성화'
  const checked = account.identityChecked && (account.role !== 'scheduler' || account.managerApproved)
  return <Dialog isOpen onClose={onClose} title={heading} icon={kind === 'reject' ? 'error' : 'shield'} className="dmin-admin-dialog" aria-label={heading}>
    <form onSubmit={e => { e.preventDefault(); onSubmit({ notify, reason: reason.trim() ? `${reasonType}: ${reason.trim()}` : reasonType === '직접 입력' ? '' : reasonType, role, team, managerApproved }) }}>
      <div className="am-dialog-body">
        {kind === 'reject' && <p>반려 사유를 입력하면 신청자에게 함께 전달됩니다.</p>}
        <div className="am-dialog-account"><div><b>{account.name}</b><small>{account.id}</small></div><hr /><dl className="am-fields"><div><dt>부여할 역할</dt><dd>{ROLE_LABELS[account.role]}</dd></div><div><dt>담당 부두 · 팀</dt><dd>{account.team}</dd></div></dl></div>
        {kind === 'approve' && !checked && <p className="am-error">신청 상세에서 사번 · 소속 · 담당 부두{account.role === 'scheduler' ? '와 팀장 승인' : ''}을 확인해 주세요.</p>}
        {kind === 'reject' && <label className="am-form-label">반려 사유 *<select autoFocus value={reasonType} onChange={e => setReasonType(e.target.value)}>{['소속 · 담당 부두 확인 불가', '사번 · 회사 메일 확인 불가', '팀장 승인 미확인', '직접 입력'].map(r => <option key={r}>{r}</option>)}</select><textarea aria-label="상세 반려 사유" placeholder="상세 사유를 입력해 주세요." maxLength={reasonType === '직접 입력' ? 300 : 298 - reasonType.length} value={reason} onChange={e => setReason(e.target.value)} required={reasonType === '직접 입력'} /><small className="am-char-count">{reason.length} / {reasonType === '직접 입력' ? 300 : 298 - reasonType.length}</small></label>}
        {kind === 'role' && <><label className="am-form-label">역할<select autoFocus value={role} onChange={e => { const next = e.target.value; setRole(next); setTeam(next === 'scheduler' ? SCHEDULER_TEAM : TEAMS[0]); setManagerApproved(false) }}>{Object.entries(ROLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="am-form-label">담당 부두 · 팀<select value={team} onChange={e => setTeam(e.target.value)}>{(role === 'scheduler' ? [SCHEDULER_TEAM] : TEAMS).map(t => <option key={t}>{t}</option>)}</select></label>{role === 'scheduler' && <label className="am-notify"><input type="checkbox" checked={managerApproved} onChange={e => setManagerApproved(e.target.checked)} />팀장 승인 확인</label>}</>}
        {kind === 'toggle' && <p>{account.status === 'active' ? '비활성화하면 이 계정으로 로그인할 수 없습니다.' : '활성화하면 기존 권한으로 다시 로그인할 수 있습니다.'}</p>}
        {['approve', 'reject'].includes(kind) && <label className="am-notify"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />처리 결과 회사 메일로 안내</label>}
        {error && <p className="am-error" role="alert">{error}</p>}
      </div><footer className="am-dialog-actions"><Button type="button" text="취소" onClick={onClose} /><Button type="submit" className={kind === 'reject' ? 'am-danger' : 'am-primary'} text={action} disabled={(kind === 'approve' && !checked) || (kind === 'role' && role === 'scheduler' && !managerApproved)} /></footer>
    </form>
  </Dialog>
}
