// 콘솔 틀: 상단 명령 바 · 왼쪽 레일 · 작업 영역 · 하단 상태 바. 화면 내용은 children.
import { Button, HTMLSelect, Icon, Menu, MenuDivider, MenuItem, Popover, Tooltip } from '@blueprintjs/core'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/app.jsx'
import { useInbox } from '../state/useInbox.js'
import { NAV, canUse, groupOf } from '../lib/workspace.js'
import { fmtFull, money } from '../lib/time.js'
import { FONT_SCALES, setFontScale, toggleTheme, useFontScale, useTheme } from '../state/theme.js'

export function ThemeToggle() {
  const theme = useTheme()
  const next = theme === 'dark' ? '라이트' : '다크'
  return (
    <Tooltip content={`${next} 모드로 전환`} placement="bottom">
      <Button variant="minimal" size="small" icon={theme === 'dark' ? 'flash' : 'moon'} aria-label={`${next} 모드로 전환`} onClick={toggleTheme} />
    </Tooltip>
  )
}

// 글씨 크기: 가 가 가 (작은 것부터). 숙련자 연령대를 고려한 기능.
export function FontScale() {
  const cur = useFontScale()
  return (
    <div className="font-scale" role="group" aria-label="글씨 크기">
      <span className="faint tiny">글씨</span>
      {FONT_SCALES.map((f, i) => (
        <Tooltip key={f.id} content={`글씨 ${f.label}`} placement="bottom">
          <button type="button" className={cur === f.id ? 'on' : ''} style={{ fontSize: 11 + i * 2.5 }} aria-pressed={cur === f.id} aria-label={`글씨 ${f.label}`} onClick={() => setFontScale(f.id)}>가</button>
        </Tooltip>
      ))}
    </div>
  )
}

export function Brand({ size = 15 }) {
  // 11-25 사용자가 준 로고 이미지(public/brand/dmin-logo.png)로 바꿈
  return (
    <span className="brand" style={{ fontSize: size }}>
      <img src="/brand/dmin-logo.png" alt="" width={size + 9} height={size + 9} style={{ borderRadius: 4, background: '#fff' }} />
      <b>D-MIN</b>
    </span>
  )
}

// 시계 자리에는 데이터셋의 기준 시각 T(화면의 「지금」)를 보인다. 실제 오늘 날짜와 섞이면 재생 중인 데이터가 헷갈린다.
function Clock() {
  const { scen } = useApp()
  return (
    <Tooltip content="현재 시각. 이 시각 뒤의 일은 계획에 쓰지 않습니다" placement="bottom">
      <span className="clock mono">
        <span className="faint">현재</span> <b>{scen ? fmtFull(0) : '-'}</b> <span className="faint">KST</span>
      </span>
    </Tooltip>
  )
}

export function Shell({ children }) {
  const { role, isScheduler, tab, go, scenarioId, setScenarioId, datasets, scen, logout, resetDemo, current, version, result, tour } = useApp()
  const menus = NAV.filter((g) => canUse(role.id, g))
  const group = groupOf(tab)
  const stale = isScheduler && current && current.version !== version
  const best = result.error ? null : result.candidates[0]
  const { unread, incidents } = useInbox()
  const { setMailFilter } = useApp()

  return (
    <div className="app">
      <header className="topbar">
        <button className="topbar-brand" onClick={() => go(role.home)}>
          <Brand />
          <span className="topbar-sub">체선료 최적화 콘솔</span>
        </button>
        <div className="topbar-right">
          {isScheduler && (
            <DatasetPicker datasets={datasets} scenarioId={scenarioId} onOpen={setScenarioId} />
          )}
          <Clock />
          <ThemeToggle />
          {isScheduler && (
            <Tooltip content="화면을 하나씩 짚는 안내" placement="bottom">
              <Button className="help-btn" data-tour="help-btn" variant="minimal" size="small" icon="help" text="사용법" onClick={tour.start} />
            </Tooltip>
          )}
          <Popover placement="bottom-end" content={(
            <Menu>
              <MenuItem disabled icon="person" text={`${role.name} · ${role.title}`} />
              <MenuDivider />
              <MenuItem icon="reset" text="시연 초기화" label="기록·입력 처음으로" onClick={resetDemo} />
              <MenuItem icon="log-out" text="로그아웃" onClick={logout} />
            </Menu>
          )}>
            <Button variant="minimal" size="small" endIcon="caret-down" className="who">
              {role.name}
            </Button>
          </Popover>
        </div>
      </header>

      <nav className="rail" aria-label="메뉴">
        {menus.map((g) => (
          <div key={g.key} className={`rail-group ${group?.key === g.key ? 'on' : ''}`}>
            {g.items.length > 1 && <div className="rail-head">{g.label}</div>}
            {g.items.map((it) => (
              <button key={it.id} className={`rail-item ${tab === it.id ? 'on' : ''}`} aria-current={tab === it.id ? 'page' : undefined} onClick={() => go(it.id)}>
                {it.no ? <span className="rail-no num">{it.no}</span> : <Icon icon={it.icon} size={14} />}
                <span>{it.label}</span>
                {it.id === 'inbox' && unread > 0 && <span className="rail-badge num" aria-label={`안 읽은 메일 ${unread}통`}>{unread}</span>}
              </button>
            )).concat(g.key === 'MAIL' && isScheduler && incidents.length > 0 ? [
              // 11-24 최최종: 돌발 상황은 지금 있을 때만 켜진다. 없으면 이 줄 자체가 없다.
              <button key="incident" className="rail-item rail-sub hot" onClick={() => { setMailFilter('incident'); go('inbox') }}>
                <Icon icon="warning-sign" size={12} /><span>조건 변경 요청</span><span className="rail-badge num hot" aria-label={`조건 변경 요청 ${incidents.length}건`}>{incidents.length}</span>
              </button>,
            ] : [])}
          </div>
        ))}
      </nav>

      <main className="work">{children}</main>

      {/* 11-25 아래 상태 줄의 데이터셋, 엔진, 금액 표시를 빼고 임시 문구만 (나중에 바꿈) */}
      <footer className="statusbar"><span className="statusbar-credit">Made by Minkyu</span></footer>
    </div>
  )
}

