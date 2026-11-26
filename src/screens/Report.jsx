// 접안계획 보고서 (11-24 실데이터). 보고서는 체선료 지불 부서 확정 통보 메일의 첨부(ReportDoc)로 나간다.
// 이 화면은 판단근거를 쓰고 문서를 복사, 내려받기, 인쇄하는 작업면이다. 숫자는 모두 엔진 결과이고 자동 대조한다.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Callout, SegmentedControl, Spinner, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { downloadMarkdown, useReport } from '../state/useReport.js'
import { logActivity } from '../lib/workspace.js'
import { fmt, fmtDur, money } from '../lib/time.js'
import { Panel, Screen, St, riskTone } from '../ui/kit.jsx'
import { TotalChart, VesselChart } from './ReportCharts.jsx'
import './report.css'

export default function Report() {
  const { isScheduler, go, setReportDraft, openVessel } = useApp()
  const { model, md, check, shownPlan, judgment } = useReport()
  const [view, setView] = useState('doc')
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const timer = useRef(null)
  const loggedJudgment = useRef(judgment)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!model) return <Screen tab="report" title="접안계획 보고서"><div className="cmp-none"><Spinner size={20} /> 후보를 불러오는 중입니다</div></Screen>
  const sel = model.sel
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
  const exportPdf = () => { logActivity('보고서', 'PDF 내보내기', sel.label); window.print() }
  const download = () => { downloadMarkdown(md, sel.id); logActivity('보고서', '보고서 내려받기', sel.label, '.md') }

  return (
    <Screen tab="report" title="접안계획 보고서" step={3} bodyClass="rpt-page" actions={<Button icon="envelope" text="메일 작성" endIcon="arrow-right" onClick={() => go('mail')} />}>
      <p className="muted small">「후보 비교·확정」에서 고른 안으로 보고서를 만듭니다. 금액은 계산 결과를 그대로 넣고 자동 대조합니다 (문서와 메일 금액 {check.count}개, {check.bad.length ? '대조 실패' : '대조 통과'}).</p>
      {check.bad.length > 0 && <Callout intent="danger" icon="error">숫자 대조 실패: {check.bad.join(', ')}. 사용 금지.</Callout>}
      {copyError && <Callout intent="danger" icon="error" role="alert">{copyError}</Callout>}
      <span className="rpt-sr" role="status">{copied ? '보고서 복사됨' : ''}</span>

      <div className="rpt-grid">
        <div className="stack">
          <Panel code="RPT-BASE" title="보고할 안" desc={shownPlan ? '확정안' : '후보 비교·확정에서 고른 안'} pad>
            <div className="rpt-base">
              <b>{sel.label}, {sel.preset?.label}</b>{shownPlan ? <St tone="ok">확정 v{shownPlan.planNo}</St> : <St tone="warn">확정 전</St>}
              <span className="num rpt-base-total">{money(sel.total)}</span>
              <span className="small muted">{sel.extra ? <>최저안 대비 <span className="num">+{sel.extraPct}%</span></> : <span className="c-green">최저 체선료</span>}</span>
            </div>
            <Button size="small" icon="comparison" onClick={() => go('compare')}>{shownPlan ? '후보 비교·확정 보기' : '다른 안은 후보 비교에서 고르기'}</Button>
          </Panel>
          <Panel code="EXPERT-NOTE" title="판단근거" desc="후보 중 이 안을 고른 이유" pad>
            <TextArea className="rpt-judgment" fill rows={7} value={judgment} disabled={!isScheduler}
              onChange={(e) => setReportDraft({ judgment: e.target.value })} onBlur={logJudgment}
              placeholder="예: 체선료가 가장 낮고 남은 리스크 수는 같아 비용 차이로 결정했습니다. 야간 접안은 도선과 계류 인력을 미리 배치합니다." aria-label="판단근거" />
          </Panel>
        </div>
        <Panel code="RPT-DOC" title="보고서 미리보기" desc={`${sel.label} 기준, ${model.status}`} className="rpt-doc-panel" data-tour="report-doc" actions={
          <div className="rpt-tools">
            <SegmentedControl size="small" aria-label="보기 방식" value={view} onValueChange={setView} options={[{ value: 'doc', label: '문서' }, { value: 'raw', label: '마크다운' }]} />
            <Button size="small" icon={copied ? 'tick' : 'duplicate'} onClick={copy}>{copied ? '복사됨' : '복사'}</Button>
            <Button size="small" icon="download" onClick={download}>내려받기 (.md)</Button>
            <Button size="small" icon="print" onClick={exportPdf}>PDF</Button>
          </div>
        }>
          {view === 'raw' ? <pre className="rpt-raw">{md}</pre> : <ReportDoc m={model} onVessel={(simId, vid) => openVessel(simId, vid, { mode: 'evidence' })} />}
        </Panel>
      </div>
      {createPortal(<div id="print-root" className="rpt-print-root"><ReportDoc m={model} /></div>, document.body)}
    </Screen>
  )
}

// 문서 속 선박 이름은 선박 카드로 이어진다(메일 첨부 미리보기에서는 글자만).
function VesselLink({ simId, vid, name, onVessel }) {
  if (!onVessel) return <b>{name}</b>
  return <button type="button" className="rpt-obj" title="계획 일정 열기" onClick={() => onVessel(simId, vid)}>{name}</button>
}

