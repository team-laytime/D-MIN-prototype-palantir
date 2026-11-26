// 후보 비교·확정 (11-25 D-MIN-optimization-front 방식으로 개편)
//  - 후보 3개 = 팀 엔진(CP-SAT)이 파라미터 프리셋마다 낸 계획. 체선료가 낮은 순서로 A, B, C이고 A가 기본 선택이다.
//  - 리스크 = 팀 리스크 모델(berth_risk, POST /risk/risks)에 그 후보의 엔진 요청·응답을 그대로 보내 받은 목록. 화면에서 세지 않는다.
//  - 비교 기준은 후보 A(최저안)뿐이다. 금액과 시각은 전부 엔진 값이고 화면에서 다시 계산하지 않는다.
//  - 배치 그림에서 배를 누르면 산출 근거가 뜨고, 거기서 그 배정을 고정하면 계획 조건이 바뀐다 → 다시 계산하면 엔진이 그 고정을 지킨다.
//  - 확정한 뒤에는 후보 정보를 빼고 확정 일정 · 모니터링(지금 시각 기준) · 판단 근거 · 체선 발생 선박을 위에서 아래로.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, Checkbox, Dialog, SegmentedControl, Spinner, TextArea } from '@blueprintjs/core'
import { NOW, fmt, fmtDur, money, toMin } from '../lib/time.js'
import { spanOf, stateAt } from '../lib/plan.js'
import { SEV, KIND, checkRisks, riskLabel, riskShip, sortRisks } from '../lib/risk.js'
import { activePlan, cancelPlan, fixPlan, logActivity, useWorkspace } from '../lib/workspace.js'
import { changeText } from '../lib/incidents.js'
import SimilarCases from './SimilarCases.jsx'
import { useApp } from '../state/app.jsx'
import { Panel, Screen, St } from '../ui/kit.jsx'
import PlanGantt, { demCentsOf, hm } from './PlanGantt.jsx'
import './plan.css'
import './decide.css'

