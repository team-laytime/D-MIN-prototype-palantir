// 후보 비교·확정 (11-24 실데이터)
//  - 후보 3개 = 팀 엔진(CP-SAT)이 파라미터 프리셋마다 낸 계획. 체선료가 낮은 순서로 A, B, C이고 A가 기본 선택이다.
//  - 비교 기준은 실제 계획(실제 부두, 실제 접안 시각)과 후보 A. 금액과 시각은 전부 엔진 값이고 화면에서 다시 계산하지 않는다.
//  - 88척은 선석별 간트와 「바뀐 선박」 표로 본다. 표에서 배를 고정하면 계획 조건이 바뀌고, 다시 계산하면 엔진이 그 고정을 지킨다.
//  - 확정한 뒤에는 후보 정보를 빼고 확정 일정 모니터링(지금 시각 기준)과 통보 상태만 보인다.
import { useMemo, useState } from 'react'
import { Button, Callout, Checkbox, HTMLSelect, SegmentedControl, Spinner, TextArea } from '@blueprintjs/core'
import { NOW, fmt, fmtDur, money } from '../lib/time.js'
import { changedVs, risksOf, spanOf, stateAt } from '../lib/plan.js'
import { activePlan, cancelPlan, fixPlan, logActivity, useWorkspace, ws } from '../lib/workspace.js'
import { groupsFor } from '../lib/mailGroups.js'
import { useApp } from '../state/app.jsx'
import { Panel, Screen, St, riskTone } from '../ui/kit.jsx'
import Timeline, { TimelineLegend, demCents } from './Timeline.jsx'
import OrderCompare from './OrderCompare.jsx'
import './plan.css'
import './decide.css'