/** 보고서 본문. m = buildCandidateReport() 결과. 체선료 지불 부서 메일의 첨부로도 쓴다. */
export function ReportDoc({ m, onVessel }) {
  if (!m) return null
  const sel = m.sel
  return (
    <article className="rpt-doc">
      <header className="rpt-doc-head">
        <h1>울산 부두 접안 계획 후보안 비교 보고 ({m.period})</h1>
        <p className="small muted">{m.status}, 담당자 검토용</p>
      </header>

      <section>
        <h2><span className="num">1</span>결론</h2>
        <p>{m.confirmed ? '확정한' : '선택한'} 안은 {sel.label}({sel.preset?.label ?? '-'})입니다. 총 예상 체선료는 <b className="num">{money(sel.total)}</b>이며,{' '}
          {sel.extra ? <>최저안({m.best.label}) <span className="num">{money(m.best.total)}</span>보다 <b className="num">{money(sel.extra)}</b>({sel.extraPct}%) 많습니다.</> : '세 후보 중 가장 낮습니다.'}</p>
        <div className={`rpt-judgment-quote ${m.judgment ? '' : 'empty'}`}>
          <span className="rpt-quote-label tiny">판단근거</span>
          <p>{m.judgment || '확정할 때 적은 판단근거가 여기에 들어갑니다.'}</p>
        </div>
      </section>

      <section>
        <h2><span className="num">2</span>후보 비교</h2>
        <table className="dt rpt-table">
          <thead><tr><th>안</th><th>무엇을 바꾼 안</th><th className="r">총 예상 체선료</th><th className="r">최저안 대비</th><th className="r">체선</th><th className="r">야간 접안</th><th className="r">남은 리스크</th></tr></thead>
          <tbody>{m.items.map((it) => (
            <tr key={it.id} className={it.id === sel.id ? 'on' : ''}>
              <td className="strong">{it.label}{it.id === sel.id && <span className="chip accent rpt-sel">선택</span>}</td>
              <td className="small">{it.preset?.label}<br /><span className="muted">{it.preset?.desc}</span></td>
              <td className="r num">{money(it.total)}</td>
              <td className={`r num ${it.extra ? '' : 'c-green'}`}>{it.extra ? `+${money(it.extra)} (+${it.extraPct}%)` : '가장 낮음'}</td>
              <td className="r num">{it.dem}척</td>
              <td className="r num">{it.night}척</td>
              <td className="r num">{it.active.length}건</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="rpt-charts">
          <figure className="rpt-figure">
            <figcaption className="rpt-fig-title small strong">안별 총 예상 체선료</figcaption>
            <TotalChart rows={m.totals} selId={sel.id} />
          </figure>
          <div>
            <p className="rpt-fig-title small strong">체선료가 큰 선박 상위 {m.perVessel.length}척 (후보 비교)</p>
            <VesselChart rows={m.perVessel} series={m.series} selId={sel.id} />
          </div>
        </div>
      </section>

      <section>
        <h2><span className="num">3</span>{sel.label} 선박별 체선료 상위</h2>
        <p className="small muted">체선이 생기는 선박 {m.demCount}척 중 큰 순서 {m.top.length}척</p>
        {m.top.length ? (
          <table className="dt rpt-table">
            <thead><tr><th>선박</th><th>화물</th><th>선석</th><th>접안</th><th className="r">초과 시간</th><th className="r">기상 공제</th><th className="r">체선료</th></tr></thead>
            <tbody>{m.top.map((r) => (
              <tr key={r.vid}><td><VesselLink simId={sel.id} vid={r.vid} name={r.name} onVessel={onVessel} /></td><td className="small">{r.product}, {r.dir}</td><td>{r.berth}</td><td className="num">{fmt(r.etb)}</td>
                <td className="r num">{fmtDur(r.excessMin)}</td><td className="r num">{r.weatherMin ? fmtDur(r.weatherMin) : '-'}</td><td className="r num c-red">{money(r.cents)}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="small">체선이 생기는 선박이 없습니다.</p>}
      </section>


      <section>
        <h2><span className="num">4</span>남은 리스크</h2>
        <p className="rpt-sub tiny">공통 (어느 안을 골라도 남음)</p>
        {m.common.length ? (
          <ul className="rpt-common">{m.common.map((c) => (
            <li key={c.key}>
              <div className="rpt-common-head"><b>{c.label}</b>{c.per.map((p) => <span key={p.id} className="chip amber">{p.id} 해당</span>)}</div>
              <p className="small">{c.per.find((p) => p.id === sel.id)?.evidence}</p>
              <p className="small"><span className="muted">대응</span> {c.alternative}</p>
            </li>
          ))}</ul>
        ) : <p className="small">없음</p>}
        {m.differing.length > 0 && <>
          <p className="rpt-sub tiny">후보마다 갈림</p>
          <table className="dt rpt-table">
            <thead><tr><th>리스크</th>{m.items.map((it) => <th key={it.id}>{it.label}</th>)}</tr></thead>
            <tbody>{m.differing.map((d) => <tr key={d.key}><td className="strong">{d.label}</td>{d.per.map((p) => <td key={p.id}><St tone={riskTone(p.state)}>{p.state}</St></td>)}</tr>)}</tbody>
          </table>
        </>}
      </section>

      <section className="rpt-basis small muted">
        <h2>계산 기준</h2>
        <p>후보 구성</p>
        <ul className="rpt-guide">{m.basis.presets.map((t) => <li key={t}>{t}</li>)}</ul>
        <p>데이터: {m.basis.dataset}{m.basis.bundle ? ` (${m.basis.bundle})` : ''}, {m.basis.vessels}척, 선석 {m.basis.berths}곳. 계획 시각 {m.basis.start}, 계획 구간 끝 {m.basis.end}.</p>
        <p>후보는 A 기본 · B 상황형(탱크 · 풍속 중 리스크가 큰 쪽 대비) · C 배별 지연 대비이며 A가 기본 선택입니다.</p>
      </section>
    </article>
  )
}
