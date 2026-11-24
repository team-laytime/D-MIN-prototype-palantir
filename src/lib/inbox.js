// 받은메일함 메일 (11-24 최최종: 알림함 → 메일함).
// 기상 관측, 시스템(입력 변경 기록, 확정 알림), 현장에서 스케줄러에게 메일로 들어오는 것들이고, 스케줄러는 읽고 업무에 참고한다.
// 저장해 두는 것은 읽음과 반영 상태(ws.inbox)뿐이고, 메일 자체는 지금 입력과 기록에서 매번 다시 뽑는다.
// 11-24 실데이터: 가상 돌발 상황은 없다. 돌발 상황은 scen.incidents에 들어온 것만 보이고, 반영하면 incident.block이 부두 사용 불가로 들어간다.
import { BLOCK_KINDS } from './scenDiff.js'
import { fmt } from './time.js'

export const CHANNELS = [
  { id: 'all', label: '전체', icon: 'inbox' },
  { id: 'weather', label: '기상', icon: 'cloud' },
  { id: 'eta', label: 'ETA, 입력 변경', icon: 'time' },
  { id: 'incident', label: '돌발 상황', icon: 'warning-sign' },
  { id: 'plan', label: '확정', icon: 'endorsed' },
]

const WIND_LIMIT = 14 // m/s, 3~8부두와 부이의 하역 중단 기준(팀 엔진 weather.py)

// 메일 모양으로 채운다: 보낸 사람, 주소, 제목, 본문. 명시하지 않은 것은 분류별 기본값.
const SENDER = {
  weather: ['기상 관측(부이)', 'buoy-obs@example.com'],
  eta: ['D-MIN 입력 변경 기록', 'noreply@d-min.example.com'],
  plan: ['D-MIN 확정 알림', 'noreply@d-min.example.com'],
  incident: ['현장', 'site@example.com'],
}
function asMail(a) {
  const [name, addr] = SENDER[a.channel]
  return { ...a, from: a.from ?? (a.by && a.channel === 'eta' ? `${name} (${a.by})` : name), fromAddr: a.fromAddr ?? addr, subject: a.title, body: a.body ?? `${a.title}\n\n${a.detail}\n\n${a.at}, ${a.by}` }
}

const blockText = (scen, b) => `${b.berths ? b.berths.map((id) => scen.berths.find((x) => x.id === id)?.code ?? id).join(', ') : '전 부두'} ${fmt(b.start)} ~ ${fmt(b.end)} ${BLOCK_KINDS[b.kind] ?? b.kind ?? ''}`.trim()

/**
 * @returns {{id, channel, tone, title, detail, at, by, action}[]}
 *   tone: bad | warn | unknown | info, action: { tab } | { vessel: { simId, vid, mode } }
 */
