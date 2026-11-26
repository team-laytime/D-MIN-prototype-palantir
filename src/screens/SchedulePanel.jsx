// 운영 현황 오른쪽 사이드 패널 (11-23 사이드 픽, OFFLIGHT 방식을 오른쪽 기준으로 옮김)
//  - 지도 위에 덮지 않고 지도를 밀어내며 스르륵 열린다(폭 0 → 440, 내용은 오른쪽에서 살짝 들어오며 나타남)
//  - 머리: 패널 아이콘, 제목, 작은 아이콘 버튼. 머리 아래 탭은 부두(묶음) 단위다: 전체, SK1~SK8, 부이, 가스
//    (11-24 실데이터: 선석 24개를 탭으로 두면 너무 많아 부두로 묶고, 부두 안에서 선석 상태를 줄로 보인다)
//  - 목록: 접히는 묶음(지금 작업 중, 다음 접안, 이후, 완료), 항목 아래에 작은 메타 줄
import { useMemo, useState } from 'react'
import { Button, Icon } from '@blueprintjs/core'
import { PIER_TEAMS } from '../lib/teams.js'
import { NOW, fmt, fmtDur } from '../lib/time.js'

const GROUPS = [
  { key: 'on', label: '지금 작업 중' },
  { key: 'next', label: '다음 24시간 접안' },
  { key: 'later', label: '이후' },
  { key: 'done', label: '완료' },
]
const H72 = 72 * 60
const tabLabel = (pier) => (pier === 'BUOY' ? '부이' : pier === 'GAS' ? '가스' : `${pier}부두`)

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

/** 72시간 막대. g0 = 시간축 왼쪽 끝 */
function Bar({ p, v, g0, t, label = true }) {
  const left = Math.max(0, (p.etb - g0) / H72) * 100
  const width = (Math.min(p.etu, g0 + H72) - Math.max(p.etb, g0)) / H72 * 100
  const st = p.etu <= t ? 'done' : p.etb <= t ? 'on' : ''
  return <span className={`home-sched-bar ${st}`} style={{ left: `${left}%`, width: `${width}%` }} title={`${v?.name ?? p.vid} ${fmt(p.etb)}~${fmt(p.etu)}`}>{label ? v?.name ?? p.vid : null}</span>
}

