import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Callout, SegmentedControl } from '@blueprintjs/core'
import { Marked } from 'marked'
import { useApp } from '../state/app.jsx'
import { risks } from '../lib/engine.js'
import { buildReport, reportPeriod } from '../lib/report.js'
import { money } from '../lib/time.js'
import { Panel, Screen, Stats } from '../ui/kit.jsx'
import './decide.css'

const escapeHtml = (text) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
// 확정 사유도 문서에 들어가므로 원시 HTML·이미지는 실행하지 않는다.
const markdown = new Marked({
  renderer: {
    html: ({ text }) => escapeHtml(text),
    image: ({ text }) => escapeHtml(text),
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens)
      return /^https?:\/\//i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${text}</a>` : text
    },
  },
})

export default function Report() {
  const { all, result, scen, focusId, current, version, go } = useApp()
  const [reportView, setReportView] = useState('view')
  const [copied, setCopied] = useState('')
  const [copyError, setCopyError] = useState('')
  const copyTimer = useRef(null)
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])
  const chosen = current?.version === version ? current : null
  const cand = all.find((s) => s.id === (chosen?.candId ?? focusId)) ?? result.candidates[0]
  const draft = useMemo(() => {
    const fcfs = result.fcfs
    const vessels = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
    const saving = fcfs.total - cand.total
    const savingPct = fcfs.total ? ((saving / fcfs.total) * 100).toFixed(1) : '0.0'
    const period = reportPeriod(cand)
    const hits = risks(cand, scen).filter((r) => r.state !== '해당 없음')
    const lines = [
      `제목: [울산 CLX] ${period} 접안 계획안 검토 요청 (${cand.label}, 예상 체선료 ${money(cand.total)})`,
      '',
      '안녕하세요.',
      `${period} 울산 터미널 접안 계획으로 ${cand.label}을 ${chosen ? '확정했습니다' : '검토 중입니다'}.`,
      '',
      `- 총 예상 체선료: ${money(cand.total)} (도착순 기준안 ${money(fcfs.total)} 대비 ${money(saving)}, ${savingPct}% 감소)`,
      `- 기준안과 달라진 선박: ${cand.changed.map((id) => vessels[id].name).join(', ') || '없음'}`,
      `- 확인이 필요한 리스크: ${hits.map((r) => `${r.label}(${r.state})`).join(', ') || '없음'}`,
    ]
    if (chosen) lines.push(`- 확정 사유: ${chosen.reason}`)
    lines.push('', '선박별 일정과 산출 근거는 첨부 보고서를 참고해 주십시오.', '', '※ 가상 데이터 기반 의사결정 보조 자료이며, 담당자 검토용 초안입니다.')
    const mail = lines.join('\n')
    const report = buildReport({ result, scen, cand, reason: chosen?.reason ?? null })
    const allowed = new Set()
    for (const sim of all) {
      allowed.add(money(sim.total))
      allowed.add(money(sim.total - fcfs.total))
      for (const p of sim.placements) allowed.add(money(p.dem.cents))
    }
    allowed.add(money(saving))
    allowed.add(money(-saving))
    const found = [...(mail + report).matchAll(/-?\$[\d,]+\.\d{2}/g)].map((match) => match[0])
    return { mail, report, html: markdown.parse(report), count: found.length, bad: found.filter((amount) => !allowed.has(amount)) }
  }, [all, result, scen, cand, chosen])

  async function copy(which, text) {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(text)
      window.clearTimeout(copyTimer.current)
      setCopied(which)
      copyTimer.current = window.setTimeout(() => setCopied(''), 1500)
    } catch {
      setCopied('')
      setCopyError('클립보드에 복사하지 못했습니다. 초안의 문구를 선택해 직접 복사해 주십시오.')
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([draft.report], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `접안계획_검토보고_${cand.id}.md`
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <Screen tab="report" title="접안계획 보고서" step={5} bodyClass="report-page">
      <p className="report-intro muted small">확정한 계획(확정 전이면 검토 중인 후보) 기준 메일·보고서 초안. 금액은 계산 결과를 그대로 넣고 자동 대조하며, 메일은 발송하지 않습니다.</p>
      <Stats items={[
        { label: '기준 후보', value: <span className="report-prose">{cand.label}</span>, sub: chosen ? current.status : '검토 중인 후보' },
        { label: '총 예상 체선료', value: money(cand.total).replace(/\.\d+$/, '') },
        { label: '숫자 대조', value: <span className="report-prose">{draft.bad.length ? '실패' : '통과'}</span>, tone: draft.bad.length ? 'red' : 'green', sub: `초안 금액 ${draft.count}개 대조` },
      ]} />
      {!chosen && (
        <Callout className="report-callout" intent="warning" icon="edit" title="확정 전">
          {cand.label} 기준 초안입니다. 「리스크·확정」에서 확정하면 확정 사유가 추가됩니다.
          <Button variant="minimal" size="small" intent="warning" onClick={() => go('risk')}>리스크·확정</Button>
        </Callout>
      )}
      <Callout className="report-callout" intent={draft.bad.length ? 'danger' : 'success'} icon={draft.bad.length ? 'error' : 'tick-circle'}>
        {draft.bad.length
          ? `숫자 대조 실패: ${draft.bad.join(', ')}. 사용 금지.`
          : `숫자 대조 통과 · 초안 금액 ${draft.count}개 모두 계산 결과와 일치`}
      </Callout>
      {copyError && <Callout className="report-callout" intent="danger" icon="error" role="alert">{copyError}</Callout>}
      <span className="report-copy-status" role="status">{copied ? `${copied === 'mail' ? '메일' : '보고서'} 초안 복사됨` : ''}</span>

      <div className="report-columns">
        <Panel code="DRAFT-MAIL" title="메일 초안" data-tour="report-mail" className="report-mail" actions={
          <Button icon={copied === 'mail' ? 'tick' : 'duplicate'} size="small" onClick={() => copy('mail', draft.mail)}>{copied === 'mail' ? '복사됨' : '복사'}</Button>
        }>
          <pre className="report-document report-mail-text">{draft.mail}</pre>
          <p className="report-foot tiny muted">발송 기능 없음 · 복사 후 직접 발송</p>
        </Panel>

        <Panel code="DRAFT-REPORT" title="보고서 초안" className="report-draft" actions={
          <div className="report-tools">
            <SegmentedControl
              size="small" intent="primary" aria-label="보고서 보기 방식" value={reportView}
              options={[{ value: 'view', label: '문서 보기' }, { value: 'raw', label: '마크다운 원문' }]}
              onValueChange={setReportView}
            />
            <Button icon={copied === 'report' ? 'tick' : 'duplicate'} size="small" aria-label="보고서 복사" onClick={() => copy('report', draft.report)}>{copied === 'report' ? '복사됨' : '복사'}</Button>
            <Button icon="download" size="small" onClick={download}>내려받기 (.md)</Button>
          </div>
        }>
          {reportView === 'view'
            ? <article className="report-markdown" dangerouslySetInnerHTML={{ __html: draft.html }} />
            : <pre className="report-document report-raw">{draft.report}</pre>}
        </Panel>
      </div>
    </Screen>
  )
}
