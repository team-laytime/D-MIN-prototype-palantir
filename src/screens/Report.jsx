// 보고서 생성: 후보안 선택 → 숙련자 판단근거 작성 → 확정. 오른쪽은 보고서와 메일 초안을 탭으로 나눠 미리 본다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, SegmentedControl, Tab, Tabs, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { fixPlan } from '../lib/workspace.js'
import { buildCandidateReport, candidateReportMarkdown } from '../lib/candidateReport.js'
import { fmt, fmtDur, money } from '../lib/time.js'
import { Panel, Screen, St, Stats, riskTone } from '../ui/kit.jsx'
import { TotalChart, VesselChart } from './ReportCharts.jsx'
import './report.css'

function mailText(m) {
  const lines = [
    `제목: [울산 CLX] ${m.period} 접안 계획안 ${m.confirmed ? '확정' : '검토'} 보고 (${m.sel.label}, 예상 체선료 ${money(m.sel.total)})`,
    '',
    '안녕하세요.',
    `${m.period} 울산 터미널 접안 계획으로 ${m.sel.label}을 ${m.confirmed ? '확정했습니다' : '선택해 검토 중입니다'}.`,
    '',
    `- 총 예상 체선료: ${money(m.sel.total)} (도착순 기준안 ${money(m.base.total)} 대비 ${money(m.sel.saving)}, ${m.sel.savingPct}% 감소)`,
    `- 비교한 후보: ${m.items.map((it) => `${it.label} ${money(it.total)}`).join(', ')}`,
    `- 공통 리스크: ${m.common.map((c) => c.label).join(', ') || '없음'}`,
    `- 판단근거: ${m.judgment || '(작성 전)'}`,
    '',
    '후보별 분석과 차트는 첨부 보고서를 참고해 주십시오.',
    '',
    '※ 가상 데이터 기반 의사결정 보조 자료이며, 담당자 검토용 초안입니다.',
  ]
  return lines.join('\n')
}

