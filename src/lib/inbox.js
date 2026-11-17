// 알림함 알림. 저장해 두는 것은 처리 상태(ws.inbox)뿐이고, 알림 자체는 지금 입력·계산·기록에서 매번 다시 뽑는다.
// 그래서 금액이나 입력이 바뀌면 id가 바뀌어 새 알림으로 다시 올라온다.
import { risks } from './engine.js'
import { fmt, fmtDur, money } from './time.js'

export const CHANNELS = [
  { id: 'all', label: '전체', icon: 'inbox' },
  { id: 'weather', label: '기상', icon: 'cloud' },
  { id: 'eta', label: 'ETA·입력 변경', icon: 'time' },
  { id: 'dem', label: '체선', icon: 'dollar' },
  { id: 'risk', label: '리스크', icon: 'warning-sign' },
  { id: 'plan', label: '확정', icon: 'endorsed' },
]

/**
 * @returns {{id, channel, tone, title, detail, at, by, action}[]}
 *   tone: bad | warn | unknown | info, action: { tab } | { vessel: { simId, vid, mode } }
 */
export function deriveAlerts({ ws, roleId, scenarioId, scen, result, focusId, current, version, checks }) {
  const out = []
  for (const p of ws.plans) {
    out.push({ id: `plan:${p.no}`, channel: 'plan', tone: 'info', title: `접안 계획 v${p.no} 확정 · ${p.label}`, detail: p.reason || '확정 사유 없음', at: p.at, by: p.who, action: { tab: roleId === 'user' ? 'ops' : 'risk' } })
    if (p.cancelled) {
      const log = ws.log.find((l) => l.action === '확정 취소' && l.target.startsWith(`접안 계획 v${p.no} `))
      out.push({ id: `plan-cancel:${p.no}`, channel: 'plan', tone: 'warn', title: `접안 계획 v${p.no} 확정 취소`, detail: log?.detail || '취소 사유 없음', at: log?.at ?? '-', by: log?.who ?? '-', action: { tab: roleId === 'user' ? 'ops' : 'risk' } })
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

  if (!result.error) {
    // 확정안이 지금 입력과 같으면 확정안, 아니면 보고 있는 후보를 기준으로 본다.
    const all = [result.fcfs, ...result.candidates]
    // 기준안보다 나은 후보가 없을 수도 있으므로 마지막에는 기준안을 본다.
    const plan = (current && current.version === version && all.find((s) => s.id === current.candId)) || all.find((s) => s.id === focusId) || result.candidates[0] || result.fcfs
    const basis = current && current.version === version && plan.id === current.candId ? `${plan.label} 확정안` : `${plan.label} 기준`
    for (const p of plan.placements.filter((x) => x.dem.cents > 0)) {
      const v = vessels[p.vid]
      out.push({
        id: `dem:${scenarioId}:${plan.id}:${p.vid}:${p.dem.cents}`, channel: 'dem', tone: 'bad',
        title: `${v.name} 체선 발생 예상 · ${money(p.dem.cents)}`,
        detail: `${scen.berths.find((b) => b.id === p.bid).name} · 허용 초과 ${fmtDur(p.dem.excessMin)} · 작업 종료 ${fmt(p.etu)} · ${basis}`,
        at: '계산 결과', by: '체선료 엔진', action: { vessel: { simId: plan.id, vid: p.vid, mode: 'evidence' } },
      })
    }
    for (const r of risks(plan, scen).filter((x) => x.state !== '해당 없음')) {
      const checked = Boolean(checks[`${version}:${plan.id}:${r.key}`])
      out.push({
        id: `risk:${scenarioId}:${plan.id}:${r.key}`, channel: 'risk', tone: r.state === '판단 불가' ? 'unknown' : 'warn',
        title: `리스크 확인 필요 · ${r.label} (${r.state})`, detail: r.evidence, at: basis, by: '리스크 판정',
        action: { tab: 'risk' }, autoDone: checked ? '리스크·확정에서 확인함' : null,
      })
    }
  }
  return out.reverse()
}
