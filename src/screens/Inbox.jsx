// 메일함 (11-24 최최종: 알림함 → 메일함)
//  - 받은메일함: 기상 특보, 입력 변경, 돌발 상황, 확정 알림이 메일로 들어온다. 스케줄러는 읽고 업무에 참고한다.
//  - 돌발 상황은 지금 있을 때만 분류에 보이고, 메일을 열어 「반영」 또는 「반영 안 함」으로 정한다.
//  - 보낸메일함: 확정 통보 메일을 보낼 때마다 여기에 남는다. 메일 쓰기도 있지만 거의 쓰지 않는다.
import { useEffect, useState } from 'react'
import { Alert, Button, Dialog, DialogBody, DialogFooter, HTMLSelect, Icon, InputGroup, NonIdealState, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { useInbox } from '../state/useInbox.js'
import { CHANNELS } from '../lib/inbox.js'
import { GROUPS } from '../lib/mailGroups.js'
import { markRead, sendMail, setAlertStatus, useWorkspace, ws } from '../lib/workspace.js'
import { Panel, Screen, St } from '../ui/kit.jsx'
import MailBody from './MailBody.jsx'
import AttachmentDialog, { AttachmentButtons } from './MailAttachment.jsx'
import './report.css'
import './inbox.css'

const ME = { scheduler: '스케줄러 A <scheduler@example.com>', user: '이용자 B <sk3-ops@example.com>' }
const goLabel = (a) => (a.action.tab === 'input' ? '계획 조건에서 보기' : a.action.tab === 'compare' ? '후보 비교·확정에서 보기' : a.action.tab === 'ops' ? '확정 일정 보기' : '선박 카드 열기')

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
  const { isScheduler, role, scen, mailFilter, setMailFilter, go, applyIncident } = useApp()
  useWorkspace()
  const { alerts, open, incidents } = useInbox()
  const [folder, setFolder] = useState('in')
  const [selId, setSelId] = useState(null)
  const [composing, setComposing] = useState(false)
  const [viewing, setViewing] = useState(null) // 열어 본 첨부
  const [doneTo, setDoneTo] = useState(null) // 메일 쓰기로 보낸 뒤 완료 창

  // 돌발 상황이 하나도 없으면 분류에서 뺀다. 그 분류를 보고 있었다면 전체로 돌린다.
  const channels = (isScheduler ? CHANNELS : CHANNELS.filter((c) => c.id === 'all' || c.id === 'plan'))
    .filter((c) => c.id !== 'incident' || incidents.length > 0)
  const channel = channels.some((c) => c.id === mailFilter) ? mailFilter : 'all'
  const unreadIn = (id) => alerts.filter((a) => a.status === 'new' && (id === 'all' || a.channel === id)).length
  const chLabel = (id) => CHANNELS.find((c) => c.id === id)?.label

  const inbox = alerts.filter((a) => channel === 'all' || a.channel === channel)
  const sent = [...ws.sent].reverse()
  const list = folder === 'in' ? inbox : sent
  const sel = list.find((m) => String(m.id) === String(selId)) ?? list[0] ?? null
  const applied = alerts.filter((a) => a.channel === 'incident' && a.status === 'applied')
  // 돌발 상황 메일을 「반영」하면 이 구간이 계획 조건의 부두 사용 불가(blocks)로 들어간다.
  const incBlock = sel?.incId ? scen?.incidents.find((i) => i.id === sel.incId)?.block : null

  useEffect(() => { if (folder === 'in' && sel && sel.status === 'new') markRead(sel.id) }, [folder, sel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickFolder = (f) => { setFolder(f); setSelId(null) }
  const pickChannel = (id) => { setFolder('in'); setMailFilter(id); setSelId(null) }

  return (
    <Screen tab="inbox" title="메일함" bodyClass="inbox-page">
      {isScheduler && incidents.length > 0 && (
        <button type="button" className="mb-strip warn" onClick={() => pickChannel('incident')}>
          <Icon icon="warning-sign" size={14} /><b>돌발 상황 {incidents.length}건</b><span>반영할지 아직 정하지 않았습니다. 눌러서 보기</span>
        </button>
      )}
      {isScheduler && applied.length > 0 && (
        <div className="mb-strip ok">
          <Icon icon="tick-circle" size={14} /><b>돌발 상황 {applied.length}건이 계획 조건에 반영됨</b><span>부두 사용 불가 구간으로 들어갔습니다. 계획 조건에서 「다시 계산」을 눌러야 후보에 반영됩니다.</span>
          <Button size="small" intent="primary" icon="properties" onClick={() => go('input')}>계획 조건에서 확인, 수정</Button>
        </div>
      )}
      <div className="mb-grid">
        <Panel code="MAILBOX" title="메일함">
          {isScheduler && <div className="mb-compose-btn"><Button fill icon="edit" onClick={() => setComposing(true)}>메일 쓰기</Button></div>}
          <ul className="inbox-channels">
            <li><button type="button" className={`inbox-channel ${folder === 'in' ? 'on' : ''}`} onClick={() => pickFolder('in')}><Icon icon="inbox" size={14} /><span>받은메일함</span>{unreadIn('all') > 0 && <span className="num inbox-count">{unreadIn('all')}</span>}</button></li>
            {folder === 'in' && channels.filter((c) => c.id !== 'all').map((c) => (
              <li key={c.id}>
                <button type="button" className={`inbox-channel sub ${channel === c.id ? 'on' : ''} ${c.id === 'incident' ? 'hot' : ''}`} onClick={() => pickChannel(channel === c.id ? 'all' : c.id)}>
                  <Icon icon={c.icon} size={12} /><span>{c.label}</span>
                  {c.id === 'incident' ? <span className="num inbox-count hot">{incidents.length}</span> : unreadIn(c.id) > 0 && <span className="num inbox-count">{unreadIn(c.id)}</span>}
                </button>
              </li>
            ))}
            {isScheduler && <li><button type="button" className={`inbox-channel ${folder === 'out' ? 'on' : ''}`} onClick={() => pickFolder('out')}><Icon icon="send-message" size={14} /><span>보낸메일함</span><span className="num faint mb-total">{ws.sent.length}</span></button></li>}
          </ul>
        </Panel>

        <Panel code={folder === 'in' ? 'INBOX' : 'SENT'} title={folder === 'in' ? (channel === 'all' ? '받은메일함' : `받은메일함 · ${chLabel(channel)}`) : '보낸메일함'} desc={`${list.length}통`} data-tour="inbox-list">
          {list.length === 0 ? (
            <NonIdealState className="inbox-empty" icon={folder === 'in' ? 'inbox' : 'send-message'} title={folder === 'in' ? '받은 메일이 없습니다' : '보낸 메일이 없습니다'}
              description={folder === 'in' ? '강풍 관측, 입력 변경, 현장 메일이 오면 여기에 쌓입니다.' : '「확정 통보 메일」에서 부서별로 보내면 여기에 남습니다.'} />
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

        <Panel code="READ" title="메일 보기">
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
              {sel.channel === 'incident' && isScheduler ? (
                <div className={`mb-decide ${sel.status === 'applied' ? 'ok' : sel.status === 'dismissed' ? 'idle' : ''}`}>
                  {sel.status === 'applied' || sel.status === 'dismissed' ? (
                    <>
                      <span>{sel.status === 'applied' ? '계획 조건의 부두 사용 불가 구간에 넣었습니다. 「다시 계산」을 눌러야 후보에 반영됩니다.' : '이번 계획에는 반영하지 않기로 했습니다.'} <span className="tiny muted">{sel.doneBy} · {sel.doneAt}</span></span>
                      <Button size="small" variant="minimal" icon="undo" onClick={() => { if (sel.status === 'applied') applyIncident(sel.incId, false); setAlertStatus(sel.id, 'read', sel.title) }}>되돌리기</Button>
                    </>
                  ) : (
                    <>
                      <span><span className="strong">이 돌발 상황을 계획 조건에 반영할까요?</span><span className="tiny muted block">반영하면 부두 사용 불가 구간이 계획 조건에 들어갑니다. 후보는 「다시 계산」을 눌러야 바뀝니다.</span></span>
                      <div className="mb-decide-btns">
                        <Button size="small" icon="cross" onClick={() => setAlertStatus(sel.id, 'dismissed', sel.title)}>반영 안 함</Button>
                        <Button size="small" intent="primary" icon="tick" disabled={!incBlock} title={incBlock ? undefined : '이 메일에는 부두 사용 불가 구간이 없어 자동으로 넣을 수 없습니다'} onClick={() => { applyIncident(sel.incId, true); setAlertStatus(sel.id, 'applied', sel.title) }}>반영</Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="mb-actions"><Button size="small" icon="share" onClick={() => open(sel)}>{goLabel(sel)}</Button></div>
              )}
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
