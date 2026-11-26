// 이용자 확정 접안 일정 (11-20 피드백 반영, 11-24 실데이터: 선석 24개, 부두 10곳)
//  - 내 부두(로그인 계정의 담당 부두) 선박을 강조하고, 접안까지 남은 시간을 크게
//  - 접안 중 / 예정 / 완료 구분, 부두별 보기(부두 안에서 선석별), 차트 보기, 부두 거르기, 날짜 탭
//  - 부두 담당 팀과 주 책임자(연락용, 가상 값)
//  - 확정본(activePlan() 스냅숏)만 보인다. 검토 중인 후보와 금액은 보이지 않는다.
import { useMemo, useState } from 'react'
import { Callout, SegmentedControl } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { activePlan, useWorkspace } from '../lib/workspace.js'
import { pierName, pierOf } from '../lib/dataset.js'
import { PIER_TEAMS } from '../lib/teams.js'
import { isNight } from '../lib/plan.js'
import { NOW, dayStart, fmt, fmtDur } from '../lib/time.js'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import './decide.css'

// 이용자 계정의 담당 부두. workspace.js의 ROLES.user.myBerth는 목 데이터 시절 값('B2')이 남아 있어 여기서 쓰지 않는다.
// 이용자 팀은 「SK 3부두 하역 1팀」(ROLES.user.team)이므로 담당 부두를 SK 3부두(pier '3')로 둔다.
const MY_PIER = '3'
const PIER_ORDER = ['1', '2', '3', '4', '5', '6', '7', '8', 'BUOY', 'GAS']
const pierRank = (p) => (p === MY_PIER ? -1 : PIER_ORDER.indexOf(p) === -1 ? 99 : PIER_ORDER.indexOf(p))
const pierShort = (p) => (p === 'BUOY' ? '부이' : p === 'GAS' ? '가스' : `${p}부두`)
const byBerth = (a, b) => a.localeCompare(b, 'en', { numeric: true })
const phase = (p) => (p.etu <= NOW ? 'done' : p.etb <= NOW ? 'on' : 'next')
const PHASE = { on: ['live', '접안 중'], next: ['idle', '예정'], done: ['idle', '완료'] }
const dayOf = (m) => fmt(dayStart(m)).split(' ')[0]
const teamOfPier = (p) => PIER_TEAMS[p]

