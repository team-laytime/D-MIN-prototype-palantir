// 후보 비교·확정 (11-20 피드백 반영)
//  - 세 후보를 한 화면 리포트로: 무엇이 다른지, 장점, 단점, 공통 남은 리스크
//  - 리스크 확인과 확정을 이 화면에 합침(예전 「리스크·확정」 화면)
//  - 리스크는 예상 시각을 크게, 계산에서 나온 것과 새로 들어온 상황을 나눠 보인다
//  - 확정한 뒤에는 후보 정보를 빼고 확정 일정과 통보 상태만 보인다
import { useMemo, useState } from 'react'
import { Button, Callout, Checkbox, SegmentedControl, TextArea } from '@blueprintjs/core'
import { RULES, risks, validate } from '../lib/engine.js'
import { NOW, at, fmt, fmtDur, money } from '../lib/time.js'
import { activePlan, cancelPlan, fixPlan, logActivity, useWorkspace } from '../lib/workspace.js'
import { useApp } from '../state/app.jsx'
import { Panel, Screen, St, riskTone } from '../ui/kit.jsx'
import Timeline from './Timeline.jsx'
import OrderCompare from './OrderCompare.jsx'
import './plan.css'
import './decide.css'

const night = (etb) => { const h = Math.floor((((etb % 1440) + 1440) % 1440) / 60); return h >= 20 || h < 6 }
const until = (m) => (m <= NOW ? '지남' : `${fmtDur(m - NOW)} 뒤`)

/** 최저 체선료 후보(ref)와 비교해 후보가 정확히 무엇을 바꿨는지, 장점과 단점을 문장으로 뽑는다. */
export function describe(sim, ref, scen) {
  const v = Object.fromEntries(scen.vessels.map((x) => [x.id, x]))
  const bn = (id) => scen.berths.find((b) => b.id === id).name.replace('부두', '')
  const base = Object.fromEntries(ref.placements.map((p) => [p.vid, p]))
  const diffs = sim.placements.filter((p) => p.bid !== base[p.vid].bid || p.etb !== base[p.vid].etb)
    .sort((a, b) => v[a.vid].eta - v[b.vid].eta)
    .map((p) => {
      const b0 = base[p.vid]
      const parts = []
      if (p.bid !== b0.bid) parts.push(`${bn(b0.bid)} → ${bn(p.bid)}`)
      if (p.etb !== b0.etb) parts.push(`접안 ${p.etb > b0.etb ? '+' : '−'}${fmtDur(Math.abs(p.etb - b0.etb))}`)
      const why = p.etb > b0.etb
        ? (p.prev && p.ready !== null && p.ready > v[p.vid].eta ? `앞 선박 ${v[p.prev]?.name ?? p.prev} 작업 종료 뒤 접안` : [...new Set(p.blockers.map((x) => RULES[x.rule].label))].join(', ') || '순서를 뒤로 미룸')
        : p.bid !== b0.bid ? '비어 있는 부두로 옮겨 대기를 줄임' : '앞 선박 순서가 바뀌어 일찍 접안'
      return { vid: p.vid, name: v[p.vid].name, text: parts.join(', '), why, later: p.etb > b0.etb, saving: b0.dem.cents - p.dem.cents }
    })
  const pros = []
  const cons = []
  if (sim.id !== ref.id) {
    const best = [...diffs].sort((a, b) => b.saving - a.saving)[0]
    if (best && best.saving > 0) pros.push(`${best.name} 체선료 ${money(best.saving)} 줄어듦`)
    const zero = sim.placements.filter((p) => p.dem.cents === 0).length
    pros.push(`체선 없는 선박 ${zero}척`)
    const later = diffs.filter((d) => d.later)
    if (later.length) cons.push(`늦게 접안: ${later.map((d) => d.name).join(', ')}`)
  } else {
    pros.push('세 후보 중 체선료가 가장 낮음')
    const zero = sim.placements.filter((p) => p.dem.cents === 0).length
    pros.push(`체선 없는 선박 ${zero}척`)
  }
  const nightN = sim.placements.filter((p) => night(p.etb)).length
  if (nightN) cons.push(`야간 접안 ${nightN}건`)
  const worst = [...sim.placements].sort((a, b) => b.dem.cents - a.dem.cents)[0]
  if (worst.dem.cents > 0) cons.push(`${v[worst.vid].name} 체선 ${fmtDur(worst.dem.excessMin)}`)
  return { diffs, pros, cons }
}

