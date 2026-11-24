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
  // 두 부두 사이에 배 한 척이 들어간 모양의 기하 표식(직접 그린 SVG).
  return (
    <span className="brand" style={{ fontSize: size }}>
      <svg width={size + 5} height={size + 5} viewBox="0 0 20 20" aria-hidden="true">
        <rect x="1" y="2" width="3" height="16" fill="currentColor" opacity="0.55" />
        <rect x="16" y="2" width="3" height="16" fill="currentColor" opacity="0.55" />
        <path d="M6 8h8l-1.5 6h-5z" fill="var(--accent)" />
      </svg>
      <b>D-MIN</b>
    </span>
  )
}

// 시계 자리에는 데이터셋의 기준 시각 T(화면의 「지금」)를 보인다. 실제 오늘 날짜와 섞이면 재생 중인 데이터가 헷갈린다.
function Clock() {
  const { scen } = useApp()
  return (
    <Tooltip content="데이터셋 기준 시각 T. 화면의 「지금」이며, 엔진은 이 시각 뒤의 일을 보지 않습니다" placement="bottom">
      <span className="clock mono">
        <span className="faint">기준</span> <b>{scen ? fmtFull(0) : '-'}</b> <span className="faint">KST</span>
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
        <span className="topbar-op mono">ULSAN SK · {scen ? `${scen.berths.length} BERTHS / ${scen.vessels.length} VESSELS` : 'LOADING'}</span>
        <div className="topbar-right">
          {isScheduler && (
            <label className="scen-select" id="scen" data-tour="scen">
              <span className="faint tiny">데이터셋</span>
              <HTMLSelect minimal value={scenarioId ?? ''} onChange={(e) => setScenarioId(e.target.value)} aria-label="데이터셋"
                options={datasets.length ? datasets.map((d) => ({ value: d.id, label: d.label })) : [{ value: '', label: '불러오는 중' }]} />
            </label>
          )}
          <Clock />
          <FontScale />
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
              <span className="who-dot" />{role.name}
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
                <Icon icon="warning-sign" size={12} /><span>돌발 상황</span><span className="rail-badge num hot" aria-label={`돌발 상황 ${incidents.length}건`}>{incidents.length}</span>
              </button>,
            ] : [])}
          </div>
        ))}
        <div className="rail-status">
          <div className="rail-head">계획 상태</div>
          {current ? (
            <p className={stale ? 'c-amber' : 'c-green'}>
              <span className="strong">{current.label} {current.status}</span>
              {stale && <span className="small block">입력 바뀜 · 재확인 필요</span>}
            </p>
          ) : <p className="muted strong">확정 전</p>}
        </div>
      </nav>

      <main className="work">{children}</main>

      <footer className="statusbar mono">
        <span className="st live">{isScheduler ? scenarioId : 'SCHEDULE'}</span>
        {isScheduler && <span>INPUT v{version}</span>}
        {isScheduler && best && <span>ENGINE CP-SAT · {result.candidates.length} PLANS · {best.status}{result.running ? ' · RECALCULATING' : result.stale ? ' · STALE' : ''}</span>}
        {isScheduler && result.baseline && <span>ACTUAL {money(result.baseline.total)}</span>}
        {isScheduler && best && <span>BEST {best.label.replace('후보 ', 'CAND-')} {money(best.total)}</span>}
        <span>PLAN {current ? `${current.label.replace('후보 ', 'CAND-')} v${current.planNo}` : 'NOT FIXED'}</span>
        <span className="statusbar-right">{scen ? `${scen.bundle} · 실제 접안 실적 + 합성 값, 계약은 가상` : ''} · 지도 © OpenStreetMap contributors</span>
      </footer>
    </div>
  )
}
