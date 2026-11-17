import { Callout } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { activePlan, useWorkspace } from '../lib/workspace.js'
import { fmt } from '../lib/time.js'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import './decide.css'

const hourOf = (minute) => Math.floor((((minute % 1440) + 1440) % 1440) / 60)
const night = (placement) => hourOf(placement.etb) >= 20 || hourOf(placement.etb) < 6
const flags = (placement) => [night(placement) && '야간 접안', placement.dwt >= 60000 && '6만 DWT 이상'].filter(Boolean)

export default function Schedule() {
  const { role } = useApp()
  useWorkspace()
  const plan = activePlan()
  const nightCount = plan?.placements.filter(night).length ?? 0

  return (
    <Screen tab="ops" title="확정 접안 일정" actions={<St tone={plan ? 'live' : 'idle'}>{plan ? `확정 v${plan.no} 적용 중` : '확정 대기'}</St>} bodyClass="schedule-page">
      <p className="schedule-intro small muted">스케줄러가 확정한 일정입니다. 검토 중인 후보와 체선료 금액은 이 화면에 나오지 않습니다.</p>
      {!plan ? (
        <Callout className="schedule-empty" icon="info-sign" title="확정된 계획이 없습니다.">
          스케줄러가 계획을 확정하면 이 화면에 일정이 나옵니다.
        </Callout>
      ) : (
        <>
          <Stats items={[
            { label: '적용 계획', value: <span className="schedule-prose"><span className="num">v{plan.no}</span> · {plan.label}</span>, tone: 'accent' },
            { label: '확정', value: <span className="schedule-prose">{plan.who}</span>, sub: plan.at },
            { label: '선박', value: <>{plan.placements.length}<span className="schedule-stat-unit">척</span></> },
            { label: '야간 접안', value: <>{nightCount}<span className="schedule-stat-unit">건</span></>, tone: nightCount ? 'amber' : 'green' },
          ]} />
          <Panel code="BERTH-ORDER" title="접안 순서" desc="접안 시각 순" actions={<span className="small muted">{role.title} · 확정본만 조회</span>}>
            <table className="dt schedule-table">
              <thead><tr><th className="c">순서</th><th>선박</th><th>화물</th><th className="c">부두</th><th>도착</th><th>접안</th><th>작업 종료</th><th>주의</th></tr></thead>
              <tbody>
                {plan.placements.map((placement, index) => {
                  const warnings = flags(placement)
                  return (
                    <tr key={placement.vid}>
                      <td className="c num"><span className="faint">{String(index + 1).padStart(2, '0')}</span></td>
                      <td className="strong">{placement.name}</td>
                      <td className="schedule-cargo">{placement.product} {placement.dir} · <span className="num">{placement.ton.toLocaleString()}t</span></td>
                      <td className="c">{placement.berth}</td>
                      <td className="num">{fmt(placement.eta)}</td>
                      <td className="num"><span className="c-accent strong">{fmt(placement.etb)}</span></td>
                      <td className="num">{fmt(placement.etu)}</td>
                      <td>
                        <div className="schedule-flags">
                          {warnings.length ? warnings.map((warning) => <span className="chip amber schedule-flag" key={warning}>{warning}</span>) : <span className="faint">-</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
          <p className="schedule-snapshot small muted">확정 당시 일정 기준입니다. 스케줄러가 입력을 수정해도 새 계획을 확정하기 전까지 이 일정은 바뀌지 않습니다.</p>
        </>
      )}
    </Screen>
  )
}
