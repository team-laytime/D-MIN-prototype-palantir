import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Dialog, Icon } from '@blueprintjs/core'
import { accountTime, changeAccount, getAccounts, ROLE_LABELS, refreshAccounts, SCHEDULER_TEAM, subscribeAccounts, TEAMS } from '../lib/accounts.js'
import './admin.css'

const STATUS = { pending: '승인 대기', active: '활성', inactive: '비활성', rejected: '반려' }
const PAGE_SIZE = 10
const compactTime = at => at ? accountTime(at).slice(5) : '—'
const today = () => accountTime(new Date()).slice(0, 10)
function useCompactLayout() {
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1100px)').matches)
  useEffect(() => { const media = window.matchMedia('(max-width: 1100px)'); const sync = () => setCompact(media.matches); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync) }, [])
  return compact
}

function restoreFocus(target) { const element = target?.isConnected ? target : document.querySelector('.am-row-select') || document.querySelector('.am-page-heading h1'); element?.focus() }

const Badge = ({ status }) => <span className={`am-state am-${status}`}>{STATUS[status]}</span>

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
  const [modalOpen, setModalOpen] = useState(false)
  const finishAfterAction = useRef(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const actionButton = useRef(null)
  const inspectionTrigger = useRef(null)
  const inspectionReturn = useRef(null)
  const compact = useCompactLayout()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [inspectorId, setInspectorId] = useState(null)
  const unavailable = Boolean(data.storageIssue)
  const receivedToday = data.accounts.filter(a => accountTime(a.requestedAt).startsWith(today())).length
  const pending = data.accounts.filter(a => a.status === 'pending')
  const active = data.accounts.filter(a => a.status === 'active')
  const inactive = data.accounts.filter(a => a.status === 'inactive')
  const rejected = data.accounts.filter(a => a.status === 'rejected')
  const registered = data.accounts.filter(a => ['active', 'inactive'].includes(a.status))
  const handledToday = data.history.filter(h => accountTime(h.at).startsWith(today()) && ['계정 승인', '계정 신청 반려'].includes(h.action))
  const filtered = useMemo(() => data.accounts.filter(a => {
    const inView = view === 'accounts' ? ['active', 'inactive'].includes(a.status) && (status === 'all' || a.status === status) : status === 'approved' ? ['active', 'inactive'].includes(a.status) : a.status === status
    return inView && (!query.trim() || `${a.name} ${a.id} ${a.email}`.toLowerCase().includes(query.trim().toLowerCase())) && (!roleFilter || a.role === roleFilter) && (!teamFilter || a.team === teamFilter)
  }), [data, view, status, query, roleFilter, teamFilter])
  const history = data.history.filter(h => !query.trim() || `${h.name} ${h.accountId} ${h.action} ${h.detail}`.toLowerCase().includes(query.trim().toLowerCase()))
  const total = view === 'history' ? history.length : filtered.length
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.min(page, maxPage)
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const selected = visible.find(a => a.id === selectedId) ?? visible[0] ?? null
  const modalAccount = data.accounts.find(a => a.id === modal?.id)
  const inspectedAccount = data.accounts.find(a => a.id === inspectorId)
  useEffect(() => { if (!compact) { setInspectorOpen(false); setInspectorId(null) } }, [compact])
  useEffect(() => { if (inspectorOpen && !modal) requestAnimationFrame(() => restoreFocus(actionButton.current?.closest('.am-inspector-dialog') ? actionButton.current : inspectionReturn.current?.querySelector('button'))) }, [inspectorOpen, modal])
  useEffect(() => { setPage(1) }, [view, status, query, roleFilter, teamFilter])

  function navigate(next) {
    setInspectorOpen(false); setView(next); setStatus(next === 'accounts' ? 'all' : 'pending'); setSelectedId(null)
    setQuery(''); setRoleFilter(''); setTeamFilter(''); setError(''); setMessage('')
  }
  function update(id, action, options) {
    setError('')
    try {
      const account = changeAccount(id, action, options)
      if (action !== 'check') {
        finishAfterAction.current = true; setModalOpen(false)
        setMessage(`${account.name} · ${action === 'approve' ? '승인했습니다.' : action === 'reject' ? '반려했습니다.' : action === 'role' ? '권한을 변경했습니다.' : `${STATUS[account.status]} 상태로 변경했습니다.`}`)
      }
      return true
    } catch (e) { setError(e.message); return false }
  }
  function open(kind, account, trigger) { actionButton.current = trigger || document.activeElement; finishAfterAction.current = false; setError(''); setModal({ kind, id: account.id, expected: { status: account.status, role: account.role, team: account.team } }); setModalOpen(true) }
  function close() { setModalOpen(false); setError('') }
  function modalClosed() { setModal(null); if (finishAfterAction.current && compact) setInspectorOpen(false); else restoreFocus(actionButton.current) }
  function selectAccount(account, trigger) { setSelectedId(account.id); if (compact) { inspectionTrigger.current = trigger; setInspectorId(account.id); setInspectorOpen(true) } }
  const tabs = view === 'accounts' ? [['all', '전체', registered.length], ['active', '활성', active.length], ['inactive', '비활성', inactive.length]] : [['pending', '승인 대기', pending.length], ['approved', '승인 완료', registered.length], ['rejected', '반려', rejected.length]]
  const title = view === 'accounts' ? '전체 계정' : view === 'history' ? '처리 이력' : '가입 신청'

  return <div className="dmin-admin">
    <div className="am-brand-line" />
    <div className="am-layout">
      <aside className="am-sidebar">
        <div className="am-brand"><img src="/brand/dmin-logo.png" alt="" width="36" height="36" /><div><b>D-MIN</b><small>시스템 관리자</small></div></div>
        <nav aria-label="관리자 메뉴">{[['requests', '가입 신청', 'inbox'], ['accounts', '전체 계정', 'people'], ['history', '처리 이력', 'history']].map(([id, label, icon]) => <button key={id} type="button" aria-label={label} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon icon={icon} size={16} /><span className="am-nav-text">{label}</span>{id === 'requests' && <small>{unavailable ? '—' : pending.length}</small>}</button>)}</nav>
        <div className="am-sidebar-bottom"><b>시스템 관리자</b><small>admin@sk.com</small><button type="button" aria-label="로그아웃" onClick={onLogout}><Icon icon="log-out" size={16} /><span className="am-nav-text">로그아웃</span></button></div>
      </aside>
      <main className={`am-main ${view === 'accounts' ? 'am-directory' : ''}`}>
        <header className="am-page-heading"><div><h1 tabIndex={-1}>{title}</h1><span className="am-heading-count">{unavailable ? '—' : view === 'accounts' ? registered.length : view === 'history' ? data.history.length : pending.length}</span></div>{view === 'accounts' ? <Button disabled={unavailable} icon="download" text="목록 내보내기" onClick={() => exportAccounts(filtered)} /> : view === 'requests' && <p className="am-workload">오늘 접수 <b>{unavailable ? '—' : receivedToday}</b> · 처리 <b>{unavailable ? '—' : handledToday.length}</b></p>}</header>
        {message && <div className="am-message" role="status">{message}<button type="button" aria-label="알림 닫기" onClick={() => setMessage('')}><Icon icon="cross" size={16} /></button></div>}
        {(data.storageIssue || (error && !modal)) && <div className="am-error am-storage-error" role="alert"><span>{data.storageIssue || error}</span><Button text="다시 확인" onClick={() => { refreshAccounts(); setError('') }} /></div>}
        <div className="am-tabs" aria-label="계정 상태">{view !== 'history' && tabs.map(([id, label, count]) => <button type="button" key={id} aria-pressed={status === id} onClick={() => { setStatus(id); setSelectedId(null) }}>{label}<b>{unavailable ? '—' : count}</b></button>)}<div className="am-context"><span className="am-data-origin">시연 데이터</span><time>{today()} 기준</time></div></div>
        <div className={`am-workspace ${view === 'history' ? 'am-history-view' : ''}`}>
          <section className="am-list" aria-label={view === 'history' ? '계정 처리 이력' : '계정 목록'}>
            <FilterBar disabled={unavailable} {...{ view, query, setQuery, roleFilter, setRoleFilter, teamFilter, setTeamFilter }} reset={() => { setQuery(''); setRoleFilter(''); setTeamFilter('') }} />
            <div className="am-table-wrap">{compact && view !== 'history' ? <MobileAccountList emptyText={unavailable ? '계정 정보를 불러오지 못했습니다.' : query || roleFilter || teamFilter ? '검색 조건에 맞는 항목이 없습니다.' : '표시할 계정이 없습니다.'} accounts={visible} selectedId={selected?.id} selectAccount={selectAccount} /> : <table><caption className="am-sr-only">{title} 목록. 사용자 이름을 선택하면 상세 내용을 확인할 수 있습니다.</caption><thead><tr>{(view === 'history' ? ['사용자', '처리 내용', '상세', '처리 일시', '처리자', '메일 안내'] : [view === 'accounts' ? '사용자' : '신청자', view === 'accounts' ? '역할' : '요청 역할', '담당 부두 · 팀', view === 'accounts' ? '최근 로그인' : '신청 일시', '상태', '']).map((label, i) => <th key={i} scope="col">{label}</th>)}</tr></thead><tbody>
              {view === 'history' ? history.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(h => <tr key={h.id}><td><b>{h.name}</b><small>{h.accountId}</small></td><td>{h.action}</td><td>{h.detail || '—'}</td><td>{compactTime(h.at)}</td><td>{h.who}</td><td>{h.notifyRequested ? '안내 요청됨' : '—'}</td></tr>) : visible.map(a => <tr key={a.id} className={a.id === selected?.id ? 'selected' : ''} onClick={e => selectAccount(a, e.currentTarget)}>
                <td><button type="button" className="am-row-select" aria-pressed={a.id === selected?.id} aria-controls="am-inspector" onClick={e => selectAccount(a, e.currentTarget)}><b>{a.name}</b><small>{a.id}</small></button></td><td>{ROLE_LABELS[a.role]}</td><td>{a.team}</td><td>{compactTime(view === 'accounts' ? a.lastLoginAt : a.requestedAt)}</td><td><Badge status={a.status} />{a.status === 'pending' && a.role === 'scheduler' && !a.managerApproved && <small className="am-awaiting">팀장 승인 필요</small>}</td><td><Icon icon="chevron-right" size={14} /></td>
              </tr>)}
              {total === 0 && <tr><td colSpan="6" className="am-empty">{unavailable ? '계정 정보를 불러오지 못했습니다.' : query || roleFilter || teamFilter ? '검색 조건에 맞는 항목이 없습니다.' : view === 'history' ? '처리 이력이 없습니다.' : '표시할 계정이 없습니다.'}</td></tr>}
            </tbody></table>}</div>
            <Pagination totalKnown={!unavailable} {...{ total, currentPage, maxPage, setPage }} unit={view === 'accounts' ? '명' : '건'} />
          </section>
          {view !== 'history' && !compact && (selected ? <AccountPanel account={selected} lastChange={data.history.find(h => h.accountId === selected.id)} open={open} update={update} /> : <section className="am-detail am-empty">{unavailable ? '계정 정보를 확인할 수 없습니다.' : '선택할 계정이 없습니다.'}</section>)}
        </div>
      </main>
    </div>
    {compact && inspectedAccount && <Dialog isOpen={inspectorOpen} shouldReturnFocusOnClose={false} onClose={() => setInspectorOpen(false)} onClosed={() => { setInspectorId(null); restoreFocus(inspectionTrigger.current) }} onOpened={() => inspectionReturn.current?.querySelector('button')?.focus()} enforceFocus={!modal} canEscapeKeyClose={!modal} className="dmin-admin-dialog am-inspector-dialog" aria-label={`${inspectedAccount.name} 계정 상세`}><div ref={inspectionReturn} className="am-inspector-tools"><Button autoFocus icon="arrow-left" text="목록으로" onClick={() => setInspectorOpen(false)} /></div><AccountPanel account={inspectedAccount} lastChange={data.history.find(h => h.accountId === inspectedAccount.id)} open={open} update={update} /></Dialog>}
    {modal && modalAccount && <AccountDialog isOpen={modalOpen} key={`${modal.kind}:${modal.id}`} kind={modal.kind} account={modalAccount} error={error} onClose={close} onClosed={modalClosed} onSubmit={options => update(modal.id, modal.kind, { ...options, expected: modal.expected })} />}
  </div>
}

