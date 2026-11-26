// 확정 통보 메일
//  - 11-25 개편: 왼쪽 받는 곳 목록은 부서 종류마다 접고 펴는 드롭다운, 가운데 템플릿 편집, 오른쪽 미리보기.
//  - 템플릿의 태그는 편집기에서 이름표(칩)로만 보인다({{ }}는 내부 저장 형식).
//  - 부서마다 템플릿, 미리보기, 첨부가 다르다. 보고서는 체선료 지불 부서에만 붙는다.
//  - 값은 확정 스냅숏에서 읽는다. 시연판은 실제로 발송하지 않고 메일함의 「보낸메일함」에 저장한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Callout, HTMLSelect, Icon } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { activePlan, logActivity, sendMail, useWorkspace, ws } from '../lib/workspace.js'
import { DEPTS, TAGS, TEMPLATES, attachmentsFor, groupsFor, makeFill } from '../lib/mailGroups.js'
import MailBody, { plainBody } from './MailBody.jsx'
import { Screen } from '../ui/kit.jsx'
import AttachmentDialog, { AttachmentButtons } from './MailAttachment.jsx'
import './report.css'

const defaultDraft = (g) => ({ tpl: g.tpl, subject: TEMPLATES[g.tpl].subject, body: TEMPLATES[g.tpl].body })
const TAG_HINT = Object.fromEntries(TAGS)

// ── 태그 칩 편집기 ───────────────────────────────────────────────
// 저장 형식은 글자 + {{태그}}. 편집기 안에서는 태그를 고칠 수 없는 칩(span)으로 그린다.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const chip = (t) => `<span class="tg" contenteditable="false" data-tag="${esc(t)}" title="${esc(TAG_HINT[t] ?? '')}">${esc(t)}</span>`
const toHtml = (text) => text.split(/(\{\{.+?\}\})/g).map((part) => {
  const m = part.match(/^\{\{(.+?)\}\}$/)
  return m ? chip(m[1]) : esc(part).replace(/\n/g, '<br>')
}).join('')
function toText(node) {
  let s = ''
  node.childNodes.forEach((n) => {
    if (n.nodeType === 3) s += n.nodeValue.replace(/​/g, '')
    else if (n.nodeName === 'BR') s += '\n'
    else if (n.dataset?.tag) s += `{{${n.dataset.tag}}}`
    else if (n.nodeName === 'DIV' || n.nodeName === 'P') s += (s && !s.endsWith('\n') ? '\n' : '') + toText(n)
    else s += toText(n)
  })
  return s
}

/** 태그 칩 편집기. resetKey가 바뀔 때만 value로 다시 그린다(입력 중 커서가 튀지 않게). */
function TagEditor({ value, onChange, resetKey, single = false, disabled, apiRef, label }) {
  const el = useRef(null)
  useEffect(() => { if (el.current) el.current.innerHTML = toHtml(value) }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const emit = () => { const t = toText(el.current); onChange(single ? t.replace(/\n/g, '') : t) }
  if (apiRef) apiRef.current = {
    insert: (tag) => {
      const node = el.current
      if (!node) return
      const sel = window.getSelection()
      if (!sel.rangeCount || !node.contains(sel.anchorNode)) { node.focus(); const r = document.createRange(); r.selectNodeContents(node); r.collapse(false); sel.removeAllRanges(); sel.addRange(r) }
      document.execCommand('insertHTML', false, chip(tag) + '​')
      emit()
    },
  }
  return (
    <div ref={el} className={`tge ${single ? 'single' : ''}`} contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-label={label} aria-multiline={!single}
      onInput={emit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!single) { document.execCommand('insertLineBreak'); emit() } } }}
      onPaste={(e) => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); emit() }} />
  )
}

