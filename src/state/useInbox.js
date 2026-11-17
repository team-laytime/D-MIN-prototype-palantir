// 알림함 훅: 알림 목록 + 처리 상태 + 알림에서 해당 화면으로 가는 동작.
import { useMemo } from 'react'
import { useApp } from './app.jsx'
import { deriveAlerts } from '../lib/inbox.js'
import { ws } from '../lib/workspace.js'

export function useInbox() {
  const app = useApp()
  const { wsRev, role, scenarioId, scen, result, focusId, current, version, checks, go, openVessel } = app
  const alerts = useMemo(() => deriveAlerts({ ws, roleId: role?.id, scenarioId, scen, result, focusId, current, version, checks })
    .map((a) => {
      const s = ws.inbox[a.id]
      // 리스크 확인 체크처럼 다른 화면에서 이미 처리된 알림은 자동으로 '처리 완료'에 둔다.
      const status = s?.status ?? (a.autoDone ? 'done' : 'new')
      return { ...a, status, doneAt: s?.at ?? null, doneBy: s?.who ?? (a.autoDone ? a.autoDone : null) }
    }),
  // wsRev: 처리 상태·기록이 바뀌면 다시 뽑는다.
  [wsRev, role, scenarioId, scen, result, focusId, current, version, checks]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (a) => {
    if (a.action.tab) return go(a.action.tab)
    const { vid, mode } = a.action.vessel
    const simId = a.action.vessel.simId ?? (result.error ? null : (current?.version === version ? current.candId : focusId))
    if (simId) openVessel(simId, vid, { mode })
  }
  const unread = alerts.filter((a) => a.status === 'new').length
  return { alerts, unread, open }
}
