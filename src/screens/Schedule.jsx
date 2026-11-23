// 이용자 확정 접안 일정 (11-20 피드백 반영)
//  - 내 부두(로그인 계정의 담당 부두) 선박을 강조하고, 접안까지 남은 시간을 크게
//  - 접안 중 / 예정 / 완료 구분, 부두별 보기, 차트 보기, 날짜 탭
//  - 부두 담당 팀과 주 책임자(연락용)
import { useMemo, useState } from 'react'
import { Callout, SegmentedControl } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { activePlan, useWorkspace } from '../lib/workspace.js'
import { BERTH_TEAMS } from '../lib/scenarios.js'
import { NOW, fmt, fmtDur } from '../lib/time.js'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import './decide.css'

const hourOf = (minute) => Math.floor((((minute % 1440) + 1440) % 1440) / 60)
const night = (p) => hourOf(p.etb) >= 20 || hourOf(p.etb) < 6
const phase = (p) => (p.etu <= NOW ? 'done' : p.etb <= NOW ? 'on' : 'next')
const PHASE = { on: ['live', '접안 중'], next: ['idle', '예정'], done: ['idle', '완료'] }
const dayOf = (m) => fmt(m).slice(0, 5)

export default function Schedule() {
  const { role } = useApp()
  useWorkspace()
  const plan = activePlan()
  const [view, setView] = useState('list')
  const [day, setDay] = useState('all')
  const days = useMemo(() => (plan ? [...new Set(plan.placements.map((p) => dayOf(p.etb)))] : []), [plan])

  if (!plan) {
    return (
      <Screen tab="ops" title="확정 접안 일정" actions={<St tone="idle">확정 대기</St>} bodyClass="schedule-page">
        <Callout className="schedule-empty" icon="info-sign" title="아직 확정된 접안 계획이 없습니다.">
          스케줄러가 계획을 확정하면 이 화면과 알림함으로 바로 알려 드립니다. 확정 전 후보 일정은 보여 드리지 않습니다.
        </Callout>
        <Panel code="MY-BERTH" title="내 담당" pad>
          <p className="small">{role.team} · {BERTH_TEAMS[role.myBerth].lead} · 담당 부두 SK 3부두</p>
        </Panel>
      </Screen>
    )
  }

  const mine = (p) => p.bid === role.myBerth
  const rows = plan.placements.filter((p) => day === 'all' || dayOf(p.etb) === day)
  const myNext = plan.placements.filter((p) => mine(p) && p.etb > NOW).sort((a, b) => a.etb - b.etb)[0]
  const myNow = plan.placements.find((p) => mine(p) && phase(p) === 'on')
  const t0 = Math.min(NOW, ...plan.placements.map((p) => p.etb)) - 60
  const t1 = Math.max(...plan.placements.map((p) => p.etu)) + 60
  const X = (m) => `${((m - t0) / (t1 - t0)) * 100}%`
  const berths = [...new Map(plan.placements.map((p) => [p.bid, p.berth])).entries()].sort((a, b) => (a[0] === role.myBerth ? -1 : b[0] === role.myBerth ? 1 : a[1].localeCompare(b[1])))

  return (
    <Screen tab="ops" title="확정 접안 일정" actions={<St tone="live">확정 v{plan.no} 적용 중 · {plan.at}</St>} bodyClass="schedule-page">
      <Stats items={[
        { label: '내 부두 다음 접안', value: myNext ? <span className="schedule-prose">{myNext.name}</span> : '-', sub: myNext ? `${myNext.berth} · ${fmt(myNext.etb)}` : '예정 없음', tone: 'accent' },
        { label: '접안까지', value: myNext ? <span className="num">{fmtDur(myNext.etb - NOW)}</span> : '-', sub: `지금 ${fmt(NOW)} 기준`, tone: myNext && myNext.etb - NOW < 6 * 60 ? 'amber' : undefined },
        { label: '내 부두 지금', value: <span className="schedule-prose">{myNow ? myNow.name : '비어 있음'}</span>, sub: myNow ? `작업 종료 ${fmt(myNow.etu)}` : '' },
        { label: '내 담당', value: <span className="schedule-prose">{role.team}</span>, sub: `${BERTH_TEAMS[role.myBerth].lead} · ${BERTH_TEAMS[role.myBerth].tel}` },
      ]} />

      <div className="sch-bar">
        <SegmentedControl size="small" value={view} onValueChange={setView} options={[{ value: 'list', label: '목록' }, { value: 'berth', label: '부두별' }, { value: 'chart', label: '차트' }]} />
        <nav className="sch-days" aria-label="날짜">
          {[['all', '전체'], ...days.map((d) => [d, d])].map(([id, label]) => <button type="button" key={id} className={day === id ? 'on' : ''} onClick={() => setDay(id)}>{label}</button>)}
        </nav>
        <span className="small muted sch-legend"><i className="sch-mine-key" />내 부두({BERTH_TEAMS[role.myBerth].team.split(' 하역')[0]})</span>
      </div>

      {view === 'list' && (
        <Panel code="BERTH-ORDER" title="접안 순서" desc="접안 시각 순 · 확정본만">
          <table className="dt schedule-table">
            <thead><tr><th>상태</th><th className="c">순서</th><th>선박</th><th>화물</th><th>부두</th><th>담당 팀 · 책임자</th><th>도착</th><th>접안</th><th className="r">접안까지</th><th>작업 종료</th><th>주의</th></tr></thead>
            <tbody>{rows.map((p) => {
              const ph = phase(p)
              const team = BERTH_TEAMS[p.bid]
              return (
                <tr key={p.vid} className={`${mine(p) ? 'sch-mine' : ''} sch-${ph}`}>
                  <td><St tone={PHASE[ph][0]}>{PHASE[ph][1]}</St></td>
                  <td className="c num faint">{String(plan.placements.indexOf(p) + 1).padStart(2, '0')}</td>
                  <td className="strong">{p.name}</td>
                  <td className="schedule-cargo">{p.product} {p.dir} · <span className="num">{p.ton.toLocaleString()}t</span></td>
                  <td>{p.berth}</td>
                  <td className="small">{team.team}<br /><span className="muted">{team.lead} · {team.tel}</span></td>
                  <td className="num">{fmt(p.eta)}</td>
                  <td className="num"><span className="c-accent strong">{fmt(p.etb)}</span></td>
                  <td className={`r num ${ph === 'next' && p.etb - NOW < 6 * 60 ? 'c-amber strong' : ''}`}>{ph === 'next' ? fmtDur(p.etb - NOW) : ph === 'on' ? '작업 중' : '-'}</td>
                  <td className="num">{fmt(p.etu)}</td>
                  <td>{night(p) ? <span className="chip amber schedule-flag">야간 접안</span> : <span className="faint">-</span>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        </Panel>
      )}

      {view === 'berth' && (
        <div className="sch-berths">
          {berths.map(([bid, name]) => (
            <Panel key={bid} code={bid === role.myBerth ? 'MY-BERTH' : 'BERTH'} title={name} desc={`${BERTH_TEAMS[bid].team} · ${BERTH_TEAMS[bid].lead}`} className={bid === role.myBerth ? 'sch-mine-panel' : ''} pad>
              {plan.placements.filter((p) => p.bid === bid && (day === 'all' || dayOf(p.etb) === day)).map((p) => (
                <div key={p.vid} className={`sch-card sch-${phase(p)}`}>
                  <div><St tone={PHASE[phase(p)][0]}>{PHASE[phase(p)][1]}</St> <b>{p.name}</b></div>
                  <div className="num small">{fmt(p.etb)} → {fmt(p.etu)}</div>
                  <div className="small muted">{p.product} {p.dir} · {p.ton.toLocaleString()}t{phase(p) === 'next' ? ` · ${fmtDur(p.etb - NOW)} 뒤 접안` : ''}</div>
                </div>
              ))}
            </Panel>
          ))}
        </div>
      )}

      {view === 'chart' && (
        <Panel code="BERTH-GANTT" title="부두별 접안 차트" desc="막대 = 접안부터 작업 종료까지 · 세로선 = 지금" pad>
          <div className="sch-gantt">
            <div className="sch-gantt-axis">{days.map((d) => <span key={d} style={{ left: X((Number(d.slice(3)) - 14) * 1440) }}>{d}</span>)}</div>
            {berths.map(([bid, name]) => (
              <div key={bid} className={`sch-gantt-row ${bid === role.myBerth ? 'mine' : ''}`}>
                <span className="sch-gantt-name">{name}</span>
                <div className="sch-gantt-track">
                  {plan.placements.filter((p) => p.bid === bid).map((p) => <span key={p.vid} className={`sch-bar-item sch-${phase(p)}`} style={{ left: X(p.etb), width: `calc(${X(p.etu)} - ${X(p.etb)})` }} title={`${p.name} ${fmt(p.etb)}~${fmt(p.etu)}`}>{p.name}</span>)}
                  <i className="sch-now" style={{ left: X(NOW) }} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
      <p className="schedule-snapshot small muted">확정 당시 일정입니다. 스케줄러가 새로 확정하기 전까지 바뀌지 않습니다. 검토 중인 후보와 체선료 금액은 보이지 않습니다.</p>
    </Screen>
  )
}
