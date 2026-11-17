// 메일 작성: 보고서와 같은 후보·판단근거로 만든 초안을 고쳐 쓰고 복사하거나 메일 앱으로 넘긴다. 이 화면은 발송하지 않는다.
import { useEffect, useRef, useState } from 'react'
import { AnchorButton, Button, Callout, FormGroup, InputGroup, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { downloadMarkdown, reportFileName, useReport } from '../state/useReport.js'
import { money } from '../lib/time.js'
import { Panel, Screen, St } from '../ui/kit.jsx'
import './report.css'

export default function Mail() {
  const { go, isScheduler, reportDraft, setReportDraft } = useApp()
  const { model, md, mail, check, shownPlan } = useReport()
  const edits = reportDraft.mail
  // 고친 칸만 저장하고, 손대지 않은 칸은 보고서가 바뀌면 자동 초안을 따라간다.
  const to = edits.to ?? ''
  const cc = edits.cc ?? ''
  const subject = edits.subject ?? mail.subject
  const body = edits.body ?? mail.body
  const edited = edits.subject !== undefined || edits.body !== undefined
  const stale = edited && (subject !== mail.subject || body !== mail.body)
  const setField = (k, v) => setReportDraft({ mail: { ...edits, [k]: v } })
  const regenerate = () => setReportDraft({ mail: { to: edits.to, cc: edits.cc } })

  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const timer = useRef(null)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  async function copy() {
    setCopyError('')
    try {
      await navigator.clipboard.writeText(`제목: ${subject}\n\n${body}`)
      window.clearTimeout(timer.current)
      setCopied(true)
      timer.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
      setCopyError('클립보드에 복사하지 못했습니다. 본문을 선택해 직접 복사해 주십시오.')
    }
  }
  const mailto = `mailto:${encodeURIComponent(to)}?${new URLSearchParams({ ...(cc ? { cc } : {}), subject, body }).toString().replace(/\+/g, '%20')}`
  const sel = model.sel

  return (
    <Screen tab="mail" title="메일 작성" step={5} bodyClass="rpt-page" actions={
      <Button icon="arrow-left" text="보고서로" onClick={() => go('report')} />
    }>
      <p className="muted small">보고서와 같은 후보·판단근거로 메일 초안을 만듭니다. 고쳐 쓴 뒤 복사하거나 메일 앱으로 넘기며, 이 화면에서 발송하지는 않습니다.</p>
      {copyError && <Callout intent="danger" icon="error" role="alert">{copyError}</Callout>}
      <span className="rpt-sr" role="status">{copied ? '메일 복사됨' : ''}</span>

      <div className="mail-grid">
        <Panel code="MAIL-BASE" title="기준 보고서" desc="보고서 화면에서 고른 안" pad>
          <dl className="rpt-kv mail-kv">
            <dt>선택 후보</dt><dd className="strong">{sel.label}</dd>
            <dt>총 체선료</dt><dd className="num">{money(sel.total)}</dd>
            <dt>기준안 대비</dt><dd className="num c-green">{money(-sel.saving)} ({sel.savingPct}%)</dd>
            <dt>상태</dt><dd>{shownPlan ? <St tone="ok">{shownPlan.status}</St> : <St tone="warn">확정 전</St>}</dd>
            <dt>숫자 대조</dt><dd>{check.bad.length ? <St tone="bad">실패</St> : <St tone="ok">통과</St>}</dd>
          </dl>
          <p className="rpt-sub tiny">숙련자 판단근거</p>
          {model.judgment
            ? <p className="mail-judgment small">{model.judgment}</p>
            : <Callout compact intent="warning" icon="edit" className="rpt-note">판단근거가 비어 있습니다. 보고서 화면에서 먼저 적어 주십시오.</Callout>}
          <div className="mail-base-actions">
            <Button size="small" icon="document" onClick={() => go('report')}>보고서 열기</Button>
          </div>
          <p className="rpt-sub tiny">첨부</p>
          <div className="mail-attach">
            <span className="small">{reportFileName(sel.id)}</span>
            <Button size="small" variant="minimal" icon="download" aria-label="첨부 보고서 내려받기" onClick={() => downloadMarkdown(md, sel.id)} />
          </div>
          <p className="tiny muted">메일 앱으로 넘길 때 첨부는 따라가지 않습니다. 내려받아 직접 붙여 주십시오.</p>
        </Panel>

        <Panel code="MAIL-COMPOSE" title="메일 작성" data-tour="mail-compose" className="mail-compose" actions={
          <div className="rpt-tools">
            <Button size="small" icon="refresh" disabled={!edited} onClick={regenerate}>초안 다시 만들기</Button>
            <Button size="small" icon={copied ? 'tick' : 'duplicate'} onClick={copy}>{copied ? '복사됨' : '복사'}</Button>
            <AnchorButton size="small" intent="primary" icon="send-message" href={mailto}>메일 앱에서 열기</AnchorButton>
          </div>
        } pad>
          {stale && (
            <Callout compact intent="primary" icon="info-sign" className="rpt-note">
              고쳐 쓴 내용을 유지하고 있습니다. 보고서의 후보나 판단근거를 바꿨다면 「초안 다시 만들기」로 새 초안을 받으십시오.
            </Callout>
          )}
          <div className="mail-fields">
            <FormGroup label="받는 사람" labelFor="mail-to" inline>
              <InputGroup id="mail-to" value={to} disabled={!isScheduler} placeholder="메일 주소, 여러 명은 쉼표로" onChange={(e) => setField('to', e.target.value)} />
            </FormGroup>
            <FormGroup label="참조" labelFor="mail-cc" inline>
              <InputGroup id="mail-cc" value={cc} disabled={!isScheduler} placeholder="선택" onChange={(e) => setField('cc', e.target.value)} />
            </FormGroup>
            <FormGroup label="제목" labelFor="mail-subject" inline>
              <InputGroup id="mail-subject" value={subject} disabled={!isScheduler} onChange={(e) => setField('subject', e.target.value)} />
            </FormGroup>
          </div>
          <TextArea className="mail-body" fill value={body} disabled={!isScheduler} aria-label="메일 본문" onChange={(e) => setField('body', e.target.value)} />
          <p className="tiny muted mail-foot">발송 기능 없음 · 복사하거나 메일 앱에서 열어 직접 발송</p>
        </Panel>
      </div>
    </Screen>
  )
}
