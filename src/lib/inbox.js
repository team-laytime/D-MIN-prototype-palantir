// 알림함 알림. 저장해 두는 것은 처리 상태(ws.inbox)뿐이고, 알림 자체는 지금 입력·계산·기록에서 매번 다시 뽑는다.
// 그래서 금액이나 입력이 바뀌면 id가 바뀌어 새 알림으로 다시 올라온다.
import { fmt } from './time.js'

export const CHANNELS = [
  { id: 'all', label: '전체', icon: 'inbox' },
  { id: 'weather', label: '기상', icon: 'cloud' },
  { id: 'eta', label: 'ETA·입력 변경', icon: 'time' },
  { id: 'incident', label: '돌발 상황', icon: 'warning-sign' },
  { id: 'plan', label: '확정', icon: 'endorsed' },
]

/**
 * @returns {{id, channel, tone, title, detail, at, by, action}[]}
 *   tone: bad | warn | unknown | info, action: { tab } | { vessel: { simId, vid, mode } }
 */
export function deriveAlerts({ ws, roleId, scenarioId, scen, result, focusId, current, version, checks }) {
  const out = []
  // 이용자에게는 확정 사유(판단근거)를 보여 주지 않는다. 금액이 적혀 있을 수 있어서다(HN-095). 일정 범위만 알린다.
  const userDetail = (p) => `선박 ${p.placements.length}척 · ${fmt(Math.min(...p.placements.map((x) => x.etb)))} ~ ${fmt(Math.max(...p.placements.map((x) => x.etu)))} 접안 일정`
  for (const p of ws.plans) {
    out.push({ id: `plan:${p.no}`, channel: 'plan', tone: 'info', title: `접안 계획 v${p.no} 확정 · ${p.label}`, detail: roleId === 'user' ? userDetail(p) : p.reason || '확정 사유 없음', at: p.at, by: p.who, action: { tab: roleId === 'user' ? 'ops' : 'compare' } })
    if (p.cancelled) {
      const log = ws.log.find((l) => l.action === '확정 취소' && l.target.startsWith(`접안 계획 v${p.no} `))
      out.push({ id: `plan-cancel:${p.no}`, channel: 'plan', tone: 'warn', title: `접안 계획 v${p.no} 확정 취소`, detail: roleId === 'user' ? '이 일정은 더 이상 적용되지 않습니다.' : log?.detail || '취소 사유 없음', at: log?.at ?? '-', by: log?.who ?? '-', action: { tab: roleId === 'user' ? 'ops' : 'compare' } })
    }
  }
  if (roleId !== 'scheduler') return out.reverse()

  const vessels = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  const w = scen.env.weather
  if (w) out.push({ id: `wx:${scenarioId}:${w.start}:${w.end}`, channel: 'weather', tone: 'warn', title: `기상 악화 예보 · ${w.label}`, detail: `${fmt(w.start)} ~ ${fmt(w.end)} 부두 접안 금지`, at: '시나리오 기준', by: '기상 예보', action: { tab: 'input' } })

  for (const [key, list] of Object.entries(ws.history)) {
    const [sid, target] = key.split(':')
    if (sid !== scenarioId) continue
    for (const h of list) {
      const isWx = target === 'env'
      out.push({
        id: `chg:${h.id}`, channel: isWx ? 'weather' : 'eta', tone: isWx || h.field === 'eta' ? 'warn' : 'info',
        title: `${isWx ? '기상 예보 변경' : `${vessels[target]?.name ?? target} ${h.label} 변경`}`,
        detail: `${h.from} → ${h.to}`, at: h.at, by: h.who,
        action: isWx ? { tab: 'input' } : { vessel: { simId: null, vid: target, mode: 'history' } },
      })
    }
  }

  // 11-20 피드백: 계산 결과(체선·리스크) 알림은 보고서와 같아서 뺐다. 대신 현장에서 메일로 들어오는 돌발 상황을 받는다.
  for (const inc of scen.incidents ?? []) {
    out.push({ id: `inc:${scenarioId}:${inc.id}`, channel: 'incident', tone: 'warn', title: `[${inc.kind}] ${inc.title}`, detail: `영향: ${inc.effect}`, at: fmt(inc.at), by: `${inc.from} (메일)`, action: { tab: 'input' } })
  }
  return out.reverse()
}
