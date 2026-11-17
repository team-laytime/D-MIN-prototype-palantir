import { useMemo, useState } from 'react'
import { Button, Callout, Checkbox, SegmentedControl, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { risks, sensitivity } from '../lib/engine.js'
import { money } from '../lib/time.js'
import { activePlan, cancelPlan, fixPlan, useWorkspace, ws } from '../lib/workspace.js'
import { Panel, Screen, Stats, St, riskTone } from '../ui/kit.jsx'
import './decide.css'

export default function Risk() {
  const { all, result, scen, focusId, setFocusId, checks, setCheck, version, current, isScheduler, go } = useApp()
  const wsRev = useWorkspace()
  const [reason, setReason] = useState('')
  const [confirmationFor, setConfirmationFor] = useState(null)
  const cand = all.find((s) => s.id === focusId) ?? result.candidates[0]
  const items = useMemo(() => risks(cand, scen), [cand, scen])
  const sens = useMemo(() => sensitivity(cand, all, scen).slice(0, 6), [cand, all, scen])
  const checkKey = (riskKey) => `${version}:${cand.id}:${riskKey}`
  const needsCheck = items.filter((r) => r.state !== '해당 없음')
  const unchecked = needsCheck.filter((r) => !checks[checkKey(r.key)])
  const checkedCount = needsCheck.length - unchecked.length
  const fixedHere = current?.candId === cand.id && current.version === version
  const plan = activePlan()
  const planLog = useMemo(() => ws.log.filter((l) => ['계획 확정', '확정 취소'].includes(l.action)).slice().reverse(), [wsRev])
  const confirming = confirmationFor === `${version}:${cand.id}`

  function fix(force = false) {
    if (!isScheduler) return
    if (unchecked.length && !force) {
      setConfirmationFor(`${version}:${cand.id}`)
      return
    }
    fixPlan({
      cand, scen, version,
      reason: reason.trim() || '(사유 미입력)',
      uncheckedRisks: unchecked.map((r) => r.label),
    })
    setConfirmationFor(null)
    setReason('')
  }

  return (
    <Screen tab="risk" title="리스크·확정" step={fixedHere ? 4 : 3} bodyClass="risk-page">
      <p className="risk-intro muted small">계산에 반영하지 못한 변수를 확인하고 스케줄러가 계획을 확정합니다. 확정한 일정은 이용자 화면에 전달됩니다.</p>
      <Stats items={[
        { label: '보는 안', value: <span className="risk-prose">{cand.id === 'FCFS' ? '기준안' : cand.label}</span> },
        { label: '확인할 리스크', value: <>{needsCheck.length}<span className="risk-stat-unit">건</span></> },
        { label: '확인 완료', value: <>{checkedCount}<span className="risk-stat-unit">건</span></>, tone: unchecked.length ? 'amber' : 'green' },
        { label: '적용 중 계획', value: <span className="risk-prose">{current ? `${current.label} ${current.status}` : '확정 전'}</span>, tone: current ? 'accent' : undefined },
      ]} />

      <div className="risk-layout">
        <div className="stack">
          <Panel code="RISK-CHECK" title="남은 리스크" data-tour="risks" actions={
            <SegmentedControl
              aria-label="리스크 검토 후보" size="small" intent="primary"
              value={cand.id}
              options={all.map((s) => ({ value: s.id, label: s.id === 'FCFS' ? '기준안' : s.id }))}
              onValueChange={(id) => { setConfirmationFor(null); setFocusId(id) }}
            />
          }>
            <div className="risk-list">
              {items.map((r) => (
                <article className="risk-item" key={r.key}>
                  <div className="risk-name">
                    <h3>{r.label}</h3>
                    <St tone={riskTone(r.state)}>{r.state}</St>
                  </div>
                  <div className="risk-evidence">
                    <p>{r.evidence}</p>
                    {(r.alternative !== '-' || r.caution !== '-') && (
                      <dl className="risk-guidance">
                        {r.alternative !== '-' && <><dt>대안</dt><dd>{r.alternative}</dd></>}
                        {r.caution !== '-' && <><dt>주의</dt><dd>{r.caution}</dd></>}
                      </dl>
                    )}
                  </div>
                  {r.state !== '해당 없음' ? (
                    <Checkbox
                      className="risk-checkbox" label="확인" aria-label={`${r.label} 확인`}
                      checked={Boolean(checks[checkKey(r.key)])} disabled={!isScheduler}
                      onChange={(event) => setCheck(checkKey(r.key), event.currentTarget.checked)}
                    />
                  ) : <span />}
                </article>
              ))}
            </div>
          </Panel>

          <Panel code="INPUT-IMPACT" title="입력 변동 시 영향" desc="순서·부두 배정 고정 · 영향 큰 순 6건">
            <table className="dt risk-sensitivity">
              <thead><tr><th>바뀐 입력</th><th className="r">총 체선료 변화</th><th>후보 순위</th></tr></thead>
              <tbody>
                {sens.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label}</td>
                    <td className={`r ${s.delta > 0 ? 'risk-increase' : s.delta < 0 ? 'risk-decrease' : ''}`}>
                      {s.delta === null ? '배치 불가' : s.delta === 0 ? '변화 없음' : <span className="num">{s.delta > 0 ? '+' : ''}{money(s.delta)}</span>}
                    </td>
                    <td>
                      {s.rankAfter !== s.rankBefore
                        ? <span className="risk-rank c-amber"><span className="num">{s.rankBefore}</span>위 → <span className="num">{s.rankAfter}</span>위{s.delta === 0 && <span className="small"> (다른 후보가 더 낮아짐)</span>}</span>
                        : <span className="muted small"><span className="num">{s.rankBefore}</span>위 유지</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>

        <aside className="risk-sidebar stack">
          <Panel code="PLAN-DECIDE" title="계획 확정" data-tour="decide" pad>
            <div className="risk-decision stack">
              <div className="risk-amount">
                <span className="strong">{cand.label}</span>
                <span className="risk-total num">{money(cand.total)}</span>
                <span className="small muted">기준안 대비 <span className={`num ${cand.total < result.fcfs.total ? 'c-green' : ''}`}>{money(cand.total - result.fcfs.total)}</span></span>
              </div>
              <p className={`risk-check-count small ${unchecked.length ? 'c-amber' : 'c-green'}`}>
                확인할 리스크 <span className="num">{needsCheck.length}</span>건 중 <span className="num">{checkedCount}</span>건 확인
              </p>

              {fixedHere ? (
                <>
                  <div className="risk-applied">
                    <St tone="ok">{current.status}</St>
                    <span className="tiny muted">{plan.at} · {plan.who}</span>
                  </div>
                  <p className="small muted">이용자는 이 확정 일정을 봅니다.</p>
                  <div className="risk-buttons">
                    <Button icon="undo" size="small" disabled={!isScheduler} onClick={() => { if (isScheduler) cancelPlan('스케줄러 확정 취소') }}>확정 취소</Button>
                    <Button intent="primary" icon="document" size="small" onClick={() => go('report')}>보고서 초안</Button>
                  </div>
                </>
              ) : (
                <>
                  {current && <p className="small c-amber">적용 중인 계획은 {current.label} ({current.status})입니다. 확정하면 새 버전으로 바뀝니다.</p>}
                  <div className="risk-reason-field">
                    <label htmlFor="risk-reason">확정 사유 · 보고서에 포함</label>
                    <TextArea
                      id="risk-reason" fill rows={3} value={reason} disabled={!isScheduler}
                      onChange={(event) => setReason(event.currentTarget.value)}
                      placeholder="예: 기상 해제 직후 대형선 우선 접안, 체선료 절감 폭이 가장 큼"
                    />
                  </div>
                  {confirming ? (
                    <Callout className="risk-confirmation" intent="warning" icon="warning-sign">
                      <p className="small"><b>미확인 리스크 {unchecked.length}건</b> ({unchecked.map((r) => r.label).join(', ')}). 확정 기록에 함께 남습니다.</p>
                      <div className="risk-buttons">
                        <Button size="small" onClick={() => setConfirmationFor(null)}>돌아가기</Button>
                        <Button size="small" intent="warning" disabled={!isScheduler} onClick={() => fix(true)}>그래도 확정</Button>
                      </div>
                    </Callout>
                  ) : (
                    <Button intent="primary" icon="endorsed" fill disabled={!isScheduler} onClick={() => fix()}>이 안으로 확정</Button>
                  )}
                </>
              )}
              <p className="risk-policy tiny muted">Agent는 계획을 확정하지 않습니다. 확정과 취소는 스케줄러만 할 수 있고, 모든 처리는 기록으로 남습니다.</p>
            </div>
          </Panel>

          <Panel code="PLAN-LOG" title="확정 이력" desc="추가만 가능" pad>
            {!planLog.length ? <p className="small muted">기록 없음</p> : (
              <ol className="risk-log">
                {planLog.map((entry, index) => (
                  <li key={`${entry.at}:${index}`}>
                    <div className="risk-log-title">
                      <St tone={entry.action === '계획 확정' ? 'ok' : 'warn'}>{entry.action}</St>
                      <span>{entry.target}</span>
                    </div>
                    <p className="tiny muted">{entry.at} · {entry.who}</p>
                    <p className="small">{entry.detail}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </aside>
      </div>
    </Screen>
  )
}
