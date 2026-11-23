// 확정 통보 메일 (11-20 피드백 반영)
//  - 확정한 뒤에만 쓴다. 후보 정보는 넣지 않고 확정 일정만 통보한다.
//  - 템플릿 + {{태그}} 버튼: 모든 메일에 공통으로 들어갈 내용 + 받는 그룹별로 바뀌는 내용
//  - 이 화면은 발송하지 않는다(복사하거나 메일 앱에서 열어 보냄).
import { useMemo, useRef, useState } from 'react'
import { AnchorButton, Button, Callout, HTMLSelect, InputGroup, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { activePlan, logActivity, useWorkspace } from '../lib/workspace.js'
import { BERTH_TEAMS } from '../lib/scenarios.js'
import { fmt } from '../lib/time.js'
import { Panel, Screen, St } from '../ui/kit.jsx'
import './report.css'

const GROUPS = [
  { id: 'B2', name: 'SK 3부두 하역 1팀', to: 'sk3-ops@example.com', berth: 'B2' },
  { id: 'B1', name: 'SK 6부두 하역 2팀', to: 'sk6-ops@example.com', berth: 'B1' },
  { id: 'B3', name: 'SK 5부두 하역 1팀', to: 'sk5-ops@example.com', berth: 'B3' },
  { id: 'AGENT', name: '선박 대리점', to: 'agents@example.com', berth: null },
]
const TAGS = [
  ['확정버전', '확정 v1'], ['확정일시', '확정한 시각'], ['받는곳', '받는 그룹 이름'], ['담당부두', '그룹의 부두'],
  ['내일정', '그룹 부두의 접안 일정 표'], ['전체일정', '전체 접안 순서'], ['주의사항', '야간 접안 등'], ['연락처', '부두 반장 연락처'],
]
const TEMPLATES = {
  notice: {
    label: '확정 통보 (기본)',
    subject: '[D-MIN] 울산 CLX 접안 계획 {{확정버전}} 확정 안내 · {{받는곳}}',
    body: `{{받는곳}} 담당자님께,

울산 CLX 액체부두 접안 계획이 {{확정일시}}에 {{확정버전}}으로 확정되었습니다.

■ {{담당부두}} 접안 일정
{{내일정}}

■ 전체 접안 순서
{{전체일정}}

■ 주의사항
{{주의사항}}

변경이 생기면 새 버전으로 다시 안내드립니다.
문의: {{연락처}}`,
  },
  order: {
    label: '부두 작업 지시',
    subject: '[작업 지시] {{담당부두}} 접안 일정 {{확정버전}}',
    body: `{{받는곳}}

{{확정버전}} 기준 {{담당부두}} 작업 일정입니다.
{{내일정}}

{{주의사항}}`,
  },
}

export default function Mail() {
  const { go, isScheduler } = useApp()
  useWorkspace()
  const plan = activePlan()
  const [tpl, setTpl] = useState('notice')
  const [subject, setSubject] = useState(TEMPLATES.notice.subject)
  const [body, setBody] = useState(TEMPLATES.notice.body)
  const [groupId, setGroupId] = useState('B2')
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef(null)

  const fill = useMemo(() => {
    if (!plan) return () => ''
    return (text, g) => {
      const mine = g.berth ? plan.placements.filter((p) => p.bid === g.berth) : plan.placements
      const row = (p) => `- ${fmt(p.etb)} 접안 → ${fmt(p.etu)} 종료 · ${p.name} (${p.product} ${p.dir} ${p.ton.toLocaleString()}t)`
      const nightRows = mine.filter((p) => { const h = Math.floor((p.etb % 1440) / 60); return h >= 20 || h < 6 })
      const team = g.berth ? BERTH_TEAMS[g.berth] : null
      const vals = {
        확정버전: `v${plan.no}`, 확정일시: plan.at, 받는곳: g.name,
        담당부두: g.berth ? plan.placements.find((p) => p.bid === g.berth)?.berth ?? g.name : '전 부두',
        내일정: mine.length ? mine.map(row).join('\n') : '- 이번 계획에서 배정된 선박 없음',
        전체일정: plan.placements.map((p, i) => `${i + 1}. ${p.name} · ${p.berth} · ${fmt(p.etb)}`).join('\n'),
        주의사항: nightRows.length ? nightRows.map((p) => `- ${p.name} ${fmt(p.etb)} 야간 접안: 도선·계류 인력 미리 배치`).join('\n') : '- 특이사항 없음',
        연락처: team ? `${team.lead} ${team.tel}` : '선박 스케줄러 052-000-0000',
      }
      return text.replace(/\{\{(.+?)\}\}/g, (m, k) => vals[k] ?? m)
    }
  }, [plan])

  if (!plan) {
    return (
      <Screen tab="mail" title="확정 통보 메일" step={4} bodyClass="rpt-page">
        <Callout intent="primary" icon="lock" title="확정한 뒤에 씁니다">
          통보 메일은 확정된 일정만 보냅니다. 「후보 비교·확정」에서 안을 확정하면 이 화면이 열립니다.
          <div style={{ marginTop: 10 }}><Button intent="primary" icon="comparison" onClick={() => go('compare')}>후보 비교·확정으로</Button></div>
        </Callout>
      </Screen>
    )
  }

  const group = GROUPS.find((g) => g.id === groupId)
  const outSubject = fill(subject, group)
  const outBody = fill(body, group)
  const insert = (tag) => {
    const el = bodyRef.current
    const token = `{{${tag}}}`
    if (!el) { setBody((b) => b + token); return }
    const { selectionStart: a, selectionEnd: b } = el
    setBody((x) => x.slice(0, a) + token + x.slice(b))
  }
  const chooseTpl = (id) => { setTpl(id); setSubject(TEMPLATES[id].subject); setBody(TEMPLATES[id].body) }
  const copy = async () => {
    try { await navigator.clipboard.writeText(`제목: ${outSubject}\n\n${outBody}`); setCopied(true); logActivity('메일', '메일 복사', outSubject); setTimeout(() => setCopied(false), 1500) } catch { /* 복사 실패는 화면에서 직접 선택 */ }
  }
  const mailto = `mailto:${group.to}?${new URLSearchParams({ subject: outSubject, body: outBody }).toString().replace(/\+/g, '%20')}`

  return (
    <Screen tab="mail" title="확정 통보 메일" step={4} bodyClass="rpt-page" actions={<St tone="ok">접안 계획 v{plan.no} · {plan.label} 확정</St>}>
      <p className="muted small">확정된 일정만 통보합니다(후보 정보 없음). 템플릿은 모든 메일에 공통으로 들어가고, {'{{태그}}'}는 받는 그룹마다 다른 내용으로 바뀝니다. 이 화면은 발송하지 않습니다.</p>
      <div className="ml-grid">
        <Panel code="MAIL-TO" title="받는 그룹" pad>
          <ul className="ml-groups">
            {GROUPS.map((g) => (
              <li key={g.id}>
                <button type="button" className={g.id === groupId ? 'on' : ''} onClick={() => setGroupId(g.id)}>
                  <b>{g.name}</b><span className="tiny muted">{g.to}</span>
                  <span className="tiny">{g.berth ? `${plan.placements.filter((p) => p.bid === g.berth).length}척 배정` : '전체 일정'}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="tiny muted">그룹을 누르면 오른쪽 미리보기가 그 그룹용으로 바뀝니다.</p>
        </Panel>

        <Panel code="MAIL-TPL" title="템플릿" actions={<HTMLSelect size="small" value={tpl} disabled={!isScheduler} onChange={(e) => chooseTpl(e.target.value)} options={Object.entries(TEMPLATES).map(([value, t]) => ({ value, label: t.label }))} />} pad>
          <label className="ml-label">제목</label>
          <InputGroup value={subject} disabled={!isScheduler} onChange={(e) => setSubject(e.target.value)} />
          <div className="ml-tags">
            <span className="tiny muted">태그 넣기</span>
            {TAGS.map(([t, hint]) => <button type="button" key={t} title={hint} disabled={!isScheduler} onClick={() => insert(t)}>{`{{${t}}}`}</button>)}
          </div>
          <TextArea inputRef={bodyRef} className="ml-body" fill value={body} disabled={!isScheduler} onChange={(e) => setBody(e.target.value)} aria-label="메일 템플릿 본문" />
        </Panel>

        <Panel code="MAIL-PREVIEW" title={`미리보기 · ${group.name}`} actions={
          <div className="rpt-tools">
            <Button size="small" icon={copied ? 'tick' : 'duplicate'} onClick={copy}>{copied ? '복사됨' : '복사'}</Button>
            <AnchorButton size="small" intent="primary" icon="send-message" href={mailto} onClick={() => logActivity('메일', '메일 앱에서 열기', outSubject, group.to)}>메일 앱에서 열기</AnchorButton>
          </div>
        } pad>
          <dl className="ml-head small"><dt>받는 사람</dt><dd>{group.name} &lt;{group.to}&gt;</dd><dt>제목</dt><dd className="strong">{outSubject}</dd></dl>
          <pre className="ml-preview">{outBody}</pre>
        </Panel>
      </div>
    </Screen>
  )
}
