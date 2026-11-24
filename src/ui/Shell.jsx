// 콘솔 틀: 상단 명령 바 · 왼쪽 레일 · 작업 영역 · 하단 상태 바. 화면 내용은 children.
import { useEffect, useState } from 'react'
import { Button, HTMLSelect, Icon, Menu, MenuDivider, MenuItem, Popover, Tooltip } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { useInbox } from '../state/useInbox.js'
import { NAV, canUse, groupOf } from '../lib/workspace.js'
import { money } from '../lib/time.js'
import { toggleTheme, useTheme } from '../state/theme.js'

export function ThemeToggle() {
  const theme = useTheme()
  const next = theme === 'dark' ? '라이트' : '다크'
  return (
    <Tooltip content={`${next} 모드로 전환`} placement="bottom">
      <Button variant="minimal" size="small" icon={theme === 'dark' ? 'flash' : 'moon'} aria-label={`${next} 모드로 전환`} onClick={toggleTheme} />
    </Tooltip>
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

function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  // 로캘 시각 문자열은 브라우저마다 '13시 10분'처럼 달라서 직접 맞춘다.
  const kst = new Date(now.getTime() + 9 * 3600e3)
  const iso = kst.toISOString()
  const day = iso.slice(0, 10)
  const time = iso.slice(11, 19)
  return (
    <span className="clock mono">
      <span className="faint">{day}</span> <b>{time}</b> <span className="faint">KST</span>
    </span>
  )
}

export function Shell({ children }) {
  const { role, isScheduler, tab, go, scenarioId, setScenarioId, logout, resetDemo, current, version, result, tour } = useApp()
  const menus = NAV.filter((g) => canUse(role.id, g))
  const group = groupOf(tab)
  const stale = isScheduler && current && current.version !== version
  const best = result.error ? null : result.candidates[0]
  const { unread } = useInbox()

  return (
    <div className="app">
      <header className="topbar">
        <button className="topbar-brand" onClick={() => go(role.home)}>
          <Brand />
          <span className="topbar-sub">체선료 최적화 콘솔</span>
        </button>
        <span className="topbar-op mono">ULSAN CLX · LIQUID BERTH SK3 / SK5 / SK6</span>
        <div className="topbar-right">
          {isScheduler && (
            <label className="scen-select" id="scen" data-tour="scen">
              <span className="faint tiny">시연 데이터</span>
              <HTMLSelect minimal value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} aria-label="시나리오"
                options={[{ value: 'S1', label: 'S1 기상 악화일 집중' }, { value: 'S2', label: 'S2 평시' }, { value: 'S3', label: 'S3 대형선 지연' }]} />
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
                {it.id === 'inbox' && unread > 0 && <span className="rail-badge num" aria-label={`새 알림 ${unread}건`}>{unread}</span>}
              </button>
            ))}
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
        {isScheduler && !result.error && <span>{result.explored.toLocaleString()} PLANS EVALUATED · {result.distinct.toLocaleString()} DISTINCT</span>}
        {isScheduler && best && <span>BEST {best.label.replace('후보 ', 'CAND-')} {money(best.total)}</span>}
        <span>PLAN {current ? `${current.label.replace('후보 ', 'CAND-')} v${current.planNo}` : 'NOT FIXED'}</span>
        <span className="statusbar-right">가상 데이터 · 의사결정 보조용 예상값 · 지도 © OpenStreetMap contributors</span>
      </footer>
    </div>
  )
}