function MobileAccountList({ accounts, selectedId, selectAccount, emptyText }) {
  if (!accounts.length) return <div className="am-empty" role="status">{emptyText}</div>
  return <div className="am-mobile-list" aria-label="계정 목록">{accounts.map(account => <button type="button" className={`am-mobile-row am-row-select ${account.id === selectedId ? 'selected' : ''}`} key={account.id} aria-haspopup="dialog" aria-label={`${account.name} ${account.id} 계정 상세`} onClick={e => selectAccount(account, e.currentTarget)}><div><b>{account.name}</b><small>{account.id}</small></div><Badge status={account.status} /><p>{ROLE_LABELS[account.role]}<span>{account.team}</span></p>{account.role === 'scheduler' && account.status === 'pending' && !account.managerApproved && <small className="am-awaiting">팀장 승인 필요</small>}<Icon icon="chevron-right" size={14} /></button>)}</div>
}

function FilterBar({ disabled, view, query, setQuery, roleFilter, setRoleFilter, teamFilter, setTeamFilter, reset }) {
  return <div className="am-filters"><label className="am-search"><Icon icon="search" size={16} /><input disabled={disabled} aria-label={view === 'history' ? '처리 이력 검색' : '이름, 사번, 회사 메일 검색'} placeholder={view === 'history' ? '이름, 사번, 처리 내용 검색' : '이름, 사번, 회사 메일 검색'} value={query} onChange={e => setQuery(e.target.value)} /></label>{view !== 'history' && <><select disabled={disabled} aria-label="역할 필터" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option value="">모든 역할</option>{Object.entries(ROLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><select disabled={disabled} aria-label="담당 부두 · 팀 필터" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}><option value="">모든 부두 · 팀</option>{[...TEAMS, SCHEDULER_TEAM].map(t => <option key={t}>{t}</option>)}</select></>}{(query || roleFilter || teamFilter) && <div className="am-filter-reset-wrap"><Button disabled={disabled} className="am-filter-reset" text="초기화" onClick={reset} /></div>}</div>
}

function Pagination({ totalKnown, total, currentPage, maxPage, setPage, unit }) {
  return <footer className="am-pagination"><span>{totalKnown ? <>전체 {total}{unit}{total > 0 && ` · ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)}${unit}`}</> : '목록을 확인할 수 없습니다.'}</span><nav aria-label="페이지 이동"><button type="button" aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><Icon icon="chevron-left" size={16} /></button>{Array.from({ length: maxPage }, (_, i) => i + 1).filter(n => n === 1 || n === maxPage || Math.abs(n - currentPage) <= 1).map((n, i, list) => <span key={n}>{i > 0 && n - list[i - 1] > 1 && <span>…</span>}<button type="button" aria-label={`${n}페이지`} aria-current={currentPage === n ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button></span>)}<button type="button" aria-label="다음 페이지" disabled={currentPage === maxPage} onClick={() => setPage(currentPage + 1)}><Icon icon="chevron-right" size={16} /></button></nav></footer>
}

function AccountPanel({ account, lastChange, open, update }) {
  const pending = account.status === 'pending'
  const scheduler = account.role === 'scheduler'
  const requested = pending || account.status === 'rejected'
  return <section id="am-inspector" className={`am-detail ${pending ? '' : 'am-directory-detail'}`} aria-label="선택 계정 상세">
    <header><h2>{requested ? '신청 상세' : '계정 상세'}</h2><Badge status={account.status} /></header>
    <div className="am-identity"><h3>{account.name}</h3><span>{account.id}</span></div>
    <dl className="am-fields am-scope-fields" aria-label="역할과 운영 담당 범위"><div><dt>{requested ? '요청 역할' : '현재 역할'}</dt><dd>{ROLE_LABELS[account.role]}</dd></div><div><dt>담당 부두 · 팀</dt><dd>{account.team}</dd></div></dl>
    <dl className="am-fields"><div><dt>회사 메일</dt><dd>{account.email}</dd></div><div><dt>{requested ? '신청 일시' : '승인 일시'}</dt><dd>{accountTime(requested ? account.requestedAt : account.approvedAt || account.requestedAt)}</dd></div>{!requested && <div><dt>최근 로그인</dt><dd>{account.lastLoginAt ? accountTime(account.lastLoginAt) : '로그인 기록 없음'}</dd></div>}</dl>
    {pending ? <div className="am-review"><h4>승인 전 확인</h4><CheckItem label="사번 · 소속 · 담당 부두" checked={account.identityChecked} onChange={value => update(account.id, 'check', { identityChecked: value })} />{scheduler ? <CheckItem label="팀장 승인" checked={account.managerApproved} onChange={value => update(account.id, 'check', { managerApproved: value })} /> : <div className="am-check"><span>팀장 승인</span><span>해당 없음</span></div>}<p className="am-prerequisite" id="am-review-required">{!account.identityChecked || (scheduler && !account.managerApproved) ? '필수 확인을 마치면 승인할 수 있습니다.' : '필수 확인을 마쳤습니다.'}</p><div className="am-detail-actions"><Button text="반려하기" onClick={e => open('reject', account, e.currentTarget)} /><Button className="am-primary" disabled={!account.identityChecked || (scheduler && !account.managerApproved)} aria-describedby="am-review-required" text="승인하기" onClick={e => open('approve', account, e.currentTarget)} /></div></div> : account.status === 'rejected' ? <div className="am-detail-section"><h4>반려 사유</h4><p className="am-reason">{account.reason}</p></div> : <>
      <div className="am-detail-section"><header><h4>권한 및 접근 범위</h4><button type="button" onClick={e => open('role', account, e.currentTarget)}><Icon icon="edit" size={14} />변경</button></header><ul>{(scheduler ? ['접안 계획 작성 및 조건 설정', '최적화 후보 비교 · 일정 확정', '확정 통보 메일 작성'] : ['확정된 접안 일정 조회', '담당 부두 일정 확인']).map(item => <li key={item}>{item}</li>)}</ul></div>
      <div className="am-detail-section am-audit"><h4>최근 변경</h4>{lastChange ? <><b>{lastChange.action}</b><span>{lastChange.who}</span><time>{accountTime(lastChange.at)}</time></> : <p className="am-no-history">이 화면에 저장된 변경 이력이 없습니다.</p>}</div>
      <footer className="am-detail-actions"><Button className={account.status === 'active' ? 'am-deactivate' : ''} text={account.status === 'active' ? '계정 비활성화' : '계정 활성화'} onClick={e => open('toggle', account, e.currentTarget)} /></footer>
    </>}
  </section>
}

function CheckItem({ label, checked, onChange }) {
  return <label className="am-check"><span><input type="checkbox" checked={Boolean(checked)} onChange={e => onChange(e.target.checked)} />{label}</span><span className={checked ? 'am-active' : 'am-unchecked'}>{checked ? '확인 완료' : '미확인'}</span></label>
}

function AccountDialog({ isOpen, kind, account, error, onClose, onClosed, onSubmit }) {
  const formRef = useRef(null)
  const [notify, setNotify] = useState(true)
  const [reasonType, setReasonType] = useState('소속 · 담당 부두 확인 불가')
  const [reason, setReason] = useState('')
  const [role, setRole] = useState(account.role)
  const [team, setTeam] = useState(account.team)
  const [managerApproved, setManagerApproved] = useState(account.managerApproved)
  const heading = kind === 'approve' ? '계정을 승인할까요?' : kind === 'reject' ? '계정 신청 반려' : kind === 'role' ? '계정 권한 변경' : `계정을 ${account.status === 'active' ? '비활성화' : '활성화'}할까요?`
  const action = kind === 'approve' ? '승인하기' : kind === 'reject' ? '반려하기' : kind === 'role' ? '변경하기' : account.status === 'active' ? '비활성화' : '활성화'
  const reasonValue = reasonType === '직접 입력' ? reason.trim() : [reasonType, reason.trim()].filter(Boolean).join(': ')
  const checked = account.identityChecked && (account.role !== 'scheduler' || account.managerApproved)
  return <Dialog isOpen={isOpen} shouldReturnFocusOnClose={false} onClose={onClose} onClosed={onClosed} onOpened={() => formRef.current?.querySelector('select, textarea, button:not([disabled])')?.focus()} title={heading} className="dmin-admin-dialog" aria-label={heading}>
    <form ref={formRef} onSubmit={e => { e.preventDefault(); if (!isOpen) return; const options = kind === 'reject' ? { notify, reason: reasonValue } : kind === 'approve' ? { notify } : kind === 'role' ? { role, team, managerApproved } : {}; onSubmit(options) }}>
      <div className="am-dialog-body">
        {kind === 'reject' && <p>반려 사유를 계정 처리 이력에 기록합니다.</p>}
        <div className="am-dialog-account"><div><b>{account.name}</b><small>{account.id}</small></div><dl className="am-fields"><div><dt>{['approve', 'reject'].includes(kind) ? '요청 역할' : '현재 역할'}</dt><dd>{ROLE_LABELS[account.role]}</dd></div><div><dt>담당 부두 · 팀</dt><dd>{account.team}</dd></div></dl></div>
        {kind === 'approve' && !checked && <p className="am-error">신청 상세에서 사번 · 소속 · 담당 부두{account.role === 'scheduler' ? '와 팀장 승인' : ''}을 확인해 주세요.</p>}
        {kind === 'reject' && <div className="am-form-label"><label htmlFor="am-reject-category">반려 사유 *</label><select id="am-reject-category" autoFocus value={reasonType} onChange={e => setReasonType(e.target.value)}>{['소속 · 담당 부두 확인 불가', '사번 · 회사 메일 확인 불가', '팀장 승인 미확인', '직접 입력'].map(r => <option key={r}>{r}</option>)}</select><label className="am-sr-only" htmlFor="am-reject-detail">상세 반려 사유</label><textarea id="am-reject-detail" aria-describedby="am-reason-count" aria-label="상세 반려 사유" placeholder="상세 사유를 입력해 주세요." maxLength={reasonType === '직접 입력' ? 300 : 298 - reasonType.length} value={reason} onChange={e => setReason(e.target.value)} required={reasonType === '직접 입력'} /><small id="am-reason-count" className="am-char-count">기록되는 사유 {reasonValue.length} / 300</small></div>}
        {kind === 'role' && <><label className="am-form-label">역할<select autoFocus value={role} onChange={e => { const next = e.target.value; setRole(next); setTeam(next === 'scheduler' ? SCHEDULER_TEAM : TEAMS[0]); setManagerApproved(false) }}>{Object.entries(ROLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label className="am-form-label">담당 부두 · 팀<select value={team} onChange={e => setTeam(e.target.value)}>{(role === 'scheduler' ? [SCHEDULER_TEAM] : TEAMS).map(t => <option key={t}>{t}</option>)}</select></label>{role === 'scheduler' && <label className="am-notify"><input type="checkbox" checked={managerApproved} onChange={e => setManagerApproved(e.target.checked)} />팀장 승인 확인</label>}</>}
        {kind === 'toggle' && <p>{account.status === 'active' ? '계정 상태를 비활성으로 기록합니다. 이 시연은 로그인 인증 시스템과 연결되어 있지 않습니다.' : '계정 상태를 활성으로 기록합니다. 실제 로그인 권한은 인증 시스템 연동 후 적용됩니다.'}</p>}
        {['approve', 'reject'].includes(kind) && <label className="am-notify"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} />처리 결과 메일 안내 요청 기록</label>}
        {['approve', 'reject'].includes(kind) && <p className="am-delivery-note">실제 메일 발송은 연결되어 있지 않습니다. 요청 여부만 처리 이력에 저장됩니다.</p>}{error && <p className="am-error" role="alert">{error}</p>}
      </div><footer className="am-dialog-actions"><Button type="button" text="취소" onClick={onClose} /><Button type="submit" className={kind === 'reject' ? 'am-danger' : 'am-primary'} text={action} disabled={!isOpen || (kind === 'approve' && !checked) || (kind === 'role' && role === 'scheduler' && !managerApproved)} /></footer>
    </form>
  </Dialog>
}