export default function Compare() {
  const { scen, result, all, focusId, setFocusId, openVessel, version, current, isScheduler, checks, setCheck, go } = useApp()
  useWorkspace() // 확정·취소가 바로 보이게 구독
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)
  const [showCands, setShowCands] = useState(false)
  const range = useMemo(() => ({
    start: at(14, 0),
    end: Math.ceil((Math.max(at(15, 0), ...all.flatMap((sim) => sim.placements.map((p) => p.etu))) + 60) / 360) * 360,
  }), [all])
  const cards = useMemo(() => all.map((sim) => ({ sim, ...describe(sim, result.candidates[0], scen), risks: risks(sim, scen), violations: validate(sim, scen).length })), [all, result, scen])

  if (result.error) return <Screen tab="compare" title="후보 비교·확정"><Callout intent="danger" title="후보 계산 불가">{result.error}</Callout></Screen>

  const focus = all.find((s) => s.id === focusId) ?? result.candidates[0]
  const best = result.candidates[0]
  const vsBest = (sim) => (sim.id === best.id ? '—' : `+${money(sim.total - best.total)} (+${Math.round((sim.total - best.total) / best.total * 1000) / 10}%)`)
  const plan = activePlan()
  const fixedNow = current && current.version === version

  // ── 확정 뒤: 후보 정보는 빼고 확정 일정과 통보 상태만 ─────────────────
  if (fixedNow && !showCands) {
    // 11-23 피드백: 확정안대로 되고 있는지 모니터링. 지금 시각 기준 작업 진행과 AIS ETA를 계획과 비교한다.
    const monitor = plan.placements.map((p) => {
      const v = scen.vessels.find((x) => x.id === p.vid)
      const done = p.etu <= NOW, on = !done && p.etb <= NOW
      const arrived = !done && !on && v.eta <= NOW
      const aisEta = done || on || arrived ? null : v.eta + v.aisEtaDiff
      const slip = aisEta === null ? 0 : aisEta - p.etb
      const gap = v.aisEtaDiff
      const verdict = done ? '완료' : on ? '작업 중 · 계획대로' : arrived ? '도착 · 접안 대기 (계획대로)' : slip > 0 ? `접안 지연 위험 +${fmtDur(slip)}` : Math.abs(gap) >= 120 ? '도착 시각 크게 바뀜 · 재계산 권고' : '계획대로'
      const tone = done || on || (slip <= 0 && Math.abs(gap) < 120) ? 'ok' : slip > 0 ? 'bad' : 'warn'
      return { p, aisEta, gapText: aisEta === null ? '' : gap === 0 ? '(계획과 같음)' : `(계획 ETA ${gap > 0 ? '+' : '−'}${fmtDur(Math.abs(gap))})`, verdict, tone, phaseText: done ? '완료' : on ? '접안 중' : arrived ? '정박지 대기' : '입항 전', phaseTone: done ? 'idle' : on ? 'live' : arrived ? 'warn' : 'idle' }
    })
    return (
      <Screen tab="compare" title="접안 계획 확정됨" bodyClass="plan-stack cmp-fixed" actions={<Button icon="comparison" onClick={() => setShowCands(true)}>후보 비교 다시 보기</Button>}>
        <div className="cmp-banner">
          <div className="cmp-banner-mark">확정</div>
          <div>
            <h2>접안 계획 v{plan.no} · {plan.label}</h2>
            <p><span className="num">{plan.at}</span> · {plan.who} 확정 · 입력 v{plan.version} 기준</p>
          </div>
          <div className="cmp-banner-total"><span className="tiny">예상 체선료</span><b className="num">{money(plan.total)}</b></div>
        </div>
        <div className="cmp-fixed-grid">
          <div className="stack">
          <Panel code="PLAN-MONITOR" title="확정안 모니터링" desc={`지금 ${fmt(NOW)} 기준 · 계획 대비 실제(AIS ETA·작업 진행)`} actions={<span className="cmp-mon-sum small">{monitor.filter((m) => m.tone === 'ok').length}척 계획대로 · <b className="c-amber">{monitor.filter((m) => m.tone !== 'ok').length}척 주의</b></span>}>
            <table className="dt cmp-monitor">
              <thead><tr><th>선박</th><th>부두</th><th>지금</th><th>계획 접안</th><th>AIS 도착 예상</th><th>판정</th></tr></thead>
              <tbody>{monitor.map((m) => <tr key={m.p.vid} className={m.tone !== 'ok' ? 'warn' : ''}>
                <td className="strong">{m.p.name}</td><td>{m.p.berth}</td><td><St tone={m.phaseTone}>{m.phaseText}</St></td>
                <td className="num">{fmt(m.p.etb)}</td><td className="num">{m.aisEta === null ? '-' : fmt(m.aisEta)} <span className="small muted">{m.gapText}</span></td>
                <td><St tone={m.tone}>{m.verdict}</St></td>
              </tr>)}</tbody>
            </table>
          </Panel>
          <Panel code="FIXED-PLAN" title="확정 접안 일정" desc="이용자 화면에 이 일정이 그대로 나갑니다">
            <table className="dt">
              <thead><tr><th className="c">순서</th><th>선박</th><th>부두</th><th>도착</th><th>접안</th><th>작업 종료</th><th>주의</th></tr></thead>
              <tbody>{plan.placements.map((p, i) => <tr key={p.vid}>
                <td className="c num faint">{String(i + 1).padStart(2, '0')}</td><td className="strong">{p.name}</td><td>{p.berth}</td>
                <td className="num">{fmt(p.eta)}</td><td className="num strong c-accent">{fmt(p.etb)}</td><td className="num">{fmt(p.etu)}</td>
                <td>{night(p.etb) ? <span className="chip amber">야간 접안</span> : <span className="faint">-</span>}</td>
              </tr>)}</tbody>
            </table>
          </Panel>
          </div>
          <div className="stack">
            <Panel code="NOTIFY" title="통보 상태" pad>
              <ul className="cmp-notify">
                <li><St tone="ok">반영됨</St> 이용자 확정 일정 화면</li>
                <li><St tone="ok">보냄</St> 이용자 알림함</li>
                <li><St tone="warn">작성 전</St> 부두·대리점 통보 메일</li>
              </ul>
              <div className="risk-buttons"><Button intent="primary" icon="envelope" onClick={() => go('mail')}>통보 메일 쓰기</Button><Button icon="document" onClick={() => go('report')}>보고서</Button></div>
            </Panel>
            <Panel code="FIX-NOTE" title="판단 근거" pad>
              <p className="small">{plan.reason}</p>
              {plan.uncheckedRisks.length > 0 && <p className="small c-amber">미확인 리스크 {plan.uncheckedRisks.length}건과 함께 확정: {plan.uncheckedRisks.join(', ')}</p>}
              <Button size="small" icon="undo" disabled={!isScheduler} onClick={() => cancelPlan('스케줄러 확정 취소')}>확정 취소</Button>
            </Panel>
          </div>
        </div>
      </Screen>
    )
  }

  // ── 확정 전: 세 후보 리포트 + 리스크 + 확정 ────────────────────────────
  const checkKey = (k) => `${version}:${focus.id}:${k}`
  const allRisks = Object.values(cards.reduce((acc, c) => {
    for (const r of c.risks) {
      if (r.state === '해당 없음') continue
      acc[r.key] ??= { ...r, ids: [] }
      acc[r.key].ids.push(c.sim.id)
      if (r.at !== undefined && (acc[r.key].at === undefined || r.at < acc[r.key].at)) acc[r.key].at = r.at
    }
    return acc
  }, {})).sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9))
  const focusRisks = cards.find((c) => c.sim.id === focus.id).risks.filter((r) => r.state !== '해당 없음')
  const unchecked = focusRisks.filter((r) => !checks[checkKey(r.key)])
  const fix = (force) => {
    if (unchecked.length && !force) { setAsking(true); return }
    fixPlan({ cand: focus, scen, version, reason: reason.trim() || '(사유 미입력)', uncheckedRisks: unchecked.map((r) => r.label) })
    setAsking(false); setReason(''); setShowCands(false)
  }
  const bn = (id) => scen.berths.find((b) => b.id === id).name

  return (
    <Screen tab="compare" title="후보 비교·확정" bodyClass="plan-stack">
      <div className="plan-intro">
        <p>순서·부두 조합 <span className="num">{result.explored.toLocaleString()}</span>개를 같은 규칙으로 계산해 체선료가 낮은 후보 {result.candidates.length}개를 골랐습니다. 시나리오 입력에서 값을 바꾸면 이 화면이 바로 다시 계산됩니다.</p>
        <span className="plan-version mono">INPUT v{version}</span>
      </div>

      <Panel code="ORDER" title="접안 순서 한눈에 비교" desc="후보마다 몇 번째로 접안하는지 (최저 체선료 후보 기준)" data-tour="order">
        <OrderCompare sims={all} scen={scen} focusId={focus.id} onPick={(id) => { setAsking(false); setFocusId(id) }} />
      </Panel>

      <div className="risk-layout">
        <div className="stack">
          <Panel code="CAND-REPORT" title="후보 비교 리포트" desc="최저 체선료 후보가 기본 선택입니다. 열을 눌러 확정할 안을 바꿉니다" data-tour="cards">
            <table className="dt cmp-report">
              <thead><tr><th />{cards.map(({ sim }) => <th key={sim.id} className={sim.id === focus.id ? 'on' : ''}>
                <button type="button" className="cmp-col" onClick={() => setFocusId(sim.id)}><span className="plan-radio" aria-hidden="true" />{sim.label}{sim.id === best.id && <span className="chip green">최저, 기본</span>}</button>
              </th>)}</tr></thead>
              <tbody>
                <tr><th>총 예상 체선료</th>{cards.map(({ sim }) => <td key={sim.id} className={`num cmp-total ${sim.id === focus.id ? 'on' : ''}`}>{money(sim.total)}</td>)}</tr>
                <tr><th>최저안 대비</th>{cards.map(({ sim }) => <td key={sim.id} className={`num ${sim.id === focus.id ? 'on' : ''} ${sim.id === best.id ? 'c-green' : 'muted'}`}>{sim.id === best.id ? '가장 낮음' : vsBest(sim)}</td>)}</tr>
                <tr><th>무엇이 다른지</th>{cards.map(({ sim, diffs }) => <td key={sim.id} className={sim.id === focus.id ? 'on' : ''}>{sim.id === best.id ? <span className="muted small">비교 기준 (최저 체선료)</span> : <ul className="cmp-list">{diffs.map((d) => <li key={d.vid}><b>{d.name}</b> {d.text}</li>)}</ul>}</td>)}</tr>
                <tr><th>장점</th>{cards.map(({ sim, pros }) => <td key={sim.id} className={sim.id === focus.id ? 'on' : ''}><ul className="cmp-list pro">{pros.map((t) => <li key={t}>{t}</li>)}</ul></td>)}</tr>
                <tr><th>단점</th>{cards.map(({ sim, cons }) => <td key={sim.id} className={sim.id === focus.id ? 'on' : ''}><ul className="cmp-list con">{cons.map((t) => <li key={t}>{t}</li>)}{!cons.length && <li className="muted">-</li>}</ul></td>)}</tr>
                <tr><th>남는 리스크</th>{cards.map(({ sim, risks: rs, violations }) => <td key={sim.id} className={sim.id === focus.id ? 'on' : ''}><St tone={rs.some((r) => r.state === '해당') ? 'warn' : 'ok'}>해당 {rs.filter((r) => r.state === '해당').length}</St>{rs.some((r) => r.state === '판단 불가') && <> <St tone="unknown">판단 불가 {rs.filter((r) => r.state === '판단 불가').length}</St></>}{violations > 0 && <span className="c-red small"> 제약 위반 {violations}</span>}</td>)}</tr>
              </tbody>
            </table>
          </Panel>

          <Panel code="BERTH-TL" title="부두별 타임라인 (접안 순서)" desc="안마다 부두별 접안 순서 · 막대를 누르면 산출 근거" actions={<span className="num faint tiny">{fmt(range.start)} — {fmt(range.end)}</span>}>
            <div className="plan-timeline-legend">
              <span><i className="plan-key plan-key-work" />작업</span><span><i className="plan-key plan-key-dem" />체선 발생</span><span><i className="plan-key plan-key-changed" />최저안과 달라진 선박</span><span><i className="plan-key plan-key-wait" />도착 후 대기</span><span><i className="plan-key plan-key-weather" />접안 금지</span>
            </div>
            <div className="plan-timelines">
              {all.map((sim, index) => (
                <div key={sim.id} className={`plan-timeline-row ${sim.id === focus.id ? 'plan-selected' : ''}`}>
                  <button className="plan-timeline-select" onClick={() => setFocusId(sim.id)} aria-pressed={sim.id === focus.id}><span className="plan-timeline-code mono">{sim.id}</span><strong>{sim.label}</strong><span className="num">{money(sim.total)}</span></button>
                  <Timeline sim={sim} scen={scen} range={range} changed={cards[index].diffs.map((d) => d.vid)} axis={index === 0} compact onPick={(vid) => openVessel(sim.id, vid, { mode: 'evidence' })} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel code="RISK-CHECK" title="공통 남은 리스크" desc="일어날 시각 순 · 확인 표시는 확정 기록과 보고서에 '담당자 확인'으로 남고, 미확인이 있으면 확정할 때 한 번 더 묻습니다" data-tour="risks">
            <div className="cmp-risks">
              {allRisks.map((r) => {
                const applies = r.ids.includes(focus.id)
                return (
                  <article key={r.key} className={`cmp-risk ${applies ? '' : 'dim'}`}>
                    <div className="cmp-risk-time">{r.at !== undefined ? <><b className="num">{fmt(r.at)}</b><span className={r.at - NOW < 12 * 60 ? 'c-red' : 'c-amber'}>{until(r.at)}</span></> : <span className="muted small">시각 미정</span>}</div>
                    <div className="cmp-risk-body">
                      <div className="cmp-risk-head"><span className="chip">계산 결과</span><b>{r.label}</b><St tone={riskTone(r.state)}>{r.state}</St><span className="cmp-risk-ids">{r.ids.map((id) => <span key={id} className={`chip ${id === focus.id ? 'accent' : ''}`}>{id}</span>)}</span></div>
                      <p className="small">{r.evidence}</p>
                      {r.alternative !== '-' && <p className="small muted">대안: {r.alternative}</p>}
                    </div>
                    {applies ? <Checkbox className="risk-checkbox" label="확인" checked={Boolean(checks[checkKey(r.key)])} disabled={!isScheduler}
                      onChange={(e) => { const on = e.currentTarget.checked; setCheck(checkKey(r.key), on); logActivity('리스크', on ? '리스크 확인' : '확인 해제', `${focus.label} · ${r.label}`, r.state) }} /> : <span className="tiny faint">이 안엔 없음</span>}
                  </article>
                )
              })}
              {scen.incidents.map((inc) => (
                <article key={inc.id} className="cmp-risk new">
                  <div className="cmp-risk-time"><b className="num">{fmt(inc.at)}</b><span className="c-violet">새로 들어옴</span></div>
                  <div className="cmp-risk-body">
                    <div className="cmp-risk-head"><span className="chip violet">새 상황 · {inc.from}</span><b>{inc.kind}</b><St tone="unknown">계산 반영 전</St></div>
                    <p className="small">{inc.title}</p>
                    <p className="small muted">영향: {inc.effect}</p>
                  </div>
                  <Button size="small" variant="outlined" onClick={() => go('input')}>입력에 반영</Button>
                </article>
              ))}
            </div>
          </Panel>

        </div>

        <aside className="risk-sidebar stack">
          <Panel code="PLAN-DECIDE" title="이 안으로 확정" data-tour="decide" pad actions={<SegmentedControl size="small" intent="primary" value={focus.id} options={all.map((s) => ({ value: s.id, label: s.id }))} onValueChange={(id) => { setAsking(false); setFocusId(id) }} />}>
            <div className="risk-decision stack">
              <div className="risk-amount">
                <span className="strong">{focus.label}</span>
                <span className="risk-total num">{money(focus.total)}</span>
                <span className="small muted">최저안 대비 <span className={`num ${focus.id === best.id ? 'c-green' : ''}`}>{focus.id === best.id ? '가장 낮음 (기본 선택)' : vsBest(focus)}</span></span>
              </div>
              <ul className="cmp-decide-list small">
                {cards.find((c) => c.sim.id === focus.id).diffs.slice(0, 4).map((d) => <li key={d.vid}><b>{d.name}</b> {d.text}</li>)}
              </ul>
              <p className={`risk-check-count small ${unchecked.length ? 'c-amber' : 'c-green'}`}>확인할 리스크 <span className="num">{focusRisks.length}</span>건 중 <span className="num">{focusRisks.length - unchecked.length}</span>건 확인</p>
              {current && <p className="small c-amber">적용 중: {current.label} ({current.status}). 확정하면 새 버전이 됩니다.</p>}
              <div className="risk-reason-field">
                <label htmlFor="risk-reason">판단 근거 · 보고서와 확정 기록에 남음</label>
                <TextArea id="risk-reason" fill rows={3} value={reason} disabled={!isScheduler} onChange={(e) => setReason(e.currentTarget.value)} placeholder="예: 기상 해제 직후 대형선 우선 접안, 체선료 절감 폭이 가장 큼" />
              </div>
              {asking ? (
                <Callout className="risk-confirmation" intent="warning" icon="warning-sign">
                  <p className="small"><b>미확인 리스크 {unchecked.length}건</b> ({unchecked.map((r) => r.label).join(', ')}). 확정 기록에 함께 남습니다.</p>
                  <div className="risk-buttons"><Button size="small" onClick={() => setAsking(false)}>돌아가기</Button><Button size="small" intent="warning" onClick={() => fix(true)}>그래도 확정</Button></div>
                </Callout>
              ) : <Button intent="primary" icon="endorsed" fill disabled={!isScheduler} onClick={() => fix(false)}>이 안으로 확정</Button>}
              <p className="risk-policy tiny muted">확정하면 이용자 화면과 알림함에 바로 나가고, 이 화면은 확정 일정만 보이게 바뀝니다. Agent는 확정하지 않습니다.</p>
            </div>
          </Panel>
          {fixedNow && <Button icon="arrow-left" onClick={() => setShowCands(false)}>확정 화면으로</Button>}
          <Panel code="VESSEL-OUT" title={`${focus.label} 선박별`} pad={false}>
            <table className="dt cmp-mini">
              <thead><tr><th>선박</th><th>부두</th><th>접안</th><th className="r">체선료</th></tr></thead>
              <tbody>{[...focus.placements].sort((a, b) => a.etb - b.etb).map((p) => <tr key={p.vid} className="click" onClick={() => openVessel(focus.id, p.vid, { mode: 'card' })}>
                <td className="strong">{scen.vessels.find((v) => v.id === p.vid).name}</td><td>{bn(p.bid).replace('부두', '')}</td><td className="num">{fmt(p.etb)}</td><td className={`r num ${p.dem.cents ? 'c-red' : 'muted'}`}>{money(p.dem.cents)}</td>
              </tr>)}</tbody>
            </table>
          </Panel>
        </aside>
      </div>
    </Screen>
  )
}