export default function Report() {
  const { result, scen, focusId, setFocusId, current, version, isScheduler, checks, go } = useApp()
  const cands = result.candidates
  const plan = current?.version === version ? current : null
  const [selId, setSelId] = useState(() => plan?.candId ?? (cands.some((c) => c.id === focusId) ? focusId : cands[0].id))
  const [judgment, setJudgment] = useState(plan?.reason ?? '')
  const [tab, setTab] = useState('report')
  const [view, setView] = useState('doc')
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  const timer = useRef(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const choose = (id) => { setSelId(id); setFocusId(id) }
  const shownPlan = plan && plan.candId === selId ? plan : null
  const model = useMemo(
    () => buildCandidateReport({ result, scen, selId, judgment, plan: shownPlan }),
    [result, scen, selId, judgment, shownPlan],
  )
  const md = useMemo(() => candidateReportMarkdown(model), [model])
  const mail = useMemo(() => mailText(model), [model])

  // 문서 속 금액이 전부 계산 결과에서 나왔는지 대조한다.
  const check = useMemo(() => {
    const allowed = new Set()
    for (const sim of [result.fcfs, ...cands]) {
      for (const c of [sim.total, sim.total - result.fcfs.total, result.fcfs.total - sim.total]) allowed.add(money(c))
      for (const p of sim.placements) allowed.add(money(p.dem.cents))
    }
    // 판단근거는 사람이 쓴 문장이라 대조에서 뺀다(차액 등 계산에 없는 금액을 적을 수 있다).
    const generated = { ...model, judgment: '' }
    const found = [...(candidateReportMarkdown(generated) + mailText(generated)).matchAll(/-?\$[\d,]+\.\d{2}/g)].map((x) => x[0])
    return { count: found.length, bad: found.filter((a) => !allowed.has(a)) }
  }, [model, result, cands])

  const sel = model.sel
  const unchecked = sel.active.filter((r) => !checks[`${version}:${sel.id}:${r.key}`])
  const canFix = isScheduler && model.judgment.length > 0 && !shownPlan

  async function copy(which, text) {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(text)
      window.clearTimeout(timer.current)
      setCopied(which)
      timer.current = window.setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('')
      setCopyError('클립보드에 복사하지 못했습니다. 문구를 선택해 직접 복사해 주십시오.')
    }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `접안계획_후보안비교_${sel.id}.md`
    document.body.append(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function confirmPlan() {
    const cand = cands.find((c) => c.id === selId)
    fixPlan({ cand, scen, version, reason: model.judgment, uncheckedRisks: unchecked.map((r) => r.label) })
    setFocusId(selId)
  }

  return (
    <Screen tab="report" title="접안계획 보고서" step={5} bodyClass="rpt-page">
      <p className="muted small">후보안을 고르고 숙련자 판단근거를 적으면 후보 3개 비교·차트·후보별 분석·공통 리스크가 담긴 보고서가 만들어집니다. 금액은 계산 결과를 그대로 넣고 자동 대조합니다.</p>
      <Stats items={[
        { label: '선택 후보', value: <span className="rpt-prose">{sel.label}</span>, sub: shownPlan ? shownPlan.status : '확정 전' },
        { label: '총 예상 체선료', value: money(sel.total), tone: 'accent' },
        { label: '기준안 대비', value: `-${sel.savingPct}%`, tone: 'green', sub: `${money(sel.saving)} 절감` },
        { label: '판단근거', value: <span className="rpt-prose">{model.judgment ? '작성됨' : '미작성'}</span>, tone: model.judgment ? 'green' : 'amber', sub: `${model.judgment.length}자` },
        { label: '숫자 대조', value: <span className="rpt-prose">{check.bad.length ? '실패' : '통과'}</span>, tone: check.bad.length ? 'red' : 'green', sub: `문서 금액 ${check.count}개` },
      ]} />
      {check.bad.length > 0 && <Callout intent="danger" icon="error">숫자 대조 실패: {check.bad.join(', ')}. 사용 금지.</Callout>}
      {copyError && <Callout intent="danger" icon="error" role="alert">{copyError}</Callout>}
      <span className="rpt-sr" role="status">{copied ? `${copied === 'mail' ? '메일' : '보고서'} 복사됨` : ''}</span>

      <div className="rpt-grid">
        <div className="stack">
          <Panel code="RPT-PICK" title="후보안 선택" desc="보고서의 기준이 될 안">
            <div className="rpt-picks" role="radiogroup" aria-label="후보안">
              {model.items.map((it) => (
                <button key={it.id} type="button" role="radio" aria-checked={selId === it.id} className={`rpt-pick ${selId === it.id ? 'on' : ''}`} onClick={() => choose(it.id)}>
                  <span className="rpt-pick-head">
                    <span className="rpt-pick-dot" />
                    <b>{it.label}</b>
                    {plan?.candId === it.id && <span className="chip green">확정 v{plan.planNo}</span>}
                    <span className="num rpt-pick-total">{money(it.total)}</span>
                  </span>
                  <span className="rpt-pick-meta small">
                    <span className="c-green num">-{it.savingPct}%</span>
                    <span>체선 <b className="num">{it.demVessels.length}</b>척</span>
                    <span>리스크 <b className="num c-amber">{it.active.length}</b>건</span>
                    <span>변경 <b className="num">{it.changed.length}</b>척</span>
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel code="EXPERT-NOTE" title="숙련자 판단근거" desc="후보 중 이 안을 고른 이유" pad>
            <TextArea
              className="rpt-judgment" fill rows={7} value={judgment} disabled={!isScheduler}
              onChange={(e) => setJudgment(e.target.value)}
              placeholder="예: 후보 A는 B·C보다 체선료가 가장 적고 남은 리스크 수는 같아 비용 차이로 결정했습니다. 야간 접안은 도선·계류 인력을 미리 배치합니다."
              aria-label="숙련자 판단근거"
            />
            <ul className="rpt-guide small muted">
              <li>다른 후보와의 체선료·일정 차이</li>
              <li>남은 리스크를 어떻게 다룰지</li>
              <li>계산에 없는 현장 여건(도선·인력·탱크·화주 요청)</li>
            </ul>
          </Panel>

          <Panel code="RPT-FIX" title="확정" pad>
            {shownPlan ? (
              <div className="rpt-fixed">
                <St tone="ok">{sel.label} 확정 v{shownPlan.planNo}</St>
                <p className="small muted">판단근거가 보고서와 확정 이력에 남았습니다. 확정 취소는 「리스크·확정」에서 합니다.</p>
                <Button size="small" icon="shield" onClick={() => go('risk')}>리스크·확정</Button>
              </div>
            ) : (
              <>
                {plan && <Callout compact intent="primary" icon="info-sign" className="rpt-note">지금 적용 중인 확정안은 {plan.label}입니다. 확정하면 {sel.label}로 바뀝니다.</Callout>}
                {unchecked.length > 0 && (
                  <Callout compact intent="warning" icon="warning-sign" className="rpt-note">
                    {sel.label}의 리스크 {unchecked.length}건을 아직 확인하지 않았습니다({unchecked.map((r) => r.label).join(', ')}). 확정하면 미확인 상태로 기록됩니다.
                    <Button variant="minimal" size="small" intent="warning" onClick={() => go('risk')}>확인하러 가기</Button>
                  </Callout>
                )}
                <Button intent="primary" fill icon="endorsed" disabled={!canFix} onClick={confirmPlan} text={`${sel.label}으로 보고서 확정`} />
                {!model.judgment && <p className="tiny muted rpt-hint">판단근거를 적어야 확정할 수 있습니다.</p>}
              </>
            )}
          </Panel>
        </div>

        <Panel code="RPT-DOC" title="보고서 미리보기" className="rpt-doc-panel" data-tour="report-mail" actions={
          <div className="rpt-tools">
            {tab === 'report' && (
              <SegmentedControl size="small" aria-label="보기 방식" value={view} onValueChange={setView}
                options={[{ value: 'doc', label: '문서' }, { value: 'raw', label: '마크다운' }]} />
            )}
            <Button size="small" icon={copied === tab ? 'tick' : 'duplicate'} onClick={() => copy(tab, tab === 'mail' ? mail : md)}>{copied === tab ? '복사됨' : '복사'}</Button>
            {tab === 'report' && <Button size="small" icon="download" onClick={download}>내려받기 (.md)</Button>}
          </div>
        }>
          <Tabs id="rpt-tabs" selectedTabId={tab} onChange={setTab} className="rpt-tabs" renderActiveTabPanelOnly>
            <Tab id="report" title="보고서" panel={view === 'raw' ? <pre className="rpt-raw">{md}</pre> : <ReportDoc m={model} />} />
            <Tab id="mail" title="메일 초안" panel={(
              <div className="rpt-mail">
                <pre className="rpt-raw">{mail}</pre>
                <p className="tiny muted rpt-mail-foot">발송 기능 없음 · 복사 후 직접 발송</p>
              </div>
            )} />
          </Tabs>
        </Panel>
      </div>
    </Screen>
  )
}

function ReportDoc({ m }) {
  const series = [{ id: 'FCFS', label: '기준안' }, ...m.items.map((it) => ({ id: it.id, label: it.label }))]
  return (
    <article className="rpt-doc">
      <header className="rpt-doc-head">
        <h1>울산 CLX 접안 계획 후보안 비교 보고 ({m.period})</h1>
        <p className="small muted">{m.status} · 담당자 검토용 · 가상 데이터 · 의사결정 보조용</p>
      </header>

      <section>
        <h2><span className="num">1</span>결론</h2>
        <p>{m.sel.label}을 {m.confirmed ? '확정한' : '선택한'} 안으로 보고합니다. 총 예상 체선료는 <b className="num">{money(m.sel.total)}</b>이며, 도착순 기준안 <span className="num">{money(m.base.total)}</span> 대비 <b className="num c-green">{money(m.sel.saving)}</b>({m.sel.savingPct}%) 적습니다.</p>
        <div className={`rpt-judgment-quote ${m.judgment ? '' : 'empty'}`}>
          <span className="rpt-quote-label tiny">숙련자 판단근거</span>
          <p>{m.judgment || '왼쪽 「숙련자 판단근거」에 적은 내용이 여기에 들어갑니다.'}</p>
        </div>
      </section>

      <section>
        <h2><span className="num">2</span>후보안 비교</h2>
        <table className="dt rpt-table">
          <thead><tr><th>안</th><th className="r">총 예상 체선료</th><th className="r">기준안 대비</th><th className="r">절감률</th><th className="r">변경 선박</th><th className="r">체선 발생</th><th className="r">남은 리스크</th></tr></thead>
          <tbody>
            {[m.base, ...m.items].map((it) => (
              <tr key={it.id} className={it.id === m.sel.id ? 'on' : ''}>
                <td className="strong">{it.label}{it.id === m.sel.id && <span className="chip accent rpt-sel">선택</span>}</td>
                <td className="r num">{money(it.total)}</td>
                <td className={`r num ${it.id !== 'FCFS' ? 'c-green' : ''}`}>{it.id === 'FCFS' ? '-' : money(it.total - m.base.total)}</td>
                <td className="r num">{it.id === 'FCFS' ? '-' : `${it.savingPct}%`}</td>
                <td className="r num">{it.changed.length}척</td>
                <td className="r num">{it.demVessels.length}척</td>
                <td className="r num">{it.active.length}건</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rpt-charts">
          <figure className="rpt-figure">
            <figcaption className="rpt-fig-title small strong">안별 총 예상 체선료</figcaption>
            <TotalChart rows={[m.base, ...m.items].map((it) => ({ id: it.id, label: it.label, total: it.total }))} selId={m.sel.id} />
          </figure>
          <div>
            <p className="rpt-fig-title small strong">선박별 예상 체선료</p>
            <VesselChart rows={m.perVessel} series={series} selId={m.sel.id} />
          </div>
        </div>
      </section>

      <section>
        <h2><span className="num">3</span>후보별 분석</h2>
        <div className="rpt-cands">
          {m.items.map((it) => (
            <div key={it.id} className={`rpt-cand ${it.id === m.sel.id ? 'on' : ''}`}>
              <div className="rpt-cand-head">
                <b>{it.label}</b>
                {it.id === m.sel.id && <span className="chip accent">선택</span>}
                <span className="num rpt-cand-total">{money(it.total)}</span>
              </div>
              <dl className="rpt-kv small">
                <dt>기준안 대비</dt><dd className="num c-green">{money(-it.saving)} ({it.savingPct}%)</dd>
                <dt>변경 선박</dt><dd>{it.changed.join(', ') || '없음'}</dd>
                <dt>가장 긴 대기</dt><dd>{it.longestWait.name} <span className="num">{fmtDur(it.longestWait.min)}</span></dd>
              </dl>
              <p className="rpt-sub tiny">체선 발생</p>
              {it.demVessels.length ? (
                <ul className="rpt-list small">
                  {it.demVessels.map((d) => (
                    <li key={d.vid}><span>{d.name} <span className="muted">· {d.berth} · 초과 {fmtDur(d.excessMin)}</span></span><span className="num c-red">{money(d.cents)}</span></li>
                  ))}
                </ul>
              ) : <p className="small muted">없음</p>}
              <p className="rpt-sub tiny">남은 리스크</p>
              <ul className="rpt-list rpt-risks small">
                {it.active.length ? it.active.map((r) => (
                  <li key={r.key}><St tone={riskTone(r.state)}>{r.label}</St><span className="muted">{r.evidence}</span></li>
                )) : <li className="muted">없음</li>}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2><span className="num">4</span>공통 리스크</h2>
        <p className="small muted">어느 후보를 골라도 남는 리스크입니다. 선택과 상관없이 대응이 필요합니다.</p>
        {m.common.length ? (
          <ul className="rpt-common">
            {m.common.map((c) => (
              <li key={c.key}>
                <div className="rpt-common-head">
                  <b>{c.label}</b>
                  {c.per.map((p) => <span key={p.id} className={`chip ${p.risk.state === '판단 불가' ? 'violet' : 'amber'}`}>{p.label.replace('후보 ', '')} {p.risk.state}</span>)}
                </div>
                <p className="small"><span className="muted">대안</span> {c.alternative}</p>
                {c.caution !== '-' && <p className="small"><span className="muted">주의</span> {c.caution}</p>}
              </li>
            ))}
          </ul>
        ) : <p className="small">없음</p>}
        {m.differing.length > 0 && (
          <>
            <p className="rpt-sub tiny">후보마다 갈리는 리스크</p>
            <table className="dt rpt-table">
              <thead><tr><th>리스크</th>{m.items.map((it) => <th key={it.id}>{it.label}</th>)}</tr></thead>
              <tbody>
                {m.differing.map((d) => (
                  <tr key={d.key}><td className="strong">{d.label}</td>{d.per.map((p) => <td key={p.id}><St tone={riskTone(p.state)}>{p.state}</St></td>)}</tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section>
        <h2><span className="num">5</span>{m.sel.label} 선박별 일정</h2>
        <table className="dt rpt-table">
          <thead><tr><th>선박</th><th>부두</th><th>도착</th><th>접안</th><th>작업 종료</th><th className="r">예상 체선료</th></tr></thead>
          <tbody>
            {m.sel.schedule.map((s) => (
              <tr key={s.name}><td className="strong">{s.name}</td><td>{s.berth}</td><td className="num">{fmt(s.eta)}</td><td className="num">{fmt(s.etb)}</td><td className="num">{fmt(s.etu)}</td><td className={`r num ${s.cents ? 'c-red' : ''}`}>{money(s.cents)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rpt-basis small muted">
        <h2>계산 기준</h2>
        <p>체선료 = 초과 시간 ÷ 24시간 × 하루 체선료, 선박별 센트 단위 한 번 반올림(HALF_UP). 정박시간 개시·기상 공제는 선박별 계약 조항을 따릅니다. 기준안은 비교용 도착순 배치이며 현행 실적이 아닙니다.</p>
      </section>
    </article>
  )
}
