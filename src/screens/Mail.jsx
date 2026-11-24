// 확정 통보 메일 (11-24 실데이터)
//  - 받는 곳: 확정안에 배정이 있는 부두마다 하역팀, 입출항 작업지시자, 생산팀, 체선료 지불 부서(lib/mailGroups.js).
//  - 부서마다 템플릿, 미리보기, 첨부가 다르다. 보고서는 체선료 지불 부서에만 붙는다.
//  - 값은 확정 스냅숏에서 읽는다. 시연판은 실제로 발송하지 않고 메일함의 「보낸메일함」에 저장한다.
import { useMemo, useRef, useState } from 'react'
import { Button, Callout, Dialog, DialogBody, HTMLSelect, Icon, InputGroup, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { useReport } from '../state/useReport.js'
import { activePlan, logActivity, sendMail, useWorkspace, ws } from '../lib/workspace.js'
import { DEPTS, TAGS, TEMPLATES, attachmentsFor, groupsFor, makeFill, scheduleSheets } from '../lib/mailGroups.js'
import { buildXlsx } from '../lib/xlsx.js'
import MailBody, { plainBody } from './MailBody.jsx'
import { Panel, Screen, St } from '../ui/kit.jsx'
import { ReportDoc } from './Report.jsx'
import './report.css'

const defaultDraft = (g) => ({ tpl: g.tpl, subject: TEMPLATES[g.tpl].subject, body: TEMPLATES[g.tpl].body })

// 전체확정일정.xlsx 미리보기: 엑셀처럼 시트 탭 + 표. 「내려받기」는 실제 .xlsx 파일을 만든다.
function XlsxSheet({ file, plan }) {
  const sheets = useMemo(() => scheduleSheets(plan), [plan])
  const [i, setI] = useState(0)
  const s = sheets[Math.min(i, sheets.length - 1)]
  const download = () => {
    const url = URL.createObjectURL(buildXlsx(sheets))
    const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    logActivity('메일', '첨부 내려받기', file.name)
  }
  return (
    <div className="ml-xlsx">
      <div className="ml-xlsx-bar"><span className="tiny muted">전 부두 상세 일정, 시트 {sheets.length}장 (전체, 부두별, 안내)</span><Button size="small" icon="download" onClick={download}>내려받기 (.xlsx)</Button></div>
      <div className="ml-xlsx-grid">
        <table className="dt ml-sheet">
          <thead><tr><th className="c faint"></th>{s.rows[0].map((h, c) => <th key={c}>{h}</th>)}</tr></thead>
          <tbody>{s.rows.slice(1).map((r, ri) => <tr key={ri}><td className="c num faint">{ri + 2}</td>{r.map((v, c) => <td key={c} className={typeof v === 'number' ? 'num r' : ''}>{typeof v === 'number' ? v.toLocaleString() : v}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="ml-xlsx-tabs">{sheets.map((x, k) => <button type="button" key={x.name} className={k === i ? 'on' : ''} onClick={() => setI(k)}>{x.name}</button>)}</div>
    </div>
  )
}

export default function Mail() {
  const { go, isScheduler } = useApp()
  useWorkspace()
  const plan = activePlan()
  const { model } = useReport()
  const [groupId, setGroupId] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [copied, setCopied] = useState(false)
  const [viewing, setViewing] = useState(null) // 열어 본 첨부
  const bodyRef = useRef(null)
  const groups = useMemo(() => (plan ? groupsFor(plan) : []), [plan])
  const fill = useMemo(() => (plan ? makeFill({ plan }) : () => ''), [plan])

  if (!plan) {
    return (
      <Screen tab="mail" title="확정 통보 메일" step={3} bodyClass="rpt-page">
        <Callout intent="primary" icon="lock" title="확정한 뒤에 씁니다">
          통보 메일은 확정된 일정만 보냅니다. 「후보 비교·확정」에서 안을 확정하면 이 화면이 열립니다.
          <div style={{ marginTop: 10 }}><Button intent="primary" icon="comparison" onClick={() => go('compare')}>후보 비교·확정으로</Button></div>
        </Callout>
      </Screen>
    )
  }

  const group = groups.find((g) => g.id === groupId) ?? groups[0]
  const draft = drafts[group.id] ?? defaultDraft(group)
  const setDraft = (patch) => setDrafts((d) => ({ ...d, [group.id]: { ...(d[group.id] ?? defaultDraft(group)), ...patch } }))
  const outOf = (g) => { const d = drafts[g.id] ?? defaultDraft(g); return { subject: fill(d.subject, g), body: fill(d.body, g), attachments: attachmentsFor(g, plan) } }
  const out = outOf(group)
  const sentOf = (g) => ws.sent.filter((s) => s.kind === 'notice' && s.planNo === plan.no && s.groupId === g.id).at(-1)
  const sentCount = groups.filter((g) => sentOf(g)).length
  const countOf = (g) => (g.pier ? plan.placements.filter((p) => p.pier === g.pier).length : plan.placements.length)

  const insert = (tag) => {
    const el = bodyRef.current
    const token = `{{${tag}}}`
    if (!el) { setDraft({ body: draft.body + token }); return }
    const { selectionStart: a, selectionEnd: b } = el
    setDraft({ body: draft.body.slice(0, a) + token + draft.body.slice(b) })
  }
  const chooseTpl = (id) => setDraft({ tpl: id, subject: TEMPLATES[id].subject, body: TEMPLATES[id].body })
  const send = (g) => { const o = outOf(g); sendMail({ kind: 'notice', planNo: plan.no, groupId: g.id, toName: g.name, to: g.to, subject: o.subject, body: o.body, attachments: o.attachments.map(({ kind, name }) => ({ kind, name })) }) }
  const sendAll = () => { for (const g of groups) if (!sentOf(g)) send(g) }
  const copy = async () => {
    try { await navigator.clipboard.writeText(`제목: ${out.subject}\n\n${plainBody(out.body, plan)}`); setCopied(true); logActivity('메일', '메일 복사', out.subject); setTimeout(() => setCopied(false), 1500) } catch { /* 복사 실패는 화면에서 직접 선택 */ }
  }
  const usedTags = new Set([...`${draft.subject}${draft.body}`.matchAll(/\{\{(.+?)\}\}/g)].map((m) => m[1]))

  return (
    <Screen tab="mail" title="확정 통보 메일" step={3} bodyClass="rpt-page" actions={<St tone="ok">접안 계획 v{plan.no}, {plan.label} 확정</St>}>
      <p className="muted small">부서마다 필요한 내용만 보냅니다. 부두 하역팀은 확정안에 배정이 있는 부두마다 한 곳이고, 보고서는 체선료 지불 부서에만 붙습니다. 연락처는 시연용 가상 값이며, 실제로 발송하지 않고 메일함의 「보낸메일함」에 저장합니다.</p>
      <div className="ml-grid">
        <Panel code="MAIL-TO" title="받는 부서" desc={`${sentCount}/${groups.length}곳`} actions={
          <Button size="small" icon="send-to" disabled={!isScheduler || sentCount === groups.length} onClick={sendAll} title="아직 안 보낸 부서에 각 부서 템플릿으로 보냅니다">모두 보내기</Button>
        } pad>
          {DEPTS.map((d) => (
            <div key={d.id} className="ml-dept">
              <p className="ml-dept-head tiny">{d.label}</p>
              <ul className="ml-groups">
                {groups.filter((g) => g.dept === d.id).map((g) => {
                  const s = sentOf(g)
                  const files = attachmentsFor(g, plan)
                  return (
                    <li key={g.id}>
                      <button type="button" className={g.id === group.id ? 'on' : ''} onClick={() => setGroupId(g.id)}>
                        <span className="ml-group-top"><b>{g.name}</b>{s ? <St tone="ok">보냄 {s.at.slice(11, 16)}</St> : <St tone="idle">보내기 전</St>}</span>
                        <span className="tiny muted">{g.to} (가상){g.dept === 'DOCK' ? `, ${countOf(g)}척` : ''}</span>
                        <span className="tiny ml-attach-hint"><Icon icon="paperclip" size={11} />{files.length ? files.map((f) => (f.kind === 'report' ? '보고서' : '전체확정일정.xlsx')).join(', ') : '첨부 없음 (본문만)'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </Panel>

        <Panel code="MAIL-TPL" title={`템플릿, ${DEPTS.find((d) => d.id === group.dept).label}`} actions={<label className="ml-load"><span className="tiny muted">템플릿 불러오기</span><HTMLSelect size="small" value={draft.tpl} disabled={!isScheduler} onChange={(e) => chooseTpl(e.target.value)} options={Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }))} /></label>} pad>
          <label className="ml-label">제목</label>
          <InputGroup value={draft.subject} disabled={!isScheduler} onChange={(e) => setDraft({ subject: e.target.value })} />
          <div className="ml-tags">
            <span className="tiny muted">태그 넣기</span>
            {TAGS.map(([t, hint]) => <button type="button" key={t} title={hint} className={usedTags.has(t) ? 'used' : ''} disabled={!isScheduler} onClick={() => insert(t)}>{`{{${t}}}`}</button>)}
          </div>
          <TextArea inputRef={bodyRef} className="ml-body" fill value={draft.body} disabled={!isScheduler} onChange={(e) => setDraft({ body: e.target.value })} aria-label="메일 템플릿 본문" />
          {drafts[group.id] && <Button size="small" variant="minimal" icon="reset" onClick={() => setDrafts((d) => { const n = { ...d }; delete n[group.id]; return n })}>이 부서 기본 템플릿으로</Button>}
        </Panel>

        <Panel code="MAIL-PREVIEW" data-tour="mail-compose" title="미리보기" actions={
          <div className="rpt-tools">
            <Button size="small" icon={copied ? 'tick' : 'duplicate'} onClick={copy}>{copied ? '복사됨' : '복사'}</Button>
            <Button size="small" intent="primary" icon="send-message" disabled={!isScheduler} onClick={() => send(group)}>{sentOf(group) ? '다시 보내기' : '이 부서에 보내기'}</Button>
          </div>
        } pad>
          <dl className="ml-head small">
            <dt>받는 사람</dt><dd>{group.name} &lt;{group.to}&gt; <span className="muted">(가상)</span></dd>
            <dt>제목</dt><dd className="strong">{out.subject}</dd>
            <dt>첨부</dt>
            <dd className="ml-files">
              {out.attachments.length ? out.attachments.map((f) => (
                <button type="button" key={f.name} className="ml-file" onClick={() => setViewing(f)} title="첨부 열어 보기">
                  <Icon icon={f.kind === 'report' ? 'document' : 'th'} size={12} />{f.name}
                </button>
              )) : <span className="muted">없음. 이 부서는 본문만 받습니다.</span>}
            </dd>
          </dl>
          <MailBody text={out.body} plan={plan} />
        </Panel>
      </div>

      <Dialog isOpen={!!viewing} onClose={() => setViewing(null)} title={viewing?.name} icon={viewing?.kind === 'report' ? 'document' : 'th'} className="ml-dialog wide">
        <DialogBody>
          {viewing?.kind === 'xlsx' && <XlsxSheet file={viewing} plan={plan} />}
          {viewing?.kind === 'report' && (model ? <ReportDoc m={model} /> : <p className="small muted">후보 계산 결과가 없어 보고서를 만들 수 없습니다.</p>)}
        </DialogBody>
      </Dialog>
    </Screen>
  )
}
