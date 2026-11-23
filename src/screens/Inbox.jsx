// 알림함: 기상·ETA·체선·리스크·확정 알림을 한곳에서 보고, 처리 완료/보관하고, 해당 화면으로 바로 간다.
import { useState } from 'react'
import { Button, Icon, NonIdealState, SegmentedControl } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { useInbox } from '../state/useInbox.js'
import { CHANNELS } from '../lib/inbox.js'
import { setAlertStatus } from '../lib/workspace.js'
import { Panel, Screen, St } from '../ui/kit.jsx'
import './inbox.css'

const TONE = { bad: 'bad', warn: 'warn', unknown: 'unknown', info: 'live' }
const BOX = [{ value: 'new', label: '새 알림' }, { value: 'done', label: '처리 완료' }, { value: 'archived', label: '보관' }]

export default function Inbox() {
  const { isScheduler } = useApp()
  const { alerts, open } = useInbox()
  const [box, setBox] = useState('new')
  const [channel, setChannel] = useState('all')
  const channels = isScheduler ? CHANNELS : CHANNELS.filter((c) => c.id === 'all' || c.id === 'plan')
  const inBox = alerts.filter((a) => a.status === box)
  const shown = inBox.filter((a) => channel === 'all' || a.channel === channel)
  const count = (id) => alerts.filter((a) => a.status === 'new' && (id === 'all' || a.channel === id)).length
  const chLabel = (id) => CHANNELS.find((c) => c.id === id)?.label

  const resolveAll = () => { for (const a of shown) setAlertStatus(a.id, 'done', a.title) }

  return (
    <Screen tab="inbox" title="알림함" desc={isScheduler ? '현장에서 들어온 돌발 상황(부두 공사·재고 변동), 기상 예보, ETA 변경, 확정 알림을 받습니다. 계산 결과는 후보 비교에서 봅니다.' : '확정·취소된 접안 일정 알림입니다.'} bodyClass="inbox-page">
      <div className="inbox-grid">
        <Panel code="CHANNEL" title="분류">
          <ul className="inbox-channels">
            {channels.map((c) => (
              <li key={c.id}>
                <button type="button" className={`inbox-channel ${channel === c.id ? 'on' : ''}`} onClick={() => setChannel(c.id)}>
                  <Icon icon={c.icon} size={14} />
                  <span>{c.label}</span>
                  {count(c.id) > 0 && <span className="num inbox-count">{count(c.id)}</span>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel code="INBOX" title={chLabel(channel)} desc={`${BOX.find((b) => b.value === box).label} ${shown.length}건`} data-tour="inbox-list" actions={
          <div className="rpt-tools">
            <SegmentedControl size="small" value={box} onValueChange={setBox}
              options={BOX.map((b) => ({ value: b.value, label: `${b.label} ${alerts.filter((a) => a.status === b.value).length}` }))} />
            {box === 'new' && <Button size="small" icon="tick" disabled={!shown.length} onClick={resolveAll}>모두 처리 완료</Button>}
          </div>
        }>
          {shown.length === 0 ? (
            <NonIdealState className="inbox-empty" icon="inbox" title={box === 'new' ? '새 알림이 없습니다' : '알림이 없습니다'}
              description={box === 'new' ? '입력이 바뀌거나 체선·리스크가 생기면 여기에 올라옵니다.' : '처리하거나 보관한 알림이 여기에 남습니다.'} />
          ) : (
            <ul className="inbox-list">
              {shown.map((a) => (
                <li key={a.id} className={`inbox-item tone-${a.tone}`}>
                  <St tone={TONE[a.tone]} className="inbox-dot" />
                  <div className="inbox-main">
                    <div className="inbox-head">
                      <span className="chip">{chLabel(a.channel)}</span>
                      <b>{a.title}</b>
                    </div>
                    <p className="small muted">{a.detail}</p>
                    <p className="tiny faint">
                      {a.at} · {a.by}
                      {a.status !== 'new' && a.doneBy && <> · {a.status === 'done' ? '처리' : '보관'}: {a.doneBy}{a.doneAt ? ` (${a.doneAt})` : ''}</>}
                    </p>
                  </div>
                  <div className="inbox-actions">
                    <Button size="small" icon="share" onClick={() => open(a)}>열기</Button>
                    {a.status === 'new' ? (
                      <>
                        <Button size="small" icon="tick" intent="primary" variant="outlined" onClick={() => setAlertStatus(a.id, 'done', a.title)}>처리 완료</Button>
                        <Button size="small" icon="archive" variant="minimal" aria-label="보관" title="보관" onClick={() => setAlertStatus(a.id, 'archived', a.title)} />
                      </>
                    ) : (
                      <Button size="small" icon="undo" variant="minimal" onClick={() => setAlertStatus(a.id, null, a.title)}>되돌리기</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </Screen>
  )
}
