// 콘솔 틀: 상단 명령 바 · 왼쪽 레일 · 작업 영역 · 하단 상태 바. 화면 내용은 children.
import { Button, HTMLSelect, Icon, Menu, MenuDivider, MenuItem, Popover, Tooltip } from '@blueprintjs/core'
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
            <label className="scen-select" id="scen" data-tour="scen">
              <span className="faint tiny">데이터셋</span>
              <HTMLSelect minimal value={scenarioId ?? ''} onChange={(e) => setScenarioId(e.target.value)} aria-label="데이터셋"
                options={datasets.length ? datasets.map((d) => ({ value: d.id, label: d.label })) : [{ value: '', label: '불러오는 중' }]} />
            </label>
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
