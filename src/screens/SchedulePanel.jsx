// 운영 현황 오른쪽 사이드 패널 (11-23 사이드 픽, OFFLIGHT 방식을 오른쪽 기준으로 옮김)
//  - 지도 위에 덮지 않고 지도를 밀어내며 스르륵 열린다(폭 0 → 440, 내용은 오른쪽에서 살짝 들어오며 나타남)
//  - 머리: 패널 아이콘 · 제목 · 작은 아이콘 버튼. 부두는 머리 아래 탭으로 거른다(전체 · 부두별)
//  - 목록: 접히는 묶음(지금 작업 중 · 다음 접안 · 이후 · 완료), 항목 아래에 작은 메타 줄
import { useState } from 'react'
import { Button, Icon } from '@blueprintjs/core'
import { BERTH_TEAMS } from '../lib/scenarios.js'
import { NOW, fmt, fmtDur } from '../lib/time.js'

const GROUPS = [
  { key: 'on', label: '지금 작업 중' },
  { key: 'next', label: '다음 24시간 접안' },
  { key: 'later', label: '이후' },
  { key: 'done', label: '완료' },
]

function Group({ label, count, children, open: open0 = true }) {
  const [open, setOpen] = useState(open0)
  return (
    <section className="sp-group">
      <button type="button" className="sp-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon icon={open ? 'chevron-down' : 'chevron-right'} size={12} /><span>{label}</span><span className="sp-count num">{count}</span>
      </button>
      {open && <div className="sp-group-body">{children}</div>}
    </section>
  )
}

