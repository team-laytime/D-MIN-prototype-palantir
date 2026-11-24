// 보고서 생성: 후보안 선택 → 숙련자 판단근거 작성 → 확정. 왼쪽에서 고르고 쓰면 오른쪽 미리보기에 보고서가 만들어진다.
// 메일은 왼쪽 메뉴의 「메일 작성」 화면이 같은 초안으로 따로 다룬다.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Callout, SegmentedControl, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { downloadMarkdown, useReport } from '../state/useReport.js'
import { logActivity } from '../lib/workspace.js'
import { fmt, fmtDur, money } from '../lib/time.js'
import { Panel, Screen, St, Stats, riskTone } from '../ui/kit.jsx'
import { TotalChart, VesselChart } from './ReportCharts.jsx'
import { describe } from './Compare.jsx'
import OrderCompare from './OrderCompare.jsx'
import './report.css'

export default function Report() {
  const { result, scen, setFocusId, version, isScheduler, checks, go, setReportDraft, openVessel } = useApp()
  const { model, md, check, plan, shownPlan, selId, judgment } = useReport()
  const [view, setView] = useState('doc')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const timer = useRef(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const sel = model.sel
  // 11-20 피드백: 체선료 차이만이 아니라 그 차이가 어디서(어느 선박, 어떤 규칙) 생겼는지
  const why = result.error ? [] : result.candidates.map((c) => ({ id: c.id, label: c.label, ...describe(c, result.fcfs, scen) }))
  // 판단근거는 입력이 끝났을 때(포커스가 빠질 때) 바뀐 경우만 한 번 기록한다.
  const loggedJudgment = useRef(judgment)
  const logJudgment = () => {
    if (judgment === loggedJudgment.current) return
    loggedJudgment.current = judgment
    logActivity('보고서', '판단근거 수정', sel.label, judgment.length > 60 ? `${judgment.slice(0, 60)}…` : judgment)
  }

  async function copy() {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(md)
      window.clearTimeout(timer.current)
      setCopied(true)
      logActivity('보고서', '보고서 복사', sel.label)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
      setCopyError('클립보드에 복사하지 못했습니다. 문구를 선택해 직접 복사해 주십시오.')
    }
  }
  function exportPdf() {
    logActivity('보고서', 'PDF 내보내기', sel.label)
    // 인쇄용 사본(#print-root)만 남기고 찍는다. 브라우저의 'PDF로 저장'을 고르면 PDF가 된다.
    window.print()
  }
  function download() {
    downloadMarkdown(md, sel.id)
    logActivity('보고서', '보고서 내려받기', sel.label, '.md')
  }

  return (
    <Screen tab="report" title="접안계획 보고서" step={3} bodyClass="rpt-page" actions={
      <Button icon="envelope" text="메일 작성" endIcon="arrow-right" onClick={() => go('mail')} />
    }>
      <p className="muted small">「후보 비교·확정」에서 고른 안으로 보고서를 만듭니다. 판단근거를 적으면 후보 3개 비교, 차트(막대 아래 이유), 후보별 분석, 공통 리스크가 담깁니다. 금액은 계산 결과를 그대로 넣고 자동 대조합니다.</p>
      <Stats items={[
        { label: '선택 후보', value: <span className="rpt-prose">{sel.label}</span>, sub: shownPlan ? shownPlan.status : '확정 전' },
        { label: '총 예상 체선료', value: money(sel.total), tone: 'accent' },
        { label: '기준안 대비', value: `-${sel.savingPct}%`, tone: 'green', sub: `${money(sel.saving)} 절감` },
        { label: '판단근거', value: <span className="rpt-prose">{model.judgment ? '작성됨' : '미작성'}</span>, tone: model.judgment ? 'green' : 'amber', sub: `${model.judgment.length}자` },
        { label: '숫자 대조', value: <span className="rpt-prose">{check.bad.length ? '실패' : '통과'}</span>, tone: check.bad.length ? 'red' : 'green', sub: `문서·메일 금액 ${check.count}개` },
      ]} />
      {check.bad.length > 0 && <Callout intent="danger" icon="error">숫자 대조 실패: {check.bad.join(', ')}. 사용 금지.</Callout>}
      {copyError && <Callout intent="danger" icon="error" role="alert">{copyError}</Callout>}
      <span className="rpt-sr" role="status">{copied ? '보고서 복사됨' : ''}</span>

      <div className="rpt-grid">
        <div className="stack">
        {/* 11-23 피드백: 후보는 「후보 비교·확정」에서만 고른다. 여기서는 고른 안을 보여 주기만 한다. */}
        <Panel code="RPT-BASE" title="보고할 안" desc={shownPlan ? '확정안' : '후보 비교·확정에서 고른 안'} pad>
          <div className="rpt-base">
            <b>{sel.label}</b>{shownPlan ? <St tone="ok">확정 v{shownPlan.planNo}</St> : <St tone="warn">확정 전</St>}
            <span className="num rpt-base-total">{money(sel.total)}</span>
            <span className="small muted">기준안 대비 <span className="num c-green">-{sel.savingPct}%</span> · 체선 {sel.demVessels.length}척 · 리스크 {sel.active.length}건</span>
          </div>
          <Button size="small" icon="comparison" onClick={() => go('compare')}>{shownPlan ? '후보 비교·확정 보기' : '다른 안은 후보 비교에서 고르기'}</Button>
        </Panel>

        <Panel code="EXPERT-NOTE" title="숙련자 판단근거" desc="후보 중 이 안을 고른 이유" pad>
          <TextArea
            className="rpt-judgment" fill rows={7} value={judgment} disabled={!isScheduler}
            onChange={(e) => setReportDraft({ judgment: e.target.value })}
            onBlur={logJudgment}
            placeholder="예: 후보 A는 B·C보다 체선료가 가장 적고 남은 리스크 수는 같아 비용 차이로 결정했습니다. 야간 접안은 도선·계류 인력을 미리 배치합니다."
            aria-label="숙련자 판단근거"
          />
          <ul className="rpt-guide small muted">
            <li>다른 후보와의 체선료·일정 차이</li>
            <li>남은 리스크를 어떻게 다룰지</li>
            <li>계산에 없는 현장 여건(도선·인력·탱크·화주 요청)</li>
          </ul>
        </Panel>

        </div>

      <Panel code="RPT-DOC" title="보고서 미리보기" desc={`${sel.label} 기준 · ${model.status}`} className="rpt-doc-panel" data-tour="report-doc" actions={
        <div className="rpt-tools">
          <SegmentedControl size="small" aria-label="보기 방식" value={view} onValueChange={setView}
            options={[{ value: 'doc', label: '문서' }, { value: 'raw', label: '마크다운' }]} />
          <Button size="small" icon={copied ? 'tick' : 'duplicate'} onClick={copy}>{copied ? '복사됨' : '복사'}</Button>
          <Button size="small" icon="download" onClick={download}>내려받기 (.md)</Button>
          <Button size="small" icon="print" onClick={exportPdf}>PDF</Button>
        </div>
      }>
        {view === 'raw' ? <pre className="rpt-raw">{md}</pre> : <ReportDoc m={model} why={why} sims={result.error ? [] : [result.fcfs, ...result.candidates]} scen={scen} onVessel={(simId, vid) => openVessel(simId, vid)} />}
        </Panel>
      </div>
      {createPortal(<div id="print-root" className="rpt-print-root"><ReportDoc m={model} why={why} sims={result.error ? [] : [result.fcfs, ...result.candidates]} scen={scen} onVessel={() => {}} /></div>, document.body)}
    </Screen>
  )
}

