// 메일함 (11-24 최최종: 알림함 → 메일함)
//  - 받은메일함: 강풍 관측, 입력 변경, 조건 변경 요청, 확정 알림이 메일로 들어온다. 스케줄러는 읽고 업무에 참고한다.
//  - 11-26 분류 탭, 반영 칸, 다른 화면으로 가는 버튼을 뺐다 — 메일만 보인다. 조건 변경 요청은 「후보 비교·확정」에서 결정한다.
//  - 보낸메일함: 확정 통보 메일을 보낼 때마다 여기에 남는다. 메일 쓰기도 있지만 거의 쓰지 않는다.
import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogBody, DialogFooter, HTMLSelect, Icon, InputGroup, NonIdealState, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { useInbox } from '../state/useInbox.js'
import { CHANNELS } from '../lib/inbox.js'
import { GROUPS } from '../lib/mailGroups.js'
import { markRead, sendMail, useWorkspace, ws } from '../lib/workspace.js'
import { Panel, Screen, St } from '../ui/kit.jsx'
import MailBody from './MailBody.jsx'
import AttachmentDialog, { AttachmentButtons } from './MailAttachment.jsx'
import './report.css'
import './inbox.css'

const ME = { scheduler: '스케줄러 A <scheduler@example.com>', user: '이용자 B <sk3-ops@example.com>' }

function Compose({ open, onClose, onSent }) {
  const [to, setTo] = useState(GROUPS[0].id)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [asking, setAsking] = useState(false) // 보내기 전 확인 창
  const g = GROUPS.find((x) => x.id === to)
  const send = () => { sendMail({ kind: 'manual', groupId: g.id, toName: g.name, to: g.to, subject, body, attachments: [] }); setSubject(''); setBody(''); setAsking(false); onClose(); onSent?.(g.name) }
  return (
    <Dialog isOpen={open} onClose={onClose} title="메일 쓰기" icon="edit" className="mb-compose">
      <DialogBody>
        <label className="ml-label">받는 사람</label>
        <HTMLSelect fill value={to} onChange={(e) => setTo(e.target.value)} options={GROUPS.map((x) => ({ value: x.id, label: `${x.name} <${x.to}>` }))} />
        <label className="ml-label mb-gap">제목</label>
        <InputGroup value={subject} onChange={(e) => setSubject(e.target.value)} />
        <label className="ml-label mb-gap">본문</label>
        <TextArea fill rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
        <p className="tiny muted mb-gap">확정 일정을 알릴 때는 「확정 통보 메일」에서 부서별 템플릿으로 보내십시오. 여기는 그 밖의 짧은 메일용입니다.</p>
      </DialogBody>
      <DialogFooter actions={<><Button onClick={onClose}>취소</Button><Button intent="primary" icon="send-message" disabled={!subject.trim()} onClick={() => setAsking(true)}>보내기</Button></>} />
      <Alert isOpen={asking} icon="send-message" intent="primary" className="ml-confirm"
        confirmButtonText="예" cancelButtonText="아니오" onConfirm={send} onCancel={() => setAsking(false)} canEscapeKeyCancel>
        <p><b>{g.name}</b>님께 진짜 보내시겠습니까?</p>
      </Alert>
    </Dialog>
  )
}