/** 엔진 상태 → 말. FEASIBLE = 제한 시간 안에서 찾은 최선, OPTIMAL = 최적임을 증명함 */
export const engineText = (sim) => (sim.status === 'OPTIMAL' || sim.proven ? '최적 증명' : '제한 시간 안의 최선')
const pctText = (a, b) => {
  if (!b) return '-'
  const p = Math.round(((a - b) / b) * 1000) / 10
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`
}
const signed = (cents) => (cents === 0 ? '0' : `${cents > 0 ? '+' : '−'}${money(Math.abs(cents))}`)
/** 선석 짧은 이름: '1-1', 'B2'는 그대로, 선석이 하나뿐인 부두('7')는 '7부두' */
export const shortBerth = (b, id) => (!b ? id : /^\d+$/.test(b.code) ? `${b.code}부두` : b.code)
const deltaText = (min) => (min === 0 ? '같음' : `${fmtDur(Math.abs(min))} ${min < 0 ? '앞당김' : '늦춤'}`)

export default function Compare() {
  const { scen, result, all, recalc, editScen, focusId, setFocusId, openVessel, version, current, isScheduler, checks, setCheck, go } = useApp()
  useWorkspace() // 확정, 취소, 보낸 메일이 바로 보이게 구독
  const [reason, setReason] = useState('')
  const [asking, setAsking] = useState(false)
  const [showCands, setShowCands] = useState(false)
  const [refKind, setRefKind] = useState('base') // 바뀐 선박 표의 비교 기준: base(실제 계획) | best(후보 A)
  const [sortKey, setSortKey] = useState('saving')
  const [onlyBerth, setOnlyBerth] = useState(false)
  const [monFilter, setMonFilter] = useState('all')

  const ready = scen && all.length > 0
  const range = useMemo(() => (ready ? spanOf(all) : { start: 0, end: 1 }), [ready, all])
  const cards = useMemo(() => (ready ? all.map((sim) => {
    const risks = risksOf(sim, scen)
    return {
      sim, risks, hit: risks.filter((r) => r.state === '해당'),
      dem: sim.placements.filter((p) => p.dem.cents > 0).length,
      night: sim.placements.filter((p) => p.night).length,
      vsBest: changedVs(sim, all[0]).length,
    }
  }) : []), [ready, all, scen])

  if (!scen || result.loading) {
    return <Screen tab="compare" title="후보 비교·확정"><div className="cmp-none"><Spinner size={20} /> {result.error ?? '데이터셋을 불러오는 중입니다'}</div></Screen>
  }
  if (!all.length) {
    return <Screen tab="compare" title="후보 비교·확정"><Callout intent="danger" title="후보가 없습니다">{result.error ?? result.calcError ?? '엔진 결과가 비어 있습니다.'}</Callout></Screen>
  }

  const best = all[0]
  const focus = all.find((s) => s.id === focusId) ?? best
  const base = result.baseline
  const vById = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  const bById = Object.fromEntries(scen.berths.map((b) => [b.id, b]))
  const vname = (vid) => vById[vid]?.name ?? vid
  const plan = activePlan()
  const fixedNow = current && current.version === version

  // ── 확정 뒤: 확정 일정 모니터링 + 통보 상태 ────────────────────────────
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
    const groups = groupsFor(plan)
    const sentN = new Set(ws.sent.filter((s) => s.kind === 'notice' && s.planNo === plan.no).map((s) => s.groupId)).size
    const prange = spanOf([psim])
    return (
      <Screen tab="compare" title="접안 계획 확정됨" bodyClass="plan-stack cmp-fixed" actions={<Button icon="comparison" onClick={() => setShowCands(true)}>후보 비교 다시 보기</Button>}>
        <div className="cmp-banner">
          <div className="cmp-banner-mark">확정</div>
          <div>
            <h2>접안 계획 v{plan.no}, {plan.label}{plan.preset ? ` (${plan.preset.label})` : ''}</h2>
            <p><span className="num">{plan.at}</span> {plan.who} 확정, 계획 조건 v{plan.version} 기준, {plan.placements.length}척</p>
          </div>
          <div className="cmp-banner-total"><span className="tiny">예상 체선료</span><b className="num">{money(plan.total)}</b>
            {plan.baselineTotal !== null && <span className="tiny muted">실제 계획 {money(plan.baselineTotal)} 대비 {pctText(plan.total, plan.baselineTotal)}</span>}</div>
        </div>
        <div className="cmp-fixed-grid">
          <div className="stack">
            <Panel code="PLAN-GANTT" title="확정 일정 선석별" desc={`지금 ${fmt(NOW)}, 빨간 선이 지금`}>
              <TimelineLegend keys={['work', 'dem', 'night', 'nightBand', 'block']} hint="막대를 누르면 선박 카드" />
              <Timeline sim={psim} scen={scen} range={prange} compact onPick={(vid) => openVessel(plan.candId, vid, { mode: 'card' })} />
            </Panel>
            <Panel code="PLAN-MONITOR" title="확정안 모니터링" desc={`지금 ${fmt(NOW)} 기준, 계획 접안과 지금 계획 조건의 ETA 비교`}
              actions={<SegmentedControl size="small" value={monFilter} onValueChange={setMonFilter} options={filters} />}>
              <div className="cmp-scroll">
                <table className="dt cmp-monitor">
                  <thead><tr><th>선박</th><th>화물</th><th>부두</th><th>지금</th><th>도착(ETA)</th><th>계획 접안</th><th>계획 이안</th><th>판정</th></tr></thead>
                  <tbody>{shown.map((m) => <tr key={m.p.vid} className={`click ${m.tone !== 'ok' ? 'warn' : ''}`} onClick={() => openVessel(plan.candId, m.p.vid, { mode: 'card' })}>
                    <td className="strong">{m.p.name}</td><td className="small">{m.p.product}, {m.p.dir}</td><td>{m.p.berth}</td><td><St tone={m.phaseTone}>{m.phaseText}</St></td>
                    <td className="num">{fmt(m.v.eta)}{m.shift !== 0 && <span className="small muted"> (확정 때 {fmt(m.p.eta)})</span>}</td>
                    <td className="num strong">{fmt(m.p.etb)}{m.p.night && <span className="chip amber"> 야간</span>}</td><td className="num">{fmt(m.p.etu)}</td>
                    <td><St tone={m.tone}>{m.verdict}</St></td>
                  </tr>)}</tbody>
                </table>
              </div>
            </Panel>
          </div>
          <div className="stack">
            <Panel code="NOTIFY" title="통보 상태" pad>
              <ul className="cmp-notify">
                <li><St tone="ok">반영됨</St> 이용자 확정 일정 화면</li>
                <li><St tone={sentN ? 'ok' : 'warn'}>{sentN ? `${sentN}/${groups.length}곳 보냄` : '보내기 전'}</St> 부서별 확정 통보 메일</li>
              </ul>
              <div className="risk-buttons"><Button intent="primary" icon="envelope" onClick={() => go('mail')}>부서별 통보 메일 쓰기</Button></div>
            </Panel>
            <Panel code="FIX-NOTE" title="판단 근거" pad>
              <p className="small">{plan.reason}</p>
              {plan.preset && <p className="small muted">무엇을 바꾼 안: {plan.preset.desc}</p>}
              {plan.uncheckedRisks.length > 0 && <p className="small c-amber">확인하지 않은 리스크 {plan.uncheckedRisks.length}건과 함께 확정: {plan.uncheckedRisks.join(', ')}</p>}
              <Button size="small" icon="undo" disabled={!isScheduler} onClick={() => cancelPlan('스케줄러 확정 취소')}>확정 취소</Button>
            </Panel>
          </div>
        </div>
      </Screen>
    )
  }

  // ── 확정 전: 후보 3개 비교 + 바뀐 선박 + 리스크 + 확정 ──────────────────
  const card = cards.find((c) => c.sim.id === focus.id) ?? cards[0]
  const checkKey = (k) => `${version}:${focus.id}:${k}`
  const focusRisks = card.hit
  const unchecked = focusRisks.filter((r) => !checks[checkKey(r.key)])
  const blocked = result.stale || result.running
  const fix = (force) => {
    if (blocked) return
    if (unchecked.length && !force) { setAsking(true); return }
    fixPlan({ cand: focus, scen, version, reason: reason.trim() || '(사유 미입력)', uncheckedRisks: unchecked.map((r) => r.label) })
    setAsking(false); setReason(''); setShowCands(false)
  }
  const pick = (id) => { setAsking(false); setFocusId(id) }

  // 바뀐 선박 표
  const ref = refKind === 'base' ? base : best
  const refLabel = refKind === 'base' ? '실제 계획' : best.label
  const sameAsRef = refKind === 'best' && focus.id === best.id
  const changed = sameAsRef || !ref ? [] : changedVs(focus, ref)
  const rows = changed.filter((c) => !onlyBerth || c.berthChanged).sort((a, b) => (
    sortKey === 'saving' ? b.saving - a.saving || a.p.etb - b.p.etb
      : sortKey === 'loss' ? a.saving - b.saving || a.p.etb - b.p.etb
        : sortKey === 'delta' ? Math.abs(b.etbDelta) - Math.abs(a.etbDelta) : a.p.etb - b.p.etb))
  const sumRef = changed.reduce((s, c) => s + c.b.dem.cents, 0)
  const sumNow = changed.reduce((s, c) => s + c.p.dem.cents, 0)
  const fixedSet = new Set(scen.fixes.map((f) => f.vid))
  const toggleFix = (p) => {
    const on = fixedSet.has(p.vid)
    editScen((d) => {
      d.fixes = d.fixes.filter((f) => f.vid !== p.vid)
      if (!on) d.fixes.push({ vid: p.vid, bid: p.bid, etb: p.etb })
    })
    logActivity('입력', on ? '선박 고정 해제' : '선박 고정', vname(p.vid), on ? '' : `${focus.label} 배정 ${bById[p.bid]?.name ?? p.bid} ${fmt(p.etb)}`)
  }
  const clearFixes = () => { editScen((d) => { d.fixes = [] }); logActivity('입력', '선박 고정 모두 해제', `${fixedSet.size}척`) }
  const moved = new Set(base ? changedVs(focus, base).filter((c) => c.berthChanged).map((c) => c.p.vid) : [])
  const quiet = card.risks.filter((r) => r.state !== '해당').map((r) => r.label)

  const td = (sim, children, extra = '') => <td key={sim.id} className={`${extra} ${sim.id === focus.id ? 'on' : ''}`}>{children}</td>

  return (
    <Screen tab="compare" title="후보 비교·확정" bodyClass="plan-stack">
      <div className="plan-intro">
        <p>팀 엔진(CP-SAT)이 파라미터 묶음 {all.length}개로 {scen.vessels.length}척, 선석 {scen.berths.length}곳을 배정한 후보입니다. 체선료가 낮은 순서로 A, B, C이며 A가 기본 선택입니다. 계산 {result.calcAt ?? '-'}.</p>
        <span className="plan-version mono">INPUT v{version}</span>
      </div>

      {result.stale && (
        <Callout className="cmp-stale" intent="warning" icon="refresh" title="계획 조건이 바뀌었습니다. 다시 계산해야 후보가 맞습니다">
          <p className="small">지금 보이는 후보는 바뀌기 전 조건으로 계산한 값입니다{scen.fixes.length ? `. 고정한 배 ${scen.fixes.length}척은 다시 계산할 때 엔진에 보냅니다` : ''}. 다시 계산하기 전에는 확정할 수 없습니다.</p>
          <div className="risk-buttons">
            <Button intent="warning" icon="refresh" loading={result.running} disabled={!isScheduler} onClick={recalc}>다시 계산</Button>
            {result.running && <span className="small muted">엔진이 후보 {scen.presets.length}개를 동시에 계산하고 있습니다 (약 1분)</span>}
          </div>
        </Callout>
      )}
      {!result.stale && result.running && <Callout intent="primary" icon={<Spinner size={16} />}>엔진이 후보를 다시 계산하고 있습니다 (약 1분).</Callout>}
      {result.calcError && <Callout intent="danger" icon="error" title="다시 계산하지 못했습니다">{result.calcError}</Callout>}

      <div className="risk-layout">
        <div className="stack">
          <Panel code="CAND-REPORT" title="후보 비교" desc="열 이름을 눌러 확정할 안을 고릅니다" data-tour="cards">
            <table className="dt cmp-report">
              <thead><tr><th />{all.map((sim) => <th key={sim.id} className={sim.id === focus.id ? 'on' : ''}>
                <button type="button" className="cmp-col" onClick={() => pick(sim.id)}><span className="plan-radio" aria-hidden="true" />{sim.label}{sim.id === best.id && <span className="chip green">최저, 기본</span>}</button>
              </th>)}</tr></thead>
              <tbody>
                <tr><th>무엇을 바꾼 안</th>{all.map((sim) => td(sim, <><b>{sim.preset?.label}</b><span className="cmp-sub">{sim.preset?.desc}</span>{sim.notes.map((n) => <span key={n} className="cmp-sub c-amber">{n}</span>)}</>))}</tr>
                <tr><th>총 예상 체선료</th>{all.map((sim) => td(sim, money(sim.total), 'num cmp-total'))}</tr>
                <tr><th>최저안 대비</th>{all.map((sim) => td(sim, sim.id === best.id ? '가장 낮음' : `+${money(sim.total - best.total)} (${pctText(sim.total, best.total)})`, `num ${sim.id === best.id ? 'c-green' : 'muted'}`))}</tr>
                <tr><th>실제 계획 대비</th>{all.map((sim) => td(sim, base ? <>{money(base.total)} → {money(sim.total)}, <b className={sim.total < base.total ? 'c-green' : 'c-red'}>{pctText(sim.total, base.total)}</b></> : '-', 'num'))}</tr>
                <tr><th>실제 계획과 부두가 다른 배</th>{all.map((sim) => td(sim, `${sim.moves ?? '-'}척`, 'num'))}</tr>
                <tr><th>후보 A와 다른 배</th>{all.map((sim) => td(sim, sim.id === best.id ? '-' : `${cards.find((c) => c.sim.id === sim.id).vsBest}척 (부두나 접안 시각)`, 'num'))}</tr>
                <tr><th>체선 발생</th>{all.map((sim) => td(sim, `${cards.find((c) => c.sim.id === sim.id).dem}척`, 'num'))}</tr>
                <tr><th>야간 접안</th>{all.map((sim) => td(sim, `${cards.find((c) => c.sim.id === sim.id).night}척`, 'num'))}</tr>
                <tr><th>탱크 범위 이탈</th>{all.map((sim) => td(sim, sim.tankViolation.length ? <span className="c-red">{sim.tankViolation.length}건</span> : '없음', 'num'))}</tr>
                <tr><th>엔진 상태</th>{all.map((sim) => td(sim, <><St tone={sim.status === 'OPTIMAL' || sim.proven ? 'ok' : 'live'}>{engineText(sim)}</St><span className="cmp-sub num">{sim.status}, {sim.solveSec ?? '-'}초</span></>))}</tr>
                <tr><th>남는 리스크</th>{all.map((sim) => { const c = cards.find((x) => x.sim.id === sim.id); return td(sim, <St tone={c.hit.length ? 'warn' : 'ok'}>해당 {c.hit.length}</St>) })}</tr>
              </tbody>
            </table>
          </Panel>

          <Panel code="BERTH-GANTT" title={`${focus.label} 선석별 간트`} desc={`${fmt(range.start)} ~ ${fmt(range.end)}, 부두 묶음별`} data-tour="order"
            actions={<SegmentedControl size="small" value={focus.id} options={all.map((s) => ({ value: s.id, label: s.label }))} onValueChange={pick} />}>
            <TimelineLegend />
            <Timeline sim={focus} scen={scen} range={range} highlight={moved} highlightLabel="실제 계획과 부두가 다름" onPick={(vid) => openVessel(focus.id, vid, { mode: 'evidence' })} />
          </Panel>

          <Panel code="CHANGED" title={`${focus.label}에서 바뀐 선박`} desc={`${refLabel}과 부두나 접안 시각이 다른 배`}
            actions={<SegmentedControl size="small" value={refKind} onValueChange={setRefKind} options={[{ value: 'base', label: '실제 계획 대비' }, { value: 'best', label: `${best.label} 대비` }]} />}>
            {sameAsRef ? <p className="cmp-none">{focus.label} 자신과 비교하고 있습니다. 다른 후보를 고르거나 실제 계획 대비로 바꾸십시오.</p> : !ref ? <p className="cmp-none">실제 계획 자료가 없습니다.</p> : <>
              <div className="cmp-toolbar">
                <label className="cmp-mon-filter">정렬 <HTMLSelect size="small" value={sortKey} onChange={(e) => setSortKey(e.target.value)} options={[
                  { value: 'saving', label: '체선료가 많이 준 순' }, { value: 'loss', label: '체선료가 늘어난 순' }, { value: 'delta', label: '접안 시각 차이 큰 순' }, { value: 'etb', label: '접안 시각 순' },
                ]} /></label>
                <Checkbox label="부두가 바뀐 배만" checked={onlyBerth} onChange={(e) => setOnlyBerth(e.currentTarget.checked)} />
                {fixedSet.size > 0 && <Button size="small" variant="minimal" icon="unpin" disabled={!isScheduler} onClick={clearFixes}>고정 {fixedSet.size}척 모두 해제</Button>}
                <span className="sum num">{changed.length}척 바뀜, 부두 바뀜 {changed.filter((c) => c.berthChanged).length}척, 이 배들의 체선료 {money(sumRef)} → {money(sumNow)}</span>
              </div>
              <div className="cmp-scroll">
                <table className="dt cmp-changed">
                  <thead><tr><th>선박</th><th>화물</th><th>부두 {refLabel} → {focus.label}</th><th>접안 {refLabel} → {focus.label}</th><th className="r">접안 차이</th><th className="r">그 배 체선료</th><th className="r">차이</th><th className="c">고정</th></tr></thead>
                  <tbody>{rows.map((c) => {
                    const v = vById[c.p.vid]
                    const on = fixedSet.has(c.p.vid)
                    return (
                      <tr key={c.p.vid}>
                        <td><button type="button" className="cmp-name" onClick={() => openVessel(focus.id, c.p.vid, { mode: 'evidence' })}>{vname(c.p.vid)}</button>{c.p.fixed && <span className="chip"> 고정 반영</span>}</td>
                        <td className="small">{v?.product}, {v?.dir}</td>
                        <td className={c.berthChanged ? 'moved' : 'muted'}>{c.berthChanged ? <>{shortBerth(bById[c.b.bid], c.b.bid)}<span className="arrow">→</span>{shortBerth(bById[c.p.bid], c.p.bid)}</> : `${shortBerth(bById[c.p.bid], c.p.bid)} 그대로`}</td>
                        <td className="num">{fmt(c.b.etb)}<span className="arrow">→</span>{fmt(c.p.etb)}</td>
                        <td className={`r num ${c.etbDelta < 0 ? 'c-green' : c.etbDelta > 0 ? 'c-amber' : 'muted'}`}>{deltaText(c.etbDelta)}</td>
                        <td className="r num">{money(c.b.dem.cents)}<span className="arrow">→</span>{money(c.p.dem.cents)}</td>
                        <td className={`r num ${c.saving > 0 ? 'c-green' : c.saving < 0 ? 'c-red' : 'muted'}`}>{c.saving === 0 ? '변화 없음' : signed(-c.saving)}</td>
                        <td className="c"><Button size="small" variant={on ? 'solid' : 'outlined'} intent={on ? 'primary' : 'none'} icon={on ? 'pin' : 'unpin'} disabled={!isScheduler}
                          title={on ? '고정을 풉니다' : `${bById[c.p.bid]?.name ?? c.p.bid} ${fmt(c.p.etb)} 접안으로 고정합니다. 다시 계산하면 엔진이 지킵니다`}
                          onClick={() => toggleFix(c.p)}>{on ? '고정됨' : '고정'}</Button></td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </>}
          </Panel>

          <Panel code="PIER-LOAD" title="부두별 배정" desc="부두마다 배정 척수와 그 배들의 예상 체선료 합">
            <OrderCompare sims={all} scen={scen} baseline={base} focusId={focus.id} onPick={pick} />
          </Panel>

          <Panel code="RISK-CHECK" title={`${focus.label} 남은 리스크`} desc="확인 표시는 확정 기록에 남고, 확인하지 않은 리스크가 있으면 확정할 때 한 번 더 묻습니다" data-tour="risks">
            <div className="cmp-risks">
              {focusRisks.map((r) => (
                <article key={r.key} className="cmp-risk">
                  <div className="cmp-risk-time"><b className="num">{r.vessels.length ? `${r.vessels.length}척` : '-'}</b><span className="c-amber">해당 선박</span></div>
                  <div className="cmp-risk-body">
                    <div className="cmp-risk-head"><span className="chip">계산 결과</span><b>{r.label}</b><St tone={riskTone(r.state)}>{r.state}</St>
                      <span className="cmp-risk-ids">{cards.filter((c) => c.hit.some((x) => x.key === r.key)).map((c) => <span key={c.sim.id} className={`chip ${c.sim.id === focus.id ? 'accent' : ''}`}>{c.sim.id}</span>)}</span></div>
                    <p className="small">{r.evidence}</p>
                    {r.alternative !== '-' && <p className="small muted">대응: {r.alternative}</p>}
                  </div>
                  <Checkbox className="risk-checkbox" label="확인" checked={Boolean(checks[checkKey(r.key)])} disabled={!isScheduler}
                    onChange={(e) => { const on = e.currentTarget.checked; setCheck(checkKey(r.key), on); logActivity('리스크', on ? '리스크 확인' : '확인 해제', `${focus.label}, ${r.label}`, r.state) }} />
                </article>
              ))}
              {scen.incidents.map((inc) => (
                <article key={inc.id} className="cmp-risk new">
                  <div className="cmp-risk-time">{inc.at !== undefined ? <b className="num">{fmt(inc.at)}</b> : <b>-</b>}<span className="c-violet">새로 들어옴</span></div>
                  <div className="cmp-risk-body">
                    <div className="cmp-risk-head"><span className="chip violet">새 상황{inc.from ? `, ${inc.from}` : ''}</span><b>{inc.kind ?? inc.title}</b><St tone="unknown">계산 반영 전</St></div>
                    <p className="small">{inc.title}</p>
                    {inc.effect && <p className="small muted">영향: {inc.effect}</p>}
                  </div>
                  <Button size="small" variant="outlined" onClick={() => go('input')}>계획 조건에 반영</Button>
                </article>
              ))}
            </div>
            {quiet.length > 0 && <p className="cmp-none">해당 없음: {quiet.join(', ')}</p>}
          </Panel>
        </div>

        <aside className="risk-sidebar stack">
          <Panel code="PLAN-DECIDE" title="이 안으로 확정" data-tour="decide" pad actions={<SegmentedControl size="small" intent="primary" value={focus.id} options={all.map((s) => ({ value: s.id, label: s.id }))} onValueChange={pick} />}>
            <div className="risk-decision stack">
              <div className="risk-amount">
                <span className="strong">{focus.label}, {focus.preset?.label}</span>
                <span className="risk-total num">{money(focus.total)}</span>
                <span className="small muted">최저안 대비 <span className={`num ${focus.id === best.id ? 'c-green' : ''}`}>{focus.id === best.id ? '가장 낮음 (기본 선택)' : `+${money(focus.total - best.total)}`}</span></span>
                {base && <span className="small muted">실제 계획 {money(base.total)} 대비 <b className="num c-green">{pctText(focus.total, base.total)}</b></span>}
              </div>
              <ul className="cmp-decide-list small">
                <li>실제 계획과 부두가 다른 배 {focus.moves ?? '-'}척</li>
                <li>체선 {card.dem}척, 야간 접안 {card.night}척</li>
                <li>{engineText(focus)}, {focus.solveSec ?? '-'}초</li>
              </ul>
              <p className={`risk-check-count small ${unchecked.length ? 'c-amber' : 'c-green'}`}>확인할 리스크 <span className="num">{focusRisks.length}</span>건 중 <span className="num">{focusRisks.length - unchecked.length}</span>건 확인</p>
              {current && <p className="small c-amber">적용 중: {current.label} ({current.status}). 확정하면 새 버전이 됩니다.</p>}
              <div className="risk-reason-field">
                <label htmlFor="risk-reason">판단 근거 (확정 기록과 보고서에 남음)</label>
                <TextArea id="risk-reason" fill rows={3} value={reason} disabled={!isScheduler} onChange={(e) => setReason(e.currentTarget.value)} placeholder="예: 체선료가 가장 낮고, 야간 접안은 도선과 줄잡이 인력을 미리 배치해 대응" />
              </div>
              {blocked && <p className="small c-amber">{result.running ? '다시 계산하는 중입니다.' : '계획 조건이 바뀌어 다시 계산한 뒤에 확정할 수 있습니다.'}</p>}
              {asking ? (
                <Callout className="risk-confirmation" intent="warning" icon="warning-sign">
                  <p className="small"><b>확인하지 않은 리스크 {unchecked.length}건</b> ({unchecked.map((r) => r.label).join(', ')}). 확정 기록에 함께 남습니다.</p>
                  <div className="risk-buttons"><Button size="small" onClick={() => setAsking(false)}>돌아가기</Button><Button size="small" intent="warning" onClick={() => fix(true)}>그래도 확정</Button></div>
                </Callout>
              ) : <Button intent="primary" icon="endorsed" fill disabled={!isScheduler || blocked} onClick={() => fix(false)}>이 안으로 확정</Button>}
              <p className="risk-policy tiny muted">확정하면 이용자 화면에 바로 나가고, 이 화면은 확정 일정 모니터링으로 바뀝니다. Agent는 확정하지 않습니다.</p>
            </div>
          </Panel>
          {fixedNow && <Button icon="arrow-left" onClick={() => setShowCands(false)}>확정 화면으로</Button>}
          <Panel code="VESSEL-OUT" title={`${focus.label} 선박별 체선료`} desc="큰 순" pad={false}>
            <div className="cmp-scroll short">
              <table className="dt cmp-mini">
                <thead><tr><th>선박 / 선석</th><th>접안</th><th className="r">체선료</th></tr></thead>
                <tbody>{[...focus.placements].sort((a, b) => demCents(b) - demCents(a) || a.etb - b.etb).map((p) => <tr key={p.vid} className="click" onClick={() => openVessel(focus.id, p.vid, { mode: 'card' })}>
                  <td><span className="strong">{vname(p.vid)}</span><br /><span className="tiny muted">{shortBerth(bById[p.bid], p.bid)}</span></td><td className="num">{fmt(p.etb)}</td><td className={`r num ${p.dem.cents ? 'c-red' : 'muted'}`}>{money(p.dem.cents)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </Panel>
        </aside>
      </div>
    </Screen>
  )
}