// 문서 속 선박 이름은 원본(선박 카드)으로 이어진다.
function VesselLink({ simId, vid, name, onVessel }) {
  return <button type="button" className="rpt-obj" title="선박 카드 열기" onClick={() => onVessel(simId, vid)}>{name}</button>
}

function ReportDoc({ m, why = [], sims = [], scen, onVessel }) {
  const selWhy = why.find((c) => c.id === m.sel.id)
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

      {sims.length > 0 && <section>
        <h2 className="rpt-h-plain">한눈에: 접안 순서와 차이의 이유</h2>
        <OrderCompare sims={sims} scen={scen} focusId={m.sel.id} compact />
        {selWhy && selWhy.diffs.length > 0 && <table className="dt rpt-why">
          <thead><tr><th>{m.sel.label}에서 바뀐 선박</th><th>무엇이 바뀌었나</th><th>왜</th><th className="r">그 선박 체선료</th></tr></thead>
          <tbody>{selWhy.diffs.map((d) => <tr key={d.vid}><td className="strong">{d.name}</td><td>{d.text}</td><td className="small">{d.why}</td>
            <td className={`r num ${d.saving > 0 ? 'c-green' : d.saving < 0 ? 'c-red' : 'muted'}`}>{d.saving === 0 ? '변화 없음' : `${d.saving > 0 ? '−' : '+'}${money(Math.abs(d.saving))}`}</td></tr>)}</tbody>
        </table>}
      </section>}

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
            <VesselChart rows={m.perVessel} series={series} selId={m.sel.id} reasons={Object.fromEntries((why.find((c) => c.id === m.sel.id)?.diffs ?? []).map((d) => [d.name, `${d.text} · ${d.why}`]))} />
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
                    <li key={d.vid}><span><VesselLink simId={it.id} vid={d.vid} name={d.name} onVessel={onVessel} /> <span className="muted">· {d.berth} · 초과 {fmtDur(d.excessMin)}</span></span><span className="num c-red">{money(d.cents)}</span></li>
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
              <tr key={s.vid}><td className="strong"><VesselLink simId={m.sel.id} vid={s.vid} name={s.name} onVessel={onVessel} /></td><td>{s.berth}</td><td className="num">{fmt(s.eta)}</td><td className="num">{fmt(s.etb)}</td><td className="num">{fmt(s.etu)}</td><td className={`r num ${s.cents ? 'c-red' : ''}`}>{money(s.cents)}</td></tr>
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