export default function Inbox() {
  const { isScheduler, role } = useApp()
  useWorkspace()
  const { alerts } = useInbox()
  const [folder, setFolder] = useState('in')
  const [selId, setSelId] = useState(null)
  const [composing, setComposing] = useState(false)
  const [viewing, setViewing] = useState(null) // 열어 본 첨부
  const [doneTo, setDoneTo] = useState(null) // 메일 쓰기로 보낸 뒤 완료 창

  // 11-26 메일함은 받은메일함 · 보낸메일함만 (분류 탭 없음). 조건 변경 요청은 「후보 비교·확정」에서 결정한다
  const unreadIn = (id) => alerts.filter((a) => a.status === 'new' && (id === 'all' || a.channel === id)).length
  const chLabel = (id) => CHANNELS.find((c) => c.id === id)?.label

  const inbox = alerts
  const sent = [...ws.sent].reverse()
  const list = folder === 'in' ? inbox : sent
  const sel = list.find((m) => String(m.id) === String(selId)) ?? list[0] ?? null

  useEffect(() => { if (folder === 'in' && sel && sel.status === 'new') markRead(sel.id) }, [folder, sel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickFolder = (f) => { setFolder(f); setSelId(null) }

  return (
    <Screen tab="inbox" title="메일함" bodyClass="inbox-page">
      <div className="mb-grid">
        <Panel code="MAILBOX" title="메일함">
          {isScheduler && <div className="mb-compose-btn"><Button fill icon="edit" onClick={() => setComposing(true)}>메일 쓰기</Button></div>}
          <ul className="inbox-channels">
            <li><button type="button" className={`inbox-channel ${folder === 'in' ? 'on' : ''}`} onClick={() => pickFolder('in')}><Icon icon="inbox" size={14} /><span>받은메일함</span>{unreadIn('all') > 0 && <span className="num inbox-count">{unreadIn('all')}</span>}</button></li>
            {isScheduler && <li><button type="button" className={`inbox-channel ${folder === 'out' ? 'on' : ''}`} onClick={() => pickFolder('out')}><Icon icon="send-message" size={14} /><span>보낸메일함</span><span className="num faint mb-total">{ws.sent.length}</span></button></li>}
          </ul>
        </Panel>

        <Panel code={folder === 'in' ? 'INBOX' : 'SENT'} title={folder === 'in' ? '받은메일함' : '보낸메일함'} desc={`${list.length}통`} data-tour="inbox-list">
          {list.length === 0 ? (
            <NonIdealState className="inbox-empty" icon={folder === 'in' ? 'inbox' : 'send-message'} title={folder === 'in' ? '받은 메일이 없습니다' : '보낸 메일이 없습니다'}
              description={folder === 'in' ? '현장 메일과 확정 알림이 오면 여기에 쌓입니다.' : '「확정 통보 메일」에서 부서별로 보내면 여기에 남습니다.'} />
          ) : (
            <ul className="mb-list">
              {folder === 'in' ? inbox.map((a) => (
                <li key={a.id}>
                  <button type="button" className={`mb-row ${sel?.id === a.id ? 'on' : ''} ${a.status === 'new' ? 'unread' : ''}`} onClick={() => setSelId(a.id)}>
                    <span className="mb-row-top"><i className={`mb-dot ${a.status === 'new' ? 'on' : ''}`} /><span className="mb-from">{a.from}</span><span className="tiny faint num">{a.at}</span></span>
                    <span className="mb-subject">{a.subject}</span>
                    <span className="mb-row-tags"><span className={`chip ${a.channel === 'incident' ? 'amber' : ''}`}>{chLabel(a.channel)}</span>
                      {a.status === 'applied' && <St tone="ok">반영</St>}{a.status === 'dismissed' && <St tone="idle">반영 안 함</St>}</span>
                  </button>
                </li>
              )) : sent.map((m) => (
                <li key={m.id}>
                  <button type="button" className={`mb-row ${sel?.id === m.id ? 'on' : ''}`} onClick={() => setSelId(m.id)}>
                    <span className="mb-row-top"><span className="mb-from">받는 사람: {m.toName}</span><span className="tiny faint num">{m.at.slice(5, 16)}</span></span>
                    <span className="mb-subject">{m.subject}</span>
                    <span className="mb-row-tags"><span className="chip">{m.kind === 'notice' ? `확정 통보 v${m.planNo}` : '직접 쓴 메일'}</span>{m.attachments.length > 0 && <span className="tiny muted"><Icon icon="paperclip" size={11} /> {m.attachments.length}</span>}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel code="READ" title="메일 보기" bodyClass="mb-read-body">
          {!sel ? <NonIdealState className="inbox-empty" icon="envelope" title="메일을 고르십시오" /> : folder === 'in' ? (
            <article className="mb-read">
              {/* 11-25 확정 통보 메일 미리보기와 같은 메일 종이로 그린다 */}
              <div className="ml-paper-wrap">
                <div className="ml-paper">
                  <dl className="ml-head">
                    <dt>보낸 사람</dt><dd>{sel.from} &lt;{sel.fromAddr}&gt;</dd>
                    <dt>받는 사람</dt><dd>{ME[role?.id] ?? '-'}</dd>
                    <dt>받은 시각</dt><dd className="num">{sel.at}</dd>
                    <dt>제목</dt><dd className="strong">{sel.subject}</dd>
                    {sel.attachments?.length > 0 && <><dt>첨부</dt><dd className="ml-files"><AttachmentButtons files={sel.attachments} onOpen={setViewing} /></dd></>}
                  </dl>
                  {(() => { const p = sel.planNo && ws.plans.find((x) => x.no === sel.planNo); return p ? <MailBody text={sel.body} plan={p} /> : <pre className="ml-preview">{sel.body}</pre> })()}
                </div>
              </div>
            </article>
          ) : (
            <article className="mb-read">
              {/* 11-25 확정 통보 메일 미리보기와 같은 메일 종이로 그린다 */}
              <div className="ml-paper-wrap">
                <div className="ml-paper">
                  <dl className="ml-head">
                    <dt>받는 사람</dt><dd>{sel.toName} &lt;{sel.to}&gt;</dd>
                    <dt>보낸 시각</dt><dd className="num">{sel.at}, {sel.who}</dd>
                    <dt>제목</dt><dd className="strong">{sel.subject}</dd>
                    {sel.attachments.length > 0 && <><dt>첨부</dt><dd className="ml-files"><AttachmentButtons files={sel.attachments} onOpen={setViewing} /></dd></>}
                  </dl>
                  {(() => { const p = sel.planNo && ws.plans.find((x) => x.no === sel.planNo); return p ? <MailBody text={sel.body} plan={p} /> : <pre className="ml-preview">{sel.body}</pre> })()}
                </div>
              </div>
            </article>
          )}
        </Panel>
      </div>
      <Compose open={composing} onClose={() => setComposing(false)} onSent={setDoneTo} />
      <Alert isOpen={!!doneTo} icon="tick-circle" intent="success" className="ml-confirm ml-done"
        confirmButtonText="확인" onConfirm={() => setDoneTo(null)} onClose={() => setDoneTo(null)} canEscapeKeyCancel canOutsideClickCancel>
        <p>전송을 완료했습니다.<br /><b>{doneTo}</b></p>
      </Alert>
      <AttachmentDialog file={viewing} plan={sel?.planNo ? ws.plans.find((x) => x.no === sel.planNo) : null} onClose={() => setViewing(null)} />
    </Screen>
  )
}