export function deriveAlerts({ ws, roleId, userAddr, scenarioId, scen }) {
  const out = []
  // 이용자에게는 확정 사유(판단근거)를 보여 주지 않는다. 금액이 적혀 있을 수 있어서다(HN-095). 일정 범위만 알린다.
  const userDetail = (p) => (p.placements.length
    ? `선박 ${p.placements.length}척, ${fmt(Math.min(...p.placements.map((x) => x.etb)))} ~ ${fmt(Math.max(...p.placements.map((x) => x.etu)))} 접안 일정`
    : '접안 일정')
  for (const p of ws.plans) {
    out.push({ id: `plan:${p.no}`, channel: 'plan', tone: 'info', title: `접안 계획 v${p.no} 확정, ${p.label}`, detail: roleId === 'user' ? userDetail(p) : p.reason || '확정 사유 없음', at: p.at, by: p.who, action: { tab: roleId === 'user' ? 'ops' : 'compare' } })
    if (p.cancelled) {
      const log = ws.log.find((l) => l.action === '확정 취소' && l.target.startsWith(`접안 계획 v${p.no} `))
      out.push({ id: `plan-cancel:${p.no}`, channel: 'plan', tone: 'warn', title: `접안 계획 v${p.no} 확정 취소`, detail: roleId === 'user' ? '이 일정은 더 이상 적용되지 않습니다.' : log?.detail || '취소 사유 없음', at: log?.at ?? '-', by: log?.who ?? '-', action: { tab: roleId === 'user' ? 'ops' : 'compare' } })
    }
  }
  // 이용자는 스케줄러가 자기 팀 주소로 보낸 확정 통보 메일(첨부 포함)을 그대로 받는다.
  if (roleId !== 'scheduler') {
    for (const s of ws.sent.filter((x) => x.to === userAddr)) {
      out.push({ id: `sent:${s.id}`, channel: 'plan', tone: 'info', title: s.subject, detail: '', at: s.at, by: s.who, action: { tab: 'ops' },
        from: `${s.who} (선박 스케줄러)`, fromAddr: 'scheduler@example.com', body: s.body, attachments: s.attachments, planNo: s.planNo, groupId: s.groupId })
    }
    return out.map(asMail).reverse()
  }
  if (!scen) return out.map(asMail).reverse() // 데이터셋을 불러오는 중

  // 기상: 계획 기간 관측 풍속이 멈춤 기준 이상일 때만 메일이 온다.
  const win = scen.window
  const wind = (scen.wind ?? []).filter((w) => w.t >= win.start && w.t <= win.end)
  const peak = wind.reduce((m, w) => (w.ms > (m?.ms ?? -1) ? w : m), null)
  if (peak && peak.ms >= WIND_LIMIT) {
    const over = wind.filter((w) => w.ms >= WIND_LIMIT)
    out.push({ id: `wx:${scenarioId}:${peak.t}`, channel: 'weather', tone: 'warn', title: `강풍 관측, 최대 ${peak.ms} m/s (${fmt(peak.t)})`,
      detail: `풍속 ${WIND_LIMIT} m/s 이상인 시간 ${over.length}개, ${fmt(over[0].t)} ~ ${fmt(over.at(-1).t)}. 3~8부두와 부이는 이 시간 하역이 멈춰 작업 완료가 늦어집니다. 다시 계산해 일정을 확인하십시오.`,
      at: fmt(peak.t), by: '기상 관측(부이)', action: { tab: 'input' } })
  }

  const vessels = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  for (const [key, list] of Object.entries(ws.history)) {
    const i = key.indexOf(':')
    const sid = key.slice(0, i), target = key.slice(i + 1)
    if (sid !== scenarioId) continue
    for (const h of list) {
      const isEnv = target === 'env'
      const isWx = isEnv && h.label.includes('(기상)')
      out.push({
        id: `chg:${h.id}`, channel: isWx ? 'weather' : 'eta', tone: isWx || h.field === 'eta' ? 'warn' : 'info',
        title: isEnv ? `${h.label} 변경` : `${vessels[target]?.name ?? target} ${h.label} 변경`,
        detail: `${h.from} → ${h.to}`, at: h.at, by: h.who,
        action: isEnv ? { tab: 'input' } : { vessel: { simId: null, vid: target, mode: 'history' } },
      })
    }
  }

  // 현장에서 메일로 들어온 돌발 상황. incident = { id, kind, title, effect?, at, from, block? }
  for (const inc of scen.incidents ?? []) {
    const effect = inc.effect ?? (inc.block ? `부두 사용 불가 ${blockText(scen, inc.block)}` : '-')
    out.push({ id: `inc:${scenarioId}:${inc.id}`, incId: inc.id, channel: 'incident', tone: 'warn', title: `[${inc.kind}] ${inc.title}`, detail: `영향: ${effect}`,
      at: typeof inc.at === 'number' ? fmt(inc.at) : inc.at ?? '-', by: inc.from ?? '현장', action: { tab: 'input' },
      from: inc.from ?? '현장', fromAddr: inc.fromAddr ?? (inc.from === '생산계획팀' ? 'production@example.com' : 'facility@example.com'),
      body: `스케줄러님,\n\n${inc.title}.\n\n영향: ${effect}\n\n반영 여부를 회신 부탁드립니다.\n${inc.from ?? '현장'} 드림` })
  }
  return out.map(asMail).reverse()
}