export default function Mail() {
  const { go, isScheduler } = useApp()
  useWorkspace()
  const plan = activePlan()
  const [groupId, setGroupId] = useState(null)
  const [open, setOpen] = useState({ DOCK: true }) // 부서 종류별 목록 펼침 (처음엔 부두 하역팀만)
  const [drafts, setDrafts] = useState({})
  const [resetNo, setResetNo] = useState(0)
  const [copied, setCopied] = useState(false)
  const [viewing, setViewing] = useState(null) // 열어 본 첨부
  const [asking, setAsking] = useState(null) // 보내기 전 확인 창에 띄운 받는 곳 목록
  const [justSent, setJustSent] = useState(null) // 방금 보낸 받는 곳 id (단추에 잠깐 「보냄」)
  const [done, setDone] = useState(null) // 보낸 뒤 완료 창에 띄울 받는 곳 목록
  const bodyApi = useRef(null)
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
  const editorKey = `${group.id}:${draft.tpl}:${resetNo}`

  const chooseTpl = (id) => { setDraft({ tpl: id, subject: TEMPLATES[id].subject, body: TEMPLATES[id].body }); setResetNo((n) => n + 1) }
  const resetDraft = () => { setDrafts((d) => { const n = { ...d }; delete n[group.id]; return n }); setResetNo((n) => n + 1) }
  const send = (g) => { const o = outOf(g); sendMail({ kind: 'notice', planNo: plan.no, groupId: g.id, toName: g.name, to: g.to, subject: o.subject, body: o.body, attachments: o.attachments.map(({ kind, name }) => ({ kind, name })) }) }
  // 11-25 보내기 전에 꼭 묻는다: 예를 눌러야 보낸다
  const confirmSend = () => {
    for (const g of asking) send(g)
    setJustSent(asking.length === 1 ? asking[0].id : 'all'); setTimeout(() => setJustSent(null), 2000)
    setDone(asking)
    setAsking(null)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(`제목: ${out.subject}\n\n${plainBody(out.body, plan)}`); setCopied(true); logActivity('메일', '메일 복사', out.subject); setTimeout(() => setCopied(false), 1500) } catch { /* 복사 실패는 화면에서 직접 선택 */ }
  }
  const usedTags = new Set([...`${draft.subject}${draft.body}`.matchAll(/\{\{(.+?)\}\}/g)].map((m) => m[1]))
  const sent = sentOf(group)

  return (
    <Screen tab="mail" title="확정 통보 메일" step={3} bodyClass="rpt-page ml-page">
      <div className="ml-grid3">
        {/* 받는 곳: 왼쪽 목록, 부서 종류마다 접고 펴는 드롭다운 */}
        <aside className="ml-card ml-side">
          <header className="ml-card-head">
            <h3>받는 곳</h3>
          </header>
          <div className="ml-side-body">
            {DEPTS.map((d) => {
              const list = groups.filter((g) => g.dept === d.id)
              if (!list.length) return null
              const isOpen = Boolean(open[d.id])
              return (
                <section key={d.id} className={`ml-dd ${isOpen ? 'open' : ''}`}>
                  <button type="button" className="ml-dd-head" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [d.id]: !isOpen }))}>
                    <Icon icon={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                    <b>{d.label}</b>
                  </button>
                  {isOpen && (
                    <ul className="ml-dd-list">
                      {list.map((g) => (
                        <li key={g.id}>
                          <button type="button" className={g.id === group.id ? 'on' : ''} onClick={() => setGroupId(g.id)}>
                            <span className="ml-dd-name">{g.side ?? g.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
          <footer className="ml-side-foot">
            <Button fill icon="send-to" disabled={!isScheduler || sentCount === groups.length} onClick={() => setAsking(groups.filter((g) => !sentOf(g)))}>{justSent === 'all' ? '모두 보냈습니다' : '안 보낸 곳 모두 보내기'}</Button>
          </footer>
        </aside>

        {/* 템플릿 */}
        <section className="ml-card">
          <header className="ml-card-head">
            <h3>템플릿</h3>
            <HTMLSelect value={draft.tpl} disabled={!isScheduler} onChange={(e) => chooseTpl(e.target.value)} options={Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }))} aria-label="템플릿 불러오기" />
            {drafts[group.id] && <Button variant="minimal" icon="reset" onClick={resetDraft}>기본으로</Button>}
          </header>
          <div className="ml-card-body">
            <div className="ml-field">
              <span className="ml-label">제목</span>
              <TagEditor single value={draft.subject} resetKey={editorKey} disabled={!isScheduler} onChange={(v) => setDraft({ subject: v })} label="메일 제목" />
            </div>
            <div className="ml-tags">
              <span className="ml-label">넣을 내용</span>
              {TAGS.map(([t, hint]) => (
                <button type="button" key={t} title={hint} className={usedTags.has(t) ? 'used' : ''} disabled={!isScheduler}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => bodyApi.current?.insert(t)}>{t}</button>
              ))}
            </div>
            <TagEditor value={draft.body} resetKey={editorKey} disabled={!isScheduler} onChange={(v) => setDraft({ body: v })} apiRef={bodyApi} label="메일 본문" />
          </div>
        </section>

        {/* 미리보기: 실제 메일처럼 흰 종이 */}
        <section className="ml-card" data-tour="mail-compose">
          <header className="ml-card-head">
            <h3>미리보기</h3>
            <div className="ml-card-actions">
              <Button icon={copied ? 'tick' : 'duplicate'} onClick={copy}>{copied ? '복사됨' : '복사'}</Button>
              <Button intent="primary" icon={justSent === group.id ? 'tick' : 'send-message'} disabled={!isScheduler} onClick={() => setAsking([group])}>{justSent === group.id ? '보냈습니다' : sent ? '다시 보내기' : '보내기'}</Button>
            </div>
          </header>
          <div className="ml-card-body ml-paper-wrap">
            <article className="ml-paper">
              <dl className="ml-head">
                <dt>받는 사람</dt><dd>{group.name} &lt;{group.to}&gt;</dd>
                <dt>제목</dt><dd className="strong">{out.subject}</dd>
                {out.attachments.length > 0 && <>
                  <dt>첨부</dt>
                  <dd className="ml-files">
                    <AttachmentButtons files={out.attachments} onOpen={setViewing} />
                  </dd>
                </>}
              </dl>
              <MailBody text={out.body} plan={plan} />
            </article>
          </div>
        </section>
      </div>

      <AttachmentDialog file={viewing} plan={plan} onClose={() => setViewing(null)} />
      <Alert isOpen={!!asking} icon="send-message" intent="primary" className="ml-confirm"
        confirmButtonText="예" cancelButtonText="아니오" onConfirm={confirmSend} onCancel={() => setAsking(null)} canEscapeKeyCancel>
        {asking && (asking.length === 1
          ? <p><b>{asking[0].name}</b>님께 진짜 보내시겠습니까?</p>
          : <><p>아래 {asking.length}곳 담당자님들께 진짜 보내시겠습니까?</p><ul className="ml-confirm-list">{asking.map((g) => <li key={g.id}>{g.name}</li>)}</ul></>)}
      </Alert>
      <Alert isOpen={!!done} icon="tick-circle" intent="success" className="ml-confirm ml-done"
        confirmButtonText="확인" onConfirm={() => setDone(null)} onClose={() => setDone(null)} canEscapeKeyCancel canOutsideClickCancel>
        {done && (done.length === 1
          ? <p>전송을 완료했습니다.<br /><b>{done[0].name}</b></p>
          : <><p>전송을 완료했습니다. ({done.length}곳)</p><ul className="ml-confirm-list">{done.map((g) => <li key={g.id}>{g.name}</li>)}</ul></>)}
      </Alert>
    </Screen>
  )
}
