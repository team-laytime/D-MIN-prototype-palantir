// 활동 기록: 누가 언제 무엇을 했는지 추가만 되는 기록. 입력 수정·후보 선택·판단근거·리스크 확인·확정·보고서·메일·메모·알림 처리.
import { useMemo, useState } from 'react'
import { Button, InputGroup, NonIdealState } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { ws } from '../lib/workspace.js'
import { Panel, Screen, Stats } from '../ui/kit.jsx'
import './inbox.css'

const KINDS = ['전체', '입력', '시나리오', '리스크', '보고서', '메일', '확정', '메모', '알림', '접속']
const KIND_TONE = { 입력: 'blue', 확정: 'green', 리스크: 'amber', 보고서: 'accent', 메일: 'accent', 알림: 'violet' }

const csvCell = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`

export default function Activity() {
  const { wsRev } = useApp()
  const [kind, setKind] = useState('전체')
  const [q, setQ] = useState('')
  const rows = useMemo(() => [...ws.log].sort((a, b) => b.ts - a.ts), [wsRev]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter((r) => (kind === '전체' || r.kind === kind) && (!q || `${r.action} ${r.target} ${r.detail} ${r.who}`.includes(q)))

  function exportCsv() {
    const lines = [['시각', '사용자', '역할', '구분', '내용', '대상', '상세'].map(csvCell).join(',')]
    for (const r of shown) lines.push([r.at, r.who, r.roleTitle, r.kind, r.action, r.target, r.detail].map(csvCell).join(','))
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = '활동기록.csv'
    document.body.append(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const by = (k) => rows.filter((r) => r.kind === k).length
  return (
    <Screen tab="activity" title="활동 기록" desc="모든 조작을 누가 언제 했는지 남깁니다. 기록은 추가만 되고 고칠 수 없습니다." bodyClass="inbox-page">
      <Stats items={[
        { label: '전체 기록', value: rows.length },
        { label: '입력 수정', value: by('입력'), tone: 'blue' },
        { label: '확정·취소', value: by('확정'), tone: 'green' },
        { label: '보고서·메일', value: by('보고서') + by('메일'), tone: 'accent' },
        { label: '마지막 기록', value: <span className="act-prose">{rows[0]?.at ?? '-'}</span>, sub: rows[0] ? `${rows[0].who} · ${rows[0].action}` : '' },
      ]} />
      <Panel code="AUDIT-LOG" title="기록" desc={`${shown.length}건 · 최신순`} data-tour="activity-log" actions={
        <div className="rpt-tools">
          <InputGroup size="small" leftIcon="search" placeholder="내용·대상·사용자 검색" value={q} onChange={(e) => setQ(e.target.value)} className="act-search" />
          <Button size="small" icon="export" disabled={!shown.length} onClick={exportCsv}>CSV 내보내기</Button>
        </div>
      }>
        <div className="act-kinds">
          {KINDS.map((k) => (
            <button key={k} type="button" className={`act-kind ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
              {k}{k !== '전체' && <span className="num faint"> {by(k)}</span>}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <NonIdealState className="inbox-empty" icon="history" title="기록이 없습니다" description="입력을 고치거나 후보를 확정하면 여기에 남습니다." />
        ) : (
          <table className="dt act-table">
            <thead><tr><th>시각</th><th>사용자</th><th>구분</th><th>내용</th><th>대상</th><th>상세</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="num act-time">{r.at}</td>
                  <td><span className="strong">{r.who}</span><span className="tiny muted"> · {r.roleTitle}</span></td>
                  <td><span className={`chip ${KIND_TONE[r.kind] ?? ''}`}>{r.kind}</span></td>
                  <td className="strong">{r.action}</td>
                  <td>{r.target}</td>
                  <td className="muted act-detail">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </Screen>
  )
}