export default function SchedulePanel({ open, tab, setTab, onClose, fixed, current, plan, scen, states, t, berthSel, berthStatus, onOpenVessel, onPickBerth, onPickPier, go }) {
  const vById = useMemo(() => Object.fromEntries(scen.vessels.map((v) => [v.id, v])), [scen])
  const bById = useMemo(() => Object.fromEntries(scen.berths.map((b) => [b.id, b])), [scen])
  // 부두(묶음): 선석이 있는 부두만, 데이터셋 순서대로
  const piers = useMemo(() => {
    const out = new Map()
    for (const b of scen.berths) {
      if (!out.has(b.pier)) out.set(b.pier, { id: b.pier, name: b.pierName, berths: [] })
      out.get(b.pier).berths.push(b)
    }
    return [...out.values()]
  }, [scen])
  const pier = tab !== 'all' ? piers.find((p) => p.id === tab) : null
  const inPier = (bid) => !pier || bById[bid]?.pier === pier.id
  const rows = [...plan.placements].filter((p) => inPier(p.bid)).sort((a, b) => a.etb - b.etb)
  const groupOf = (p) => (p.etu <= t ? 'done' : p.etb <= t ? 'on' : p.etb <= t + 24 * 60 ? 'next' : 'later')
  const phaseOf = (p) => states.find((s) => s.v.id === p.vid)?.phase
  const team = pier && PIER_TEAMS[pier.id]
  // 72시간 차트의 왼쪽 끝: 처음 하루는 지금부터, 그 뒤로는 지도 시각 하루 전부터
  const g0 = t <= NOW + 24 * 60 ? NOW : t - 24 * 60
  const pierBusy = (p) => p.berths.filter((b) => berthStatus(b).key === 'busy').length
  const pierKey = (p) => (p.berths.some((b) => berthStatus(b).key === 'blocked') ? 'blocked' : pierBusy(p) ? 'busy' : 'idle')
  const inWindow = (p) => p.etu > g0 && p.etb < g0 + H72

  return (
    <aside className={`sp ${open ? 'open' : ''}`} aria-hidden={!open} inert={!open}>
      <div className="sp-inner">
        <header className="sp-head">
          <Button variant="minimal" size="small" icon="drawer-right-filled" aria-label="패널 닫기" title="패널 닫기 ( ] )" onClick={onClose} />
          <h2>스케줄 현황</h2>
          <span className={`sp-badge ${fixed ? 'ok' : ''}`}>{fixed ? `${current.status}, ${current.label}` : `확정 전, ${plan.label} 예상`}</span>
          <span className="sp-time num">{fmt(t)}</span>
        </header>
        <nav className="sp-tabs" aria-label="부두 거르기">
          <button type="button" className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>전체</button>
          {piers.map((p) => (
            <button type="button" key={p.id} className={tab === p.id ? 'on' : ''} onClick={() => onPickPier(p.id)} title={`${p.name}, 선석 ${p.berths.length}개`}>
              <i className={`home-dot st-${pierKey(p)}`} />{tabLabel(p.id)}
            </button>
          ))}
        </nav>

        <div className="sp-body">
          {pier && (
            <div className="sp-berths">
              <div className="sp-berths-head"><b>{pier.name}</b><span className="small muted">선석 {pier.berths.length}개, 작업 중 <b className="num">{pierBusy(pier)}</b></span></div>
              {team && <div className="sp-meta">
                <span><Icon icon="people" size={11} />{team.team} (가상)</span>
                <span><Icon icon="person" size={11} />{team.lead}</span>
                <span><Icon icon="phone" size={11} /><span className="num">{team.tel}</span> (가상)</span>
              </div>}
              {pier.berths.map((b) => {
                const st = berthStatus(b)
                const occ = st.occupant
                return (
                  <button type="button" key={b.id} className={`sp-brow ${berthSel === b.id ? 'sel' : ''}`} onClick={() => onPickBerth(berthSel === b.id ? null : b.id)} aria-pressed={berthSel === b.id}>
                    <span className="sp-brow-code">{b.code}</span>
                    <span>{occ ? <>{occ.v?.name ?? occ.p.vid} <b className="num">{Math.round(occ.progress * 100)}%</b></> : <span className="muted">{st.text}</span>}</span>
                    <span className={`home-map-berth st-${st.key}`}>{st.key === 'busy' ? '작업 중' : st.text}</span>
                    <span className="sp-brow-sub">
                      {occ ? `${fmtDur(occ.p.etu - t)} 남음, 이안 ${fmt(occ.p.etu)}` : st.next ? `다음 ${vById[st.next.vid]?.name ?? st.next.vid} ${fmt(st.next.etb)}` : '이후 접안 예정 없음'}
                      {occ && st.next ? `, 다음 ${fmt(st.next.etb)}` : ''}
                    </span>
                    {occ && <span className="home-bdetail-bar"><i style={{ width: `${Math.round(occ.progress * 100)}%` }} /></span>}
                    <span className="sp-brow-sub tiny">DWT {b.maxDwt?.toLocaleString() ?? '-'} 이하, 흘수 {b.maxDraft ?? '-'}m, LOA {b.maxLoa ?? '-'}m{b.products?.length ? `, ${b.products.slice(0, 4).join(', ')}${b.products.length > 4 ? ' 외' : ''}` : ''}{b.approxPos ? ', 지도 위치는 근사값' : ''}</span>
                  </button>
                )
              })}
            </div>
          )}

          {!fixed && (
            <div className="sp-empty">
              <Icon icon="calendar" size={20} />
              <p className="strong">확정된 스케줄이 없습니다</p>
              <p className="small muted">아래는 {plan.label}(체선료 최저) 기준 예상입니다. 「후보 비교·확정」에서 확정하면 {pier ? `${pier.name}의 ` : ''}확정 스케줄과 예정 경로로 바뀝니다.</p>
              <Button size="small" intent="primary" icon="comparison" onClick={() => go('compare')}>후보 비교·확정으로</Button>
            </div>
          )}

          <Group label={pier ? `선석별 72시간 (${fmt(g0)}부터)` : `부두별 72시간 (${fmt(g0)}부터, 줄 하나 = 선석 하나)`} count={pier ? pier.berths.length : piers.length}>
            <div className="home-sched-gantt">
              {pier
                ? pier.berths.map((b) => <div key={b.id} className={`home-sched-row ${berthSel === b.id ? 'sel' : ''}`}><span className="home-sched-name">{b.code}</span><div className="home-sched-track">
                  {plan.placements.filter((p) => p.bid === b.id && inWindow(p)).map((p) => <Bar key={p.vid} p={p} v={vById[p.vid]} g0={g0} t={t} />)}
                  <i className="home-sched-now" style={{ left: `${(t - g0) / H72 * 100}%` }} />
                </div></div>)
                : piers.map((pr) => <div key={pr.id} className="home-sched-row pier" role="button" tabIndex={0} onClick={() => onPickPier(pr.id)} onKeyDown={(e) => { if (e.key === 'Enter') onPickPier(pr.id) }} title={`${pr.name} 보기`}><span className="home-sched-name">{tabLabel(pr.id)}</span><div className="home-sched-track">
                  {pr.berths.map((b) => <div key={b.id} className="home-sched-lane">
                    {plan.placements.filter((p) => p.bid === b.id && inWindow(p)).map((p) => <Bar key={p.vid} p={p} v={vById[p.vid]} g0={g0} t={t} label={false} />)}
                  </div>)}
                  <i className="home-sched-now" style={{ left: `${(t - g0) / H72 * 100}%` }} />
                </div></div>)}
              <div className="home-sched-axis">{[0, 24, 48, 72].map((h) => <span key={h} className="num">{fmt(g0 + h * 60)}</span>)}</div>
            </div>
          </Group>

          {GROUPS.map((g) => {
            const list = rows.filter((p) => groupOf(p) === g.key)
            if (!list.length) return null
            return (
              <Group key={`${tab}-${g.key}`} label={g.label} count={list.length} open={g.key === 'on' || g.key === 'next' || (g.key === 'later' && !!pier)}>
                {list.map((p) => {
                  const v = vById[p.vid]
                  const ph = phaseOf(p)
                  return (
                    <button type="button" key={p.vid} className={`sp-item ${g.key}`} onClick={() => onOpenVessel(p.vid)}>
                      <i className={`sp-check ${g.key}`} aria-hidden="true" />
                      <span className="sp-item-name">{v?.name ?? p.vid}<span className="muted">, {v?.product} {v?.dir}</span></span>
                      <span className="sp-meta">
                        <span><Icon icon="time" size={11} />접안 <span className="num">{fmt(p.etb)}</span></span>
                        <span className="sp-code">{bById[p.bid]?.code ?? p.bid}</span>
                        <span className="sp-chip"><Icon icon="flag" size={10} />이안 <span className="num">{fmt(p.etu)}</span></span>
                        {ph === 'waiting' && <span className="c-amber">정박지 대기 {fmtDur(t - (p.eta ?? v.eta))}</span>}
                        {g.key === 'next' && <span className="c-accent">{fmtDur(p.etb - t)} 뒤</span>}
                        {p.night && <span className="muted">야간 접안</span>}
                      </span>
                    </button>
                  )
                })}
              </Group>
            )
          })}
          {!pier && <p className="sp-note tiny muted">[제안] 우측 전체 스케줄은 팀 토의 중인 안입니다. 하역팀 연락처는 가상 값입니다.</p>}
        </div>
      </div>
    </aside>
  )
}