/** 엔진 상태 → 말. FEASIBLE = 제한 시간 안에서 찾은 최선, OPTIMAL = 최적임을 증명함 */
export const engineText = (sim) => (sim.status === 'OPTIMAL' || sim.proven ? '최적 증명' : '제한 시간 안의 최선')
const pctText = (a, b) => {
  if (!b) return '-'
  const p = Math.round(((a - b) / b) * 1000) / 10
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`
}
/** 선석 짧은 이름: '1-1', 'B2'는 그대로, 선석이 하나뿐인 부두('7')는 '7부두' */
export const shortBerth = (b, id) => (!b ? id : /^\d+$/.test(b.code) ? `${b.code}부두` : b.code)
const TOP = 4

/** 금액이 바뀌면 이전 값에서 새 값으로 0.65초 동안 세어 올라간다 */
function CountMoney({ cents }) {
  const [shown, setShown] = useState(cents)
  const prev = useRef(cents)
  useEffect(() => {
    const from = prev.current
    prev.current = cents
    if (from === cents) return
    const t0 = performance.now()
    let raf
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 650), e = 1 - (1 - k) ** 3
      setShown(Math.round(from + (cents - from) * e))
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [cents])
  return money(shown)
}

/** 다시 계산하는 동안 지난 초 */
function Elapsed({ since }) {
  const [, tick] = useState(0)
  useEffect(() => { const h = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(h) }, [])
  return <b className="num">{Math.floor((Date.now() - since) / 1000)}</b>
}

export default function Compare() {
  const { scen, result, all, recalc, focusId, setFocusId, openVessel, version, current, isScheduler, checks, setCheck, risks,
    whatIf, whatIfKey, pendingIncs, mailDecision, decideMails, undoMailDecision } = useApp()
  useWorkspace() // 확정, 취소, 보낸 메일이 바로 보이게 구독
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)
  const [showCands, setShowCands] = useState(false)
  const [monFilter, setMonFilter] = useState('all')
  const [riskOpen, setRiskOpen] = useState(null) // 리스크 전체 보기 창: 후보 id
  const [riskTab, setRiskTab] = useState('ALL')
  // 배치 그림에서 짚은 배. scroll이면 그 막대로 화면을 옮긴다(표·리스크에서 짚을 때)
  const [focus, setFocus] = useState({ vid: null, seq: 0, scroll: false })
  // risk: 리스크를 눌러 왔으면 배치 그림 카드에 그 리스크 그림을 같이 띄운다(riskSim = 그 리스크의 후보)
  const focusVessel = useCallback((vid, scroll = false, risk = null, riskSim = null) => setFocus((f) => ({ vid, seq: f.seq + 1, scroll, risk, riskSim })), [])
  const onGanttFocus = useCallback((vid) => focusVessel(vid, false), [focusVessel])
  const ganttRef = useRef(null)

  // 다시 계산 시작 시각(경과 초 표시)과, 직전에 보인 금액(바뀐 칸 깜빡임)
  const [runSince, setRunSince] = useState(null)
  useEffect(() => { setRunSince(result.running ? Date.now() : null) }, [result.running])
  const shownTotals = useRef({})
  const flash = {}
  for (const s of all) { const p = shownTotals.current[s.id]; if (p !== undefined && p !== s.total) flash[s.id] = true }
  useEffect(() => { shownTotals.current = Object.fromEntries(all.map((s) => [s.id, s.total])) }, [all])

  const ready = scen && all.length > 0
  const range = useMemo(() => (ready ? spanOf(all) : { start: 0, end: 1 }), [ready, all])

  if (!scen || result.loading) {
    return <Screen tab="compare" title="후보 비교·확정"><div className="cmp-none"><Spinner size={20} /> {result.error ?? '데이터셋을 불러오는 중입니다'}</div></Screen>
  }
  if (!all.length && result.boot) {
    return <Screen tab="compare" title="후보 비교·확정"><CompareLoading /></Screen>
  }
  if (!all.length) {
    return <Screen tab="compare" title="후보 비교·확정"><Callout intent="danger" title="후보가 없습니다">{result.error ?? result.calcError ?? '계산 결과가 비어 있습니다.'}</Callout></Screen>
  }

  const best = all[0]
  const focusSim = all.find((s) => s.id === focusId) ?? best
  const vById = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  const bById = Object.fromEntries(scen.berths.map((b) => [b.id, b]))
  const vname = (vid) => vById[vid]?.name ?? scen.nameByCall?.[vid.split('-')[0]] ?? vid.split('-')[0]
  const plan = activePlan()
  const fixedNow = current && current.version === version
  const toGantt = (vid, risk = null, riskSim = null) => { focusVessel(vid, Boolean(vid), risk, riskSim); ganttRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }

  // ── 확정 뒤: 확정 일정 · 모니터링 · 판단 근거 · 체선 발생 선박 ─────────────
  if (fixedNow && !showCands && plan) {
    const psim = { id: plan.candId, label: plan.label, placements: plan.placements }
    const monitor = stateAt(psim, scen, NOW).map(({ v, p, phase }) => {
      const shift = v.eta - p.eta // 확정 뒤 계획 조건에서 바뀐 ETA
      const late = phase === 'coming' && v.eta > p.etb
      const verdict = phase === 'left' ? '완료' : phase === 'berthed' ? '작업 중, 계획대로' : phase === 'waiting' ? '도착, 접안 대기'
        : late ? `접안 지연 위험: 도착 예정이 계획 접안보다 ${fmtDur(v.eta - p.etb)} 늦음` : Math.abs(shift) >= 120 ? `ETA ${shift > 0 ? '+' : '−'}${fmtDur(Math.abs(shift))}, 다시 계산 권고` : '계획대로'
      const tone = late ? 'bad' : phase === 'coming' && Math.abs(shift) >= 120 ? 'warn' : 'ok'
      return {
        p, v, phase, shift, verdict, tone,
        phaseText: { left: '이안', berthed: '접안 중', waiting: '정박지 대기', coming: '입항 전' }[phase],
        phaseTone: { left: 'idle', berthed: 'live', waiting: 'warn', coming: 'idle' }[phase],
      }
    })
    const count = (f) => monitor.filter(f).length
    const filters = [
      { value: 'all', label: `전체 ${monitor.length}` },
      { value: 'warn', label: `주의 ${count((m) => m.tone !== 'ok')}` },
      { value: 'berthed', label: `접안 중 ${count((m) => m.phase === 'berthed')}` },
      { value: 'waiting', label: `대기 ${count((m) => m.phase === 'waiting')}` },
      { value: 'coming', label: `입항 전 ${count((m) => m.phase === 'coming')}` },
    ]
    const shown = monitor.filter((m) => monFilter === 'all' || (monFilter === 'warn' ? m.tone !== 'ok' : m.phase === monFilter))
    const prange = spanOf([psim])
    const pdem = plan.placements.filter((p) => p.dem > 0)
    return (
      <Screen tab="compare" title="접안 계획 확정됨" bodyClass="plan-stack cmp-fixed" actions={<Button icon="comparison" onClick={() => setShowCands(true)}>후보 비교 다시 보기</Button>}>
        <div className="cmp-banner">
          <div className="cmp-banner-mark">확정</div>
          <div>
            <h2>접안 계획 v{plan.no}, {plan.label}{plan.preset ? ` (${plan.preset.label})` : ''}</h2>
            <p><span className="num">{plan.at}</span> {plan.who} 확정 · {plan.placements.length}척 · 체선 발생 {pdem.length}척 · 고정 {plan.placements.filter((p) => p.fixed).length}척</p>
          </div>
          <div className="cmp-banner-total"><span className="tiny">예상 체선료</span><b className="num">{money(plan.total)}</b></div>
        </div>
        {/* 11-26 통보 상태는 뺌. 판단 근거 · 체선 발생 선박은 후보 비교처럼 모니터링 밑에 */}
        <div className="stack">
          <Panel code="BERTH PLAN" title="확정 일정 · 부두별 배치" bodyClass="pg-body" ref={ganttRef}>
            <GanttLegend keys={['bar', 'dem', 'wait', 'pin', 'night']} />
            <PlanGantt sim={psim} scen={scen} range={prange} focus={focus} onFocus={onGanttFocus} onOpenCard={(vid) => openVessel(plan.candId, vid, { mode: 'card' })} />
          </Panel>
          <Panel code="PLAN-MONITOR" title="확정안 모니터링"
            actions={<SegmentedControl size="small" value={monFilter} onValueChange={setMonFilter} options={filters} />}>
            <div className="cmp-scroll">
              <table className="dt cmp-monitor">
                <thead><tr><th>선박</th><th>화물</th><th>부두</th><th>지금</th><th>도착(ETA)</th><th>계획 접안</th><th>계획 이안</th><th className="r">체선료</th><th>판정</th></tr></thead>
                <tbody>{shown.map((m) => <tr key={m.p.vid} className={`click ${m.tone !== 'ok' ? 'warn' : ''} ${focus.vid === m.p.vid ? 'on' : ''}`} onClick={() => toGantt(m.p.vid)}>
                  <td className="strong">{m.p.fixed && '🔒 '}{m.p.name}</td><td className="small">{m.p.product}, {m.p.dir}</td><td>{m.p.berth}</td><td><St tone={m.phaseTone}>{m.phaseText}</St></td>
                  <td className="num">{fmt(m.v.eta)}{m.shift !== 0 && <span className="small muted"> (확정 때 {fmt(m.p.eta)})</span>}</td>
                  <td className="num strong">{fmt(m.p.etb)}</td><td className="num">{fmt(m.p.etu)}</td>
                  <td className={`r num ${m.p.dem ? 'c-red' : 'muted'}`}>{money(m.p.dem)}</td>
                  <td><St tone={m.tone}>{m.verdict}</St></td>
                </tr>)}</tbody>
              </table>
            </div>
          </Panel>
          <Panel code="FIX-NOTE" title="판단 근거" pad actions={<Button size="small" icon="undo" disabled={!isScheduler} onClick={() => cancelPlan('스케줄러 확정 취소')}>확정 취소</Button>}>
            {/* 11-26 입력한 줄바꿈 그대로, 함께 확정한 리스크 · 조건 변경은 한 줄에 하나씩 */}
            <p className="fix-reason">{plan.reason}</p>
            {plan.uncheckedRisks.length > 0 && <div className="fix-unchecked">
              <div className="small c-amber strong">확인하지 않은 리스크 · 결정 안 한 조건 변경 {plan.uncheckedRisks.length}건과 함께 확정</div>
              <ul>{plan.uncheckedRisks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>}
          </Panel>
          <DemList title="체선 발생 선박" items={[...pdem].sort((a, b) => b.dem - a.dem).map((p) => ({ vid: p.vid, name: p.name, berth: p.berth, etb: p.etb, cents: p.dem }))} focusVid={focus.vid} onPick={toGantt} />
        </div>
      </Screen>
    )
  }

  // ── 확정 전: 후보 3개 비교 + 배치 그림 + 바뀐 선박 + 확정 ──────────────────
  // 반영 여부를 정하지 않은 조건 변경 메일과 그 「반영하면?」 미리 계산(app.jsx가 백그라운드에서 돌림)
  const mails = pendingIncs.map((inc) => ({ inc, e: whatIf[whatIfKey(inc.id)] }))
  const showReq = Boolean(mailDecision) || mails.length > 0
  const cols = all
  const riskOf = (id) => risks[id] ?? { state: 'running' }
  const focusRisk = riskOf(focusSim.id)
  const toCheck = checkRisks(focusRisk.data)
  const checkKey = (k) => `${version}:${focusSim.id}:${k}`
  // 결정하지 않은 조건 변경이 남아 있으면 확정할 때 함께 묻고 기록에 남긴다
  const unchecked = [
    ...toCheck.filter((r) => !checks[checkKey(r.id)]).map((r) => riskLabel(r, vname)),
    ...mails.map(({ inc }) => `결정 안 한 조건 변경: ${changeText(scen, inc)}`),
  ]
  const checkTotal = toCheck.length
  const checkedN = toCheck.filter((r) => checks[checkKey(r.id)]).length
  const blocked = result.stale || result.running
  // 11-26 처음 열 때 A만 먼저 보이고 B · C는 뒤에서 계산 중 (그동안 확정 · 조건 변경 결정은 기다린다)
  const waitBC = result.pending > 0
  const pend = [['후보 B', '상황형'], ['후보 C', '배별 지연 대비']].slice(2 - result.pending)
  const pendTd = (body) => pend.map(([id]) => <td key={id} className="muted">{body}</td>)
  const busyBC = <span className="cmp-running"><Spinner size={12} /> 계산 중</span>
  const riskWait = focusRisk.state === 'running'
  const fix = (force) => {
    if (blocked || waitBC || riskWait) return
    if (unchecked.length && !force) { setAsking(true); return }
    fixPlan({ cand: focusSim, scen, version, reason: reason.trim() || '(사유 미입력)', uncheckedRisks: unchecked })
    setAsking(false); setReason(''); setShowCands(false)
  }
  const pick = (id) => { setAsking(false); setFocusId(id) }
  const pickRisk = (simId, r) => { pick(simId); toGantt(riskShip(r), r, simId) }


  const minTotal = Math.min(...all.map((s) => s.total))
  // 배치 그림: 「반영하면?」 열을 고르면 그 계획을, 기준은 그 계획을 만든 후보
  const gSim = focusSim
  const gRef = best

  const dim = blocked ? 'stale' : ''
  const td = (sim, children, extra = '') => <td key={sim.id} className={`${extra} ${sim.id === focusSim.id ? 'on' : ''}`} onClick={() => pick(sim.id)}>{children}</td>
  const riskCell = (sim) => {
    const rk = riskOf(sim.id)
    if (rk.state === 'running') return <span className="cmp-running"><Spinner size={12} /> 리스크 계산 중</span>
    if (rk.state === 'error') return <span className="c-red small">{rk.error}</span>
    const list = checkRisks(rk.data)
    const low = rk.data.counts?.LOW ?? 0
    if (!list.length) return <span className="c-green small">높음·중간 리스크 없음{low ? ` · 낮음 ${low}건` : ''}</span>
    return (
      <>
        <ul className="cmp-risk-list">{list.slice(0, TOP).map((r) => (
          <li key={r.id} title={r.title} onClick={(e) => { e.stopPropagation(); pickRisk(sim.id, r) }}>
            <span className={`sev ${SEV[r.severity].tone}`}>{SEV[r.severity].text}</span><span className="cmp-risk-t">{riskLabel(r, vname)}</span>
          </li>
        ))}</ul>
        <button type="button" className="cmp-risk-more" onClick={(e) => { e.stopPropagation(); setRiskTab('ALL'); setRiskOpen(sim.id) }}>
          {list.length > TOP ? `외 ${list.length - TOP}건 · ` : ''}전체 {rk.data.risks.length}건 보기
        </button>
      </>
    )
  }
  const demOf = (sim) => sim.placements.filter((p) => p.dem.cents > 0)

  return (
    <Screen tab="compare" title="후보 비교·확정" bodyClass="plan-stack">

      {result.stale && (
        <Callout className="cmp-stale" intent="warning" icon="refresh" title="계획 조건이 바뀌었습니다. 다시 계산해야 후보가 맞습니다">
          <p className="small">지금 보이는 후보는 바뀌기 전 조건으로 계산한 값입니다{scen.fixes.length ? `. 고정한 배 ${scen.fixes.length}척은 다시 계산할 때 그대로 둡니다` : ''}. 다시 계산하기 전에는 확정할 수 없습니다.</p>
          <div className="risk-buttons">
            <Button intent="warning" icon="refresh" loading={result.running} disabled={!isScheduler} onClick={recalc}>다시 계산</Button>
            {result.running && runSince && <span className="small muted">후보 {scen.presets.length}개를 동시에 계산하고 있습니다 · <Elapsed since={runSince} />초 (몇 분 걸릴 수 있음)</span>}
          </div>
        </Callout>
      )}
      {!result.stale && result.running && <Callout intent="primary" icon={<Spinner size={16} />}>후보를 다시 계산하고 있습니다 · {runSince && <Elapsed since={runSince} />}초</Callout>}
      {result.calcError && <Callout intent="danger" icon="error" title="다시 계산하지 못했습니다">{result.calcError}</Callout>}

      {/* 11-26 위: 후보 비교 표와 조건 변경 요청을 나란히(요청은 표 높이에 맞추고 넘치면 스크롤, 없으면 표가 꽉 차게). 이 안으로 확정은 맨 아래 */}
      <div className="stack">
        <div className={`cmp-top ${showReq ? 'with-req' : ''}`}>
            <Panel code="CAND-REPORT" title="후보 비교" data-tour="cards">
              <table className="dt cmp-report">
                <colgroup><col className="cmp-c-label" />{cols.map((s) => <col key={s.id} />)}{pend.map(([id]) => <col key={id} />)}</colgroup>
                <thead><tr><th />{cols.map((sim) => <th key={sim.id} className={sim.id === focusSim.id ? 'on' : ''} onClick={() => pick(sim.id)}>
                  <button type="button" className="cmp-col"><span className="plan-radio" aria-hidden="true" />{sim.label}<span className="cmp-col-sub">{sim.preset?.label}</span>{sim.total === minTotal && <span className="chip green">최저</span>}{sim.sameAsA && <span className="chip" title="이 후보의 조건으로 풀어도 후보 A와 배치가 같습니다">A와 같음</span>}</button>
                </th>)}{pend.map(([id, sub]) => <th key={id}><span className="cmp-col">{id}<span className="cmp-col-sub">{sub}</span></span></th>)}</tr></thead>
                <tbody>
                  <tr><th>총 예상 체선료</th>{cols.map((sim) => td(sim, <>
                    <span className={`cmp-money ${dim}`}><CountMoney cents={sim.total} /></span>
                    {result.running && runSince && <span className="cmp-running"><Spinner size={12} /> <Elapsed since={runSince} />s</span>}
                  </>, `num cmp-total ${flash[sim.id] ? 'flash' : ''}`))}{pendTd(busyBC)}</tr>
                  <tr><th>최저안 대비</th>{cols.map((sim) => td(sim, sim.total === minTotal ? '가장 낮음' : `+${money(sim.total - minTotal)} (${pctText(sim.total, minTotal)})`, `num ${dim} ${sim.total === minTotal ? 'c-green' : 'muted'}`))}{pendTd('—')}</tr>
                  <tr><th>체선 발생</th>{cols.map((sim) => { const d = demOf(sim); return td(sim, <>{d.length}척 <span className="muted small">· {hm(d.reduce((s, p) => s + p.dem.excessMin, 0))}</span></>, `num ${dim}`) })}{pendTd('—')}</tr>
                  <tr><th>고정한 배</th>{cols.map((sim) => td(sim, `${sim.placements.filter((p) => p.fixed).length}척`, `num ${dim}`))}{pendTd('—')}</tr>
                  <tr className="cmp-risk-row"><th>리스크</th>{cols.map((sim) => td(sim, riskCell(sim)))}{pendTd('—')}</tr>
                </tbody>
              </table>
            </Panel>
          {showReq && <div className="cmp-top-side">
              <MailDecide scen={scen} all={all} mails={mails} decision={mailDecision} onDecide={decideMails} onUndo={undoMailDecision}
                canEdit={isScheduler} running={result.running || waitBC} blocked={blocked} />
          </div>}
        </div>

          <Panel code="BERTH PLAN" title={`배치 결과 · ${gSim.label}${gSim.preset ? ` (${gSim.preset.label})` : ''}${blocked ? ' · 다시 계산 전 값' : ''}`} bodyClass="pg-body" data-tour="order" ref={ganttRef}
            actions={<>
              <SegmentedControl size="small" value={gSim.id} options={cols.map((s) => ({ value: s.id, label: s.label }))} onValueChange={pick} />
            </>}>
            <GanttLegend keys={['bar', 'dem', 'wait', 'pin', 'night']} />
            <PlanGantt sim={gSim} sims={cols} refId={gRef.id} scen={scen} range={range} focus={focus} onFocus={onGanttFocus} loading={blocked}
              risks={riskOf(gSim.id).data?.risks ?? []} onOpenCard={(vid) => openVessel(focusSim.id, vid, { mode: 'evidence' })} />
          </Panel>

          <DemList title={`${focusSim.label} 체선 발생 선박`} focusVid={focus.vid} onPick={toGantt}
            items={demOf(focusSim).sort((a, b) => b.dem.cents - a.dem.cents).map((p) => ({ vid: p.vid, name: vname(p.vid), berth: shortBerth(bById[p.bid], p.bid), etb: p.etb, cents: p.dem.cents, min: p.dem.excessMin }))} />
          <SimilarCases scen={scen} all={all} risks={risks} pendingIncs={pendingIncs} />

          <Panel code="PLAN-DECIDE" title="이 안으로 확정" data-tour="decide" pad actions={<SegmentedControl size="small" intent="primary" value={focusSim.id} options={all.map((s) => ({ value: s.id, label: s.id }))} onValueChange={pick} />}>
            <div className="risk-decision stack">
              <div className="risk-amount">
                <span className="strong">{focusSim.label}, {focusSim.preset?.label}</span>
                <span className="risk-total num"><CountMoney cents={focusSim.total} /></span>
                <span className="small muted">최저안 대비 <span className={`num ${focusSim.total === minTotal ? 'c-green' : ''}`}>{focusSim.total === minTotal ? '가장 낮음' : `+${money(focusSim.total - minTotal)}`}</span></span>
              </div>
              <div className="cmp-checks" data-tour="risks">
                <div className="cmp-checks-head">
                  <b>확인할 리스크</b>
                  {riskWait ? <span className="cmp-running"><Spinner size={12} /> 계산 중</span>
                    : focusRisk.state === 'error' ? <span className="c-red small">계산 못 함</span>
                      : <span className={`small ${checkedN < checkTotal ? 'c-amber' : 'c-green'}`}><span className="num">{checkTotal}</span>건 중 <span className="num">{checkedN}</span>건 확인</span>}
                </div>
                {focusRisk.state === 'error' && <p className="small c-red">{focusRisk.error}</p>}
                {focusRisk.state === 'done' && checkTotal === 0 && <p className="small c-green">높음·중간 리스크가 없습니다.</p>}
                {toCheck.map((r) => (
                  <div key={r.id} className={`cmp-check ${checks[checkKey(r.id)] ? 'done' : ''}`}>
                    <Checkbox checked={Boolean(checks[checkKey(r.id)])} disabled={!isScheduler} aria-label={`${riskLabel(r, vname)} 확인`}
                      onChange={(e) => { const on = e.currentTarget.checked; setCheck(checkKey(r.id), on); logActivity('리스크', on ? '리스크 확인' : '확인 해제', `${focusSim.label}, ${KIND[r.kind] ?? r.kind}`, riskLabel(r, vname)) }} />
                    <button type="button" className="cmp-check-t" title={r.title} onClick={() => toGantt(riskShip(r), r, focusSim.id)}>
                      <span className={`sev ${SEV[r.severity].tone}`}>{SEV[r.severity].text}</span>
                      <span>{riskLabel(r, vname)}<small>{KIND[r.kind] ?? r.kind} · {fmt(toMin(r.start))} ~ {fmt(toMin(r.end))}</small></span>
                    </button>
                  </div>
                ))}
              </div>
              <div className="risk-reason-field">
                <label htmlFor="risk-reason">판단 근거</label>
                <TextArea id="risk-reason" fill rows={3} value={reason} disabled={!isScheduler} onChange={(e) => setReason(e.currentTarget.value)} placeholder="예: 체선료가 가장 낮고, 작업 간격이 빠듯한 7부두는 하역팀과 미리 조율" />
              </div>
              {blocked ? <p className="small c-amber">{result.running ? '다시 계산하는 중입니다.' : '계획 조건이 바뀌어 다시 계산한 뒤에 확정할 수 있습니다.'}</p>
                : waitBC && <p className="small c-amber">후보 B · C 계산이 끝나면 확정할 수 있습니다.</p>}
              {asking ? (
                <Callout className="risk-confirmation" intent="warning" icon="warning-sign">
                  <p className="small"><b>확인하지 않은 리스크 · 결정 안 한 조건 변경 {unchecked.length}건</b>이 확정 기록에 함께 남습니다.</p>
                  <div className="risk-buttons"><Button size="small" onClick={() => setAsking(false)}>돌아가기</Button><Button size="small" intent="warning" onClick={() => fix(true)}>그래도 확정</Button></div>
                </Callout>
              ) : <Button intent="primary" icon="endorsed" fill disabled={!isScheduler || blocked || waitBC || riskWait} onClick={() => fix(false)}>{focusSim.label}로 확정</Button>}
            </div>
          </Panel>
          {fixedNow && <Button icon="arrow-left" onClick={() => setShowCands(false)}>확정 화면으로</Button>}
      </div>

      <RiskDialog sim={all.find((s) => s.id === riskOpen)} rk={riskOpen ? riskOf(riskOpen) : null} tab={riskTab} setTab={setRiskTab} vname={vname}
        onClose={() => setRiskOpen(null)} onPick={(r) => { const id = riskOpen; setRiskOpen(null); pickRisk(id, r) }} />
    </Screen>
  )
}

/**
 * 11-25 조건 변경 요청: 받은 메일 중 반영할 것을 골라 한꺼번에 결정한다. 고른 것은 반영, 나머지는 반영 안 함으로 모두 해소.
 * 메일마다 '지금 + 그 조건 하나'의 A · B · C를 미리 계산해 두고(한 단계만), 하나만 반영하면 바로 바뀐다. 여럿이면 다시 계산.
 * 결정 뒤에는 결과와 「결정 되돌리기」만 보인다(되돌리면 결정 전 계획 조건 · 후보 · 메일 상태로).
 */
function MailDecide({ scen, all, mails, decision, onDecide, onUndo, canEdit, running, blocked }) {
  const [sel, setSel] = useState(() => new Set())
  const incOf = (id) => scen.incidents.find((i) => i.id === id)
  if (decision) {
    const row = (id, on) => { const inc = incOf(id); return inc && (
      <li key={id} className={on ? 'on' : 'off'}><span className={`sev ${on ? 'ok' : 'low'}`}>{on ? '반영' : '반영 안 함'}</span><span>{changeText(scen, inc)}<small>{inc.kind} · {inc.from}</small></span></li>) }
    return (
      <Panel code="CHANGE-REQ" title="조건 변경 결정" pad actions={<Button size="small" icon="undo" disabled={!canEdit} onClick={onUndo} title="결정 전 계획 조건 · 후보 · 메일 상태로 돌아갑니다">되돌리기</Button>}>
        <div className="small md-sum">{running ? <span className="cmp-running"><Spinner size={12} /> 반영한 조건으로 후보를 다시 계산하는 중</span>
          : `반영 ${decision.applied.length}건 · 반영 안 함 ${decision.dismissed.length}건 · ${decision.at.slice(5, 16)}`}</div>
        <ul className="md-list">{decision.applied.map((id) => row(id, true))}{decision.dismissed.map((id) => row(id, false))}</ul>
      </Panel>
    )
  }
  if (!mails.length) return null
  const ids = mails.map(({ inc }) => inc.id)
  const picked = ids.filter((id) => sel.has(id))
  const one = picked.length === 1 ? mails.find(({ inc }) => inc.id === picked[0])?.e : null
  const label = !picked.length ? '모두 반영 안 함' : picked.length === 1 && one?.state === 'done' ? '결정 (바로 반영)' : '결정 (다시 계산)'
  const toggle = (id) => setSel((x) => { const n = new Set(x); n.has(id) ? n.delete(id) : n.add(id); return n })
  return (
    <Panel code="CHANGE-REQ" title={`조건 변경 요청 ${mails.length}건`} pad>
      <ul className="md-list">
        {mails.map(({ inc }) => (
          <li key={inc.id} className={sel.has(inc.id) ? 'pick' : ''}>
            <Checkbox checked={sel.has(inc.id)} disabled={!canEdit} onChange={() => toggle(inc.id)} aria-label={`${inc.title} 반영`} />
            <span><span className="sev mail">{inc.kind}</span> {changeText(scen, inc)}
              <small>{inc.from} · {fmt(inc.at)}</small>
            </span>
          </li>
        ))}
      </ul>
      <div className="md-foot">
        <span className="small">반영 <b>{picked.length}</b>건 · 반영 안 함 <b>{ids.length - picked.length}</b>건</span>
        <Button size="small" intent="primary" icon="tick" disabled={!canEdit || running} onClick={() => { onDecide(picked); setSel(new Set()) }}>{label}</Button>
      </div>
    </Panel>
  )
}

/** 배치 그림 범례 */
function GanttLegend({ keys, refLabel = '후보 A' }) {
  const L = {
    bar: ['', '접안 ~ 이안'], dem: ['dem', '체선 구간'], wait: ['wait', '정박지 대기 중 체선 시작'], pin: ['pin', '고정한 배'],
    chg: ['chg', `${refLabel}와 부두가 다른 배`], night: ['night', '야간 20~06시'],
  }
  return <div className="pg-legend">{keys.map((k) => <span key={k}><i className={L[k][0]} />{L[k][1]}</span>)}</div>
}

/** 체선 발생 선박 (큰 순). 누르면 배치 그림에서 짚는다 */
function DemList({ title, items, focusVid, onPick }) {
  const sum = items.reduce((s, x) => s + x.cents, 0)
  return (
    <Panel code="DEMURRAGE" title={title} desc={`${items.length}척 · ${money(sum)}`} pad={false}>
      {items.length === 0 ? <p className="cmp-none">체선이 생기는 선박이 없습니다.</p> : (
        <div className="cmp-scroll short">
          <table className="dt cmp-dem">
            <tbody>{items.map((x) => (
              <tr key={x.vid} className={`click ${focusVid === x.vid ? 'on' : ''}`} onClick={() => onPick(x.vid)}>
                <td><span className="strong">{x.name}</span><span className="tiny muted">{x.berth} · {fmt(x.etb)} 접안</span></td>
                <td className="r num"><span className="c-red">{money(x.cents)}</span>{x.min ? <span className="tiny muted">{hm(x.min)}</span> : null}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** 리스크 전체 보기 창: 심각도 탭, 한 줄을 누르면 배치 그림에서 그 배를 짚는다 */
function RiskDialog({ sim, rk, tab, setTab, vname, onClose, onPick }) {
  const data = rk?.data
  const list = data ? sortRisks(data.risks) : []
  const shown = tab === 'ALL' ? list : list.filter((r) => r.severity === tab)
  return (
    <Dialog isOpen={Boolean(sim && data)} onClose={onClose} title={sim ? `${sim.label} 리스크 · 전체 ${list.length}건` : ''} className="cmp-risk-dialog">
      {data && <>
        <div className="cmp-rd-tabs">
          <SegmentedControl size="small" value={tab} onValueChange={setTab} options={[
            { value: 'ALL', label: `전체 ${list.length}` }, { value: 'HIGH', label: `높음 ${data.counts.HIGH}` }, { value: 'MEDIUM', label: `중간 ${data.counts.MEDIUM}` }, { value: 'LOW', label: `낮음 ${data.counts.LOW}` },
          ]} />
        </div>
        <ul className="cmp-rd-list">{shown.map((r) => (
          <li key={r.id} title={r.title} className="click" onClick={() => onPick(r)}>
            <span className={`sev ${SEV[r.severity].tone}`}>{SEV[r.severity].text}</span>
            <span className="cmp-rd-body">{riskLabel(r, vname)}<small>{KIND[r.kind] ?? r.kind} · {fmt(toMin(r.start))} ~ {fmt(toMin(r.end))}</small></span>
          </li>
        ))}</ul>
        {data.notes?.length > 0 && <p className="cmp-rd-note">{data.notes.join(' · ')}</p>}
      </>}
    </Dialog>
  )
}

/** 11-26 처음 여는 기준 시각의 후보 계산 중: 화면 틀(후보 비교 표 · 배치 결과 · 확정)은 그대로 보이고 값 자리에 「계산 중」 */
function CompareLoading() {
  const cols = [['후보 A', '기본'], ['후보 B', '상황형'], ['후보 C', '배별 지연 대비']]
  const busy = <span className="cmp-running"><Spinner size={12} /> 계산 중</span>
  return (
    <div className="stack">
      <div className="cmp-top">
        <Panel code="CAND-REPORT" title="후보 비교">
          <table className="dt cmp-report">
            <colgroup><col className="cmp-c-label" />{cols.map(([id]) => <col key={id} />)}</colgroup>
            <thead><tr><th />{cols.map(([id, sub]) => <th key={id}><span className="cmp-col">{id}<span className="cmp-col-sub">{sub}</span></span></th>)}</tr></thead>
            <tbody>
              {['총 예상 체선료', '최저안 대비', '체선 발생', '고정한 배', '리스크'].map((row, i) => (
                <tr key={row}><th>{row}</th>{cols.map(([id]) => <td key={id} className={i ? 'muted' : ''}>{i ? '—' : busy}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <Panel code="BERTH PLAN" title="배치 결과">
        <div className="cmp-none">{busy}</div>
      </Panel>
      <Panel code="PLAN-DECIDE" title="이 안으로 확정" pad>
        <div className="cmp-none">{busy}</div>
      </Panel>
    </div>
  )
}