/**
 * 11-26 데이터셋 고르기: 상단에는 「기준 시각 2025/11/09 09:00」 버튼 하나. 누르면 시연 날짜(바로 열림)와 직접 고르기(날짜 · 정시 + 열기).
 * 직접 고를 때 「열기」를 눌러야 바뀐다(바꿀 때마다 하역 속도 · 후보 계산이 돌기 때문). 날짜별 파일은 예전처럼 목록.
 */
function DatasetPicker({ datasets, scenarioId, onOpen }) {
  const [file, start] = (scenarioId ?? '').split('@')
  const d = datasets.find((x) => x.id === file) ?? datasets.at(-1)
  const [draft, setDraft] = useState(start ?? '')
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => { setDraft(start ?? '') }, [start])
  // 바깥을 누르거나 Esc면 닫는다
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) { setOpen(false); setDraft(start ?? '') } }
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setDraft(start ?? '') } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, start])
  if (!d || d.kind !== 'year') {
    return (
      <label className="scen-select" id="scen" data-tour="scen">
        <span className="faint tiny">데이터셋</span>
        <HTMLSelect minimal value={scenarioId ?? ''} onChange={(e) => onOpen(e.target.value)} aria-label="데이터셋"
          options={datasets.length ? datasets.map((x) => ({ value: x.id, label: x.label })) : [{ value: '', label: '불러오는 중' }]} />
      </label>
    )
  }
  const [day, hm] = draft.split(' ')
  const wellFormed = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(draft) && day >= d.range.from && day <= d.range.to
  // 11-26 같은 선석에 두 척이 동시에 있던 기록(겹침)이 계획 기간(기준 시각 + days)에 걸리면 시연용으로 고르지 않는다
  const clash = wellFormed ? clashesOf(draft, d.days, d.overlaps ?? []) : []
  const valid = wellFormed && !clash.length
  const close = () => { setOpen(false); setDraft(start ?? '') }
  const pick = (to) => { setOpen(false); if (to && to !== start) onOpen(`${d.id}@${to}`) }
  const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
  return (
    <div className="scen-wrap" ref={wrapRef}>
      <button type="button" className="scen-select scen-trigger" id="scen" data-tour="scen" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))} aria-label="기준 시각 고르기">
        <Icon icon="calendar" size={13} className="faint" />
        <span className="faint tiny">기준 시각</span>
        <b className="num">{start ? start.replace(/-/g, '/') : '불러오는 중'}</b>
        <Icon icon={open ? 'caret-up' : 'caret-down'} size={12} className="faint" />
      </button>
      {open && (
        <div className="scen-pop" role="dialog" aria-label="기준 시각 고르기">
          <div className="scen-pop-k">시연 날짜</div>
          <div className="scen-pop-list">
            {d.shortcuts.map((x) => (
              <button key={x} type="button" className={`scen-pop-item num ${x === start ? 'on' : ''}`} onClick={() => pick(x)} title={x}>{x.slice(5).replace('-', '/')}</button>
            ))}
          </div>
          <div className="scen-pop-k">직접 고르기 <span className="faint">{d.range.from.slice(0, 4)}년 안</span></div>
          <div className="scen-pop-pick">
            <input type="date" className="scen-pop-date num" value={day ?? ''} min={d.range.from} max={d.range.to} aria-label="기준 날짜"
              onChange={(e) => setDraft(`${e.target.value} ${hm ?? '09:00'}`)} />
            <HTMLSelect value={hm ?? '09:00'} aria-label="기준 시각" onChange={(e) => setDraft(`${day ?? d.default_start.split(' ')[0]} ${e.target.value}`)}
              options={hours.includes(hm) || !hm ? hours : [hm, ...hours]} />
            <Button intent="primary" text="열기" disabled={!valid || draft === start} onClick={() => pick(draft)} />
          </div>
          {clash.length > 0 && (
            <p className="scen-pop-warn">
              {d.days * 24}시간 안에 같은 선석에 두 척이 동시에 있던 기록이 있어 고를 수 없습니다.
              <span className="scen-pop-warn-list">{clash.slice(0, 3).map((w) => `${w.berth} ${w.start.slice(5).replace('-', '/')}~${w.end.slice(11)}`).join(', ')}{clash.length > 3 ? ` 외 ${clash.length - 3}건` : ''}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/** 기준 시각(KST 'YYYY-MM-DD HH:MM')부터 days일 안에 걸리는 선석 겹침 구간 */
function clashesOf(start, days, overlaps) {
  const t = (x) => Date.parse(`${x.replace(' ', 'T')}:00+09:00`)
  const t0 = t(start), t1 = t0 + days * 864e5
  return overlaps.filter((w) => t(w.start) < t1 && t(w.end) > t0)
}
