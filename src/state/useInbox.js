// 메일함 훅: 받은 메일 목록 + 읽음과 반영 상태 + 메일에서 해당 화면으로 가는 동작.
import { useMemo } from 'react'
import { useApp } from './app.jsx'
import { deriveAlerts } from '../lib/inbox.js'
import { ws } from '../lib/workspace.js'

export function useInbox() {
  const app = useApp()
  const { wsRev, role, scenarioId, scen, result, focusId, current, version, go, openVessel } = app
  const alerts = useMemo(() => deriveAlerts({ ws, roleId: role?.id, userAddr: role?.mail, scenarioId, scen })
    .map((a) => {
      const s = ws.inbox[a.id]
      // 리스크 확인 체크처럼 다른 화면에서 이미 처리된 알림은 자동으로 '처리 완료'에 둔다.
      const status = s?.status ?? (a.autoDone ? 'done' : 'new')
      return { ...a, status, doneAt: s?.at ?? null, doneBy: s?.who ?? (a.autoDone ? a.autoDone : null) }
    }),
  // wsRev: 처리 상태·기록이 바뀌면 다시 뽑는다.
  [wsRev, role, scenarioId, scen]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (a) => {
    if (a.action.tab) return go(a.action.tab)
    const { vid, mode } = a.action.vessel
    // 확정본이 지금 조건으로 계산된 것이면 확정 후보, 아니면 보고 있는 후보로 연다.
    const simId = a.action.vessel.simId ?? (result.candidates.length ? (current?.version === version ? current.candId : focusId) : null)
    if (simId) openVessel(simId, vid, { mode })
  }
  const unread = alerts.filter((a) => a.status === 'new').length
  // 돌발 상황: 반영하거나 넘기지 않은 것만 '지금 있는' 돌발 상황이다. 0건이면 메뉴와 분류에서 숨긴다.
  const incidents = alerts.filter((a) => a.channel === 'incident' && (a.status === 'new' || a.status === 'read'))
  return { alerts, unread, open, incidents }
}