export default function Schedule() {
  const { role } = useApp()
  useWorkspace()
  const plan = activePlan()
  const myTeam = teamOfPier(MY_PIER)
  const [view, setView] = useState('list')
  const [day, setDay] = useState('all')
  const [pierSel, setPierSel] = useState('all')
  const days = useMemo(() => (plan ? [...new Map(plan.placements.map((p) => [dayOf(p.etb), dayStart(p.etb)])).entries()].sort((a, b) => a[1] - b[1]) : []), [plan])
  // 확정본에 나오는 부두와 그 선석: 내 부두 먼저, 그다음 부두 번호 순
  const piers = useMemo(() => {
    if (!plan) return []
    const m = new Map()
    for (const p of plan.placements) {
      const pr = pierOf(p.bid)
      if (!m.has(pr)) m.set(pr, new Map())
      m.get(pr).set(p.bid, p.berth ?? p.bid)
    }
    return [...m.entries()].sort((a, b) => pierRank(a[0]) - pierRank(b[0]))
      .map(([id, berths]) => ({ id, name: pierName(id), berths: [...berths.entries()].sort((a, b) => byBerth(a[0], b[0])) }))
  }, [plan])

  if (!plan) {
    return (
      <Screen tab="ops" title="확정 접안 일정" actions={<St tone="idle">확정 대기</St>} bodyClass="schedule-page">
        <Callout className="schedule-empty" icon="info-sign" title="아직 확정된 접안 계획이 없습니다.">
          스케줄러가 계획을 확정하면 이 화면과 메일함으로 바로 알려 드립니다. 확정 전 후보 일정은 보여 드리지 않습니다.
        </Callout>
        <Panel code="MY-BERTH" title="내 담당" pad>
          <p className="small">{role.team}, {myTeam.lead}, 담당 부두 {pierName(MY_PIER)} (연락처 <span className="num">{myTeam.tel}</span>, 가상)</p>
        </Panel>
      </Screen>
    )
  }

  const mine = (p) => pierOf(p.bid) === MY_PIER
  const inDay = (p) => day === 'all' || dayOf(p.etb) === day
  const inPier = (p) => pierSel === 'all' || (pierSel === 'mine' ? mine(p) : pierOf(p.bid) === pierSel)
  const rows = plan.placements.filter((p) => inDay(p) && inPier(p))
  const shownPiers = piers.filter((pr) => pierSel === 'all' || (pierSel === 'mine' ? pr.id === MY_PIER : pr.id === pierSel))
  const myNext = plan.placements.filter((p) => mine(p) && p.etb > NOW).sort((a, b) => a.etb - b.etb)[0]
  const myNow = plan.placements.find((p) => mine(p) && phase(p) === 'on')
  const t0 = Math.min(NOW, ...plan.placements.map((p) => p.etb)) - 60
  const t1 = Math.max(...plan.placements.map((p) => p.etu)) + 60
  const X = (m) => `${((m - t0) / (t1 - t0)) * 100}%`

  return (
    <Screen tab="ops" title="확정 접안 일정" actions={<St tone="live">확정 v{plan.no} 적용 중, {plan.at}</St>} bodyClass="schedule-page">
      <Stats items={[
        { label: '내 부두 다음 접안', value: myNext ? <span className="schedule-prose">{myNext.name}</span> : '-', sub: myNext ? `${myNext.berth}, ${fmt(myNext.etb)}` : '예정 없음', tone: 'accent' },
        { label: '접안까지', value: myNext ? <span className="num">{fmtDur(myNext.etb - NOW)}</span> : '-', sub: `지금 ${fmt(NOW)} 기준`, tone: myNext && myNext.etb - NOW < 6 * 60 ? 'amber' : undefined },
        { label: '내 부두 지금', value: <span className="schedule-prose">{myNow ? myNow.name : '비어 있음'}</span>, sub: myNow ? `작업 종료 ${fmt(myNow.etu)}` : '' },
        { label: '내 담당', value: <span className="schedule-prose">{role.team}</span>, sub: `${myTeam.lead}, ${myTeam.tel} (가상)` },
      ]} />

      <div className="sch-bar" style={{ flexWrap: 'wrap', rowGap: 8 }}>
        <SegmentedControl size="small" value={view} onValueChange={setView} options={[{ value: 'list', label: '목록' }, { value: 'berth', label: '부두별' }, { value: 'chart', label: '차트' }]} />
        <nav className="sch-days" aria-label="부두">
          {[['all', '전체 부두'], ['mine', '내 부두'], ...piers.filter((pr) => pr.id !== MY_PIER).map((pr) => [pr.id, pierShort(pr.id)])].map(([id, label]) => <button type="button" key={id} className={pierSel === id ? 'on' : ''} onClick={() => setPierSel(id)}>{label}</button>)}
        </nav>
        <nav className="sch-days" aria-label="날짜">
          {[['all', '전체'], ...days.map(([d]) => [d, d])].map(([id, label]) => <button type="button" key={id} className={day === id ? 'on' : ''} onClick={() => setDay(id)}>{label}</button>)}
        </nav>
        <span className="small muted sch-legend"><i className="sch-mine-key" />내 부두({pierName(MY_PIER)})</span>
      </div>

      {view === 'list' && (
        <Panel code="BERTH-ORDER" title="접안 순서" desc={`접안 시각 순, 확정본만, ${rows.length}척`}>
          <table className="dt schedule-table">
            <thead><tr><th>상태</th><th className="c">순서</th><th>선박</th><th>화물</th><th>선석</th><th>담당 팀, 책임자 (가상)</th><th>도착</th><th>접안</th><th className="r">접안까지</th><th>작업 종료</th><th>주의</th></tr></thead>
            <tbody>{rows.map((p) => {
              const ph = phase(p)
              const team = teamOfPier(pierOf(p.bid))
              return (
                <tr key={p.vid} className={`${mine(p) ? 'sch-mine' : ''} sch-${ph}`}>
                  <td><St tone={PHASE[ph][0]}>{PHASE[ph][1]}</St></td>
                  <td className="c num faint">{String(plan.placements.indexOf(p) + 1).padStart(2, '0')}</td>
                  <td className="strong">{p.name}</td>
                  <td className="schedule-cargo">{p.product} {p.dir}, <span className="num">{p.ton?.toLocaleString() ?? '-'}t</span></td>
                  <td>{p.berth ?? p.bid}</td>
                  <td className="small">{team?.team ?? '-'}<br /><span className="muted">{team ? `${team.lead}, ${team.tel}` : ''}</span></td>
                  <td className="num">{fmt(p.eta)}</td>
                  <td className="num"><span className="c-accent strong">{fmt(p.etb)}</span></td>
                  <td className={`r num ${ph === 'next' && p.etb - NOW < 6 * 60 ? 'c-amber strong' : ''}`}>{ph === 'next' ? fmtDur(p.etb - NOW) : ph === 'on' ? '작업 중' : '-'}</td>
                  <td className="num">{fmt(p.etu)}</td>
                  <td>{isNight(p.etb) ? <span className="chip amber schedule-flag">야간 접안</span> : <span className="faint">-</span>}</td>
                </tr>
              )
            })}</tbody>
          </table>
          {!rows.length && <p className="small muted" style={{ padding: '12px 14px', margin: 0 }}>고른 조건에 맞는 접안 일정이 없습니다.</p>}
        </Panel>
      )}

      {view === 'berth' && (
        <div className="sch-berths">
          {shownPiers.map((pr) => {
            const team = teamOfPier(pr.id)
            return (
              <Panel key={pr.id} code={pr.id === MY_PIER ? 'MY-BERTH' : 'BERTH'} title={pr.name} desc={team ? `${team.team}, ${team.lead}` : ''} className={pr.id === MY_PIER ? 'sch-mine-panel' : ''} pad>
                {pr.berths.map(([bid, name]) => {
                  const list = plan.placements.filter((p) => p.bid === bid && inDay(p))
                  return (
                    <div key={bid}>
                      <div className="small strong" style={{ margin: '4px 0 6px' }}>{name} <span className="muted num">{list.length}척</span></div>
                      {list.length ? list.map((p) => (
                        <div key={p.vid} className={`sch-card sch-${phase(p)}`}>
                          <div><St tone={PHASE[phase(p)][0]}>{PHASE[phase(p)][1]}</St> <b>{p.name}</b></div>
                          <div className="num small">{fmt(p.etb)} → {fmt(p.etu)}</div>
                          <div className="small muted">{p.product} {p.dir}, {p.ton?.toLocaleString() ?? '-'}t{phase(p) === 'next' ? `, ${fmtDur(p.etb - NOW)} 뒤 접안` : ''}</div>
                        </div>
                      )) : <p className="small muted" style={{ margin: '0 0 8px' }}>이 날짜에 접안 없음</p>}
                    </div>
                  )
                })}
              </Panel>
            )
          })}
        </div>
      )}

      {view === 'chart' && (
        <Panel code="BERTH-GANTT" title="선석별 접안 차트" desc="막대 = 접안부터 작업 종료까지, 세로선 = 지금, 부두 순서(내 부두 먼저)" pad>
          <div className="sch-gantt">
            <div className="sch-gantt-axis">{days.map(([d, at]) => <span key={d} style={{ left: X(Math.max(at, t0)) }}>{d}</span>)}</div>
            {shownPiers.flatMap((pr) => pr.berths.map(([bid, name]) => (
              <div key={bid} className={`sch-gantt-row ${pr.id === MY_PIER ? 'mine' : ''}`}>
                <span className="sch-gantt-name" title={name}>{name.replace(/^SK /, '')}</span>
                <div className="sch-gantt-track">
                  {plan.placements.filter((p) => p.bid === bid).map((p) => <span key={p.vid} className={`sch-bar-item sch-${phase(p)}`} style={{ left: X(p.etb), width: `calc(${X(p.etu)} - ${X(p.etb)})` }} title={`${p.name} ${fmt(p.etb)}~${fmt(p.etu)}`}>{p.name}</span>)}
                  <i className="sch-now" style={{ left: X(NOW) }} />
                </div>
              </div>
            )))}
          </div>
        </Panel>
      )}
      <p className="schedule-snapshot small muted">확정 당시 일정입니다. 스케줄러가 새로 확정하기 전까지 바뀌지 않습니다. 검토 중인 후보와 체선료 금액은 보이지 않습니다. 하역팀 연락처는 가상 값입니다.</p>
    </Screen>
  )
}