export default function SchedulePanel({ open, tab, setTab, onClose, fixed, current, plan, scen, states, t, berthStatus, onOpenVessel, onPickBerth, go }) {
  const vById = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  const bById = Object.fromEntries(scen.berths.map((b) => [b.id, b]))
  const berth = tab !== 'all' ? bById[tab] : null
  const rows = [...plan.placements].filter((p) => !berth || p.bid === berth.id).sort((a, b) => a.etb - b.etb)
  const groupOf = (p) => (p.etu <= t ? 'done' : p.etb <= t ? 'on' : p.etb <= t + 24 * 60 ? 'next' : 'later')
  const phaseOf = (p) => states.find((s) => s.v.id === p.vid)?.phase
  const st = berth && berthStatus(berth)
  const team = berth && BERTH_TEAMS[berth.id]
  const H72 = 72 * 60

  return (
    <aside className={`sp ${open ? 'open' : ''}`} aria-hidden={!open} inert={open ? undefined : ''}>
      <div className="sp-inner">
        <header className="sp-head">
          <Button variant="minimal" size="small" icon="drawer-right-filled" aria-label="패널 닫기" title="패널 닫기 ( ] )" onClick={onClose} />
          <h2>스케줄 현황</h2>
          <span className={`sp-badge ${fixed ? 'ok' : ''}`}>{fixed ? `${current.status} · ${current.label}` : '확정 전'}</span>
          <span className="sp-time num">{fmt(t)}</span>
        </header>
        <nav className="sp-tabs" aria-label="부두 거르기">
          <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>전체</button>
          {scen.berths.map((b) => (
            <button type="button" key={b.id} className={tab === b.id ? 'on' : ''} onClick={() => onPickBerth(b.id)}>
              <i className={`home-dot st-${berthStatus(b).key}`} />{b.code}
            </button>
          ))}
        </nav>

        <div className="sp-body">
          {berth && (
            <div className="sp-berth">
              <div className="sp-berth-top"><b>{berth.name}</b><span className={`home-map-berth st-${st.key}`}>{st.text}</span></div>
              {st.occupant ? (
                <div className="sp-berth-now">
                  <span className="small">지금 <button type="button" className="sp-link" onClick={() => onOpenVessel(st.occupant.v.id)}>{st.occupant.v.name}</button> 작업 <b className="num">{Math.round(st.occupant.progress * 100)}%</b> · {fmtDur(st.occupant.p.etu - t)} 남음</span>
                  <div className="home-bdetail-bar"><i style={{ width: `${Math.round(st.occupant.progress * 100)}%` }} /></div>
                </div>
              ) : berth.occupiedUntil !== null && t < berth.occupiedUntil ? <span className="small">기존 접안선 {berth.occupiedBy} · 이안 <span className="num">{fmt(berth.occupiedUntil)}</span></span> : <span className="small muted">지금 접안한 선박 없음</span>}
              <div className="sp-meta">
                <span><Icon icon="people" size={11} />{team.team} · {team.lead}</span>
                <span><Icon icon="phone" size={11} /><span className="num">{team.tel}</span></span>
                <span><Icon icon="wrench" size={11} />{berth.facility.maintenance ? `${berth.facility.maintenance.label} ${fmt(berth.facility.maintenance.start)}` : berth.facility.known ? '점검 일정 없음' : '점검 일정 미입력'}</span>
              </div>
            </div>
          )}

          {!fixed ? (
            <div className="sp-empty">
              <Icon icon="calendar" size={20} />
              <p className="strong">확정된 스케줄이 없습니다</p>
              <p className="small muted">지도는 지금 위치만 보여 줍니다. 「후보 비교·확정」에서 확정하면 {berth ? `${berth.name}의 ` : ''}스케줄과 예정 경로가 여기에 나옵니다.</p>
              <Button size="small" intent="primary" icon="comparison" onClick={() => go('compare')}>후보 비교·확정으로</Button>
            </div>
          ) : <>
            {!berth && (
              <Group label="부두별 72시간" count={scen.berths.length}>
                <div className="home-sched-gantt">
                  {scen.berths.map((b) => <div key={b.id} className="home-sched-row"><span className="home-sched-name">{b.code}</span><div className="home-sched-track">
                    {plan.placements.filter((p) => p.bid === b.id && p.etu > NOW && p.etb < NOW + H72).map((p) => <span key={p.vid} className="home-sched-bar" style={{ left: `${Math.max(0, (p.etb - NOW) / H72) * 100}%`, width: `${(Math.min(p.etu, NOW + H72) - Math.max(p.etb, NOW)) / H72 * 100}%` }} title={`${vById[p.vid].name} ${fmt(p.etb)}~${fmt(p.etu)}`}>{vById[p.vid].name}</span>)}
                    <i className="home-sched-now" style={{ left: `${(t - NOW) / H72 * 100}%` }} />
                  </div></div>)}
                  <div className="home-sched-axis"><span>지금</span><span>+24h</span><span>+48h</span><span>+72h</span></div>
                </div>
              </Group>
            )}
            {GROUPS.map((g) => {
              const list = rows.filter((p) => groupOf(p) === g.key)
              if (!list.length) return null
              return (
                <Group key={g.key} label={g.label} count={list.length} open={g.key !== 'done'}>
                  {list.map((p) => {
                    const v = vById[p.vid]
                    const ph = phaseOf(p)
                    return (
                      <button type="button" key={p.vid} className={`sp-item ${g.key}`} onClick={() => onOpenVessel(p.vid)}>
                        <i className={`sp-check ${g.key}`} aria-hidden="true" />
                        <span className="sp-item-name">{v.name}<span className="muted"> · {v.product} {v.dir}</span></span>
                        <span className="sp-meta">
                          <span><Icon icon="time" size={11} />접안 <span className="num">{fmt(p.etb)}</span></span>
                          <span><i className={`sp-dot b-${p.bid}`} />{bById[p.bid].code}</span>
                          <span className="sp-chip"><Icon icon="flag" size={10} />종료 <span className="num">{fmt(p.etu)}</span></span>
                          {ph === 'waiting' && <span className="c-amber">정박지 대기 {fmtDur(t - v.eta)}</span>}
                          {g.key === 'next' && <span className="c-accent">{fmtDur(p.etb - t)} 뒤</span>}
                        </span>
                      </button>
                    )
                  })}
                </Group>
              )
            })}
            {!berth && <p className="sp-note tiny muted">[제안] 우측 전체 스케줄은 팀 토의 중인 안입니다.</p>}
          </>}
        </div>
      </div>
    </aside>
  )
}
