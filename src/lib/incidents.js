// 11-25 계획 조건을 바꾸는 받은 메일(시연용). 실데이터 묶음에는 이런 메일이 없어, 데이터셋의 실제 선박 · 부두로 정해진 규칙에 따라 만든다.
// 메일마다 change 하나가 있고, 「반영」하면 계획 조건(scen)에 들어간다(applyChange). 후보는 「다시 계산」해야 바뀐다.
//   block 부두 운영팀: 설비 고장 · 점검           → scen.blocks (EQUIPMENT)
//   (11-26 강풍 예보 · ETA 지연 메일은 뺐다. 강풍은 기상이 데이터셋의 시간별 풍속으로 이미 들어가 있어 데이터와 다른 풍속을 지어내게 되고,
//    ETA 지연은 사용자 결정. 「반영」의 eta 처리(applyChange)는 다른 경로를 위해 남겨 둔다)
//   fix   출하팀: 고객사 선적 일정으로 우선 접안   → scen.fixes
//   param 생산계획팀: 탱크 안전재고 상한 조정      → scen.params.tank.safe_max_pct
import { dayStart, fmt, toMin } from './time.js'

const round10 = (m) => Math.ceil(m / 10) * 10

/**
 * @param scen   buildScen 결과 일부 {vessels, berths, window}
 * @param plan   기존 계획 vessels(데이터의 실제 접안 기록) — 붐비는 부두를 고를 때
 * @param base   기존 계획 vessels — 우선 접안 요청의 부두 · 시각 (11-26부터 plan과 같은 것)
 */
export function seedIncidents({ vessels, berths, window }, plan, base) {
  const out = []
  const vById = Object.fromEntries(vessels.map((v) => [v.id, v]))
  const bById = Object.fromEntries(berths.map((b) => [b.id, b]))
  const used = new Set()
  const d0 = dayStart(window.start)

  // 1) 설비 고장: 둘째 날 가장 붐비는 선석을 08~16시 사용 불가
  const day2 = [d0 + 1440, d0 + 2 * 1440]
  const busy = {}
  for (const p of plan) { const t = toMin(p.etb); if (t >= day2[0] && t < day2[1]) busy[p.berth] = (busy[p.berth] ?? 0) + 1 }
  const bid = Object.entries(busy).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (bid && bById[bid]) {
    const block = { berths: [bid], start: day2[0] + 8 * 60, end: day2[0] + 16 * 60, kind: 'EQUIPMENT' }
    out.push({
      id: 'equip', kind: '설비 고장', from: '부두 운영팀', fromAddr: 'facility@example.com', at: -95,
      title: `${bById[bid].name} 로딩암 유압 이상, ${fmt(block.start)} ~ ${fmt(block.end).slice(-5)} 점검`,
      body: `스케줄러님,\n\n${bById[bid].name} 로딩암 2번에서 유압 이상이 확인되어 아래 시간에 점검합니다. 이 시간에는 접안과 하역이 불가합니다.\n\n점검: ${fmt(block.start)} ~ ${fmt(block.end)}\n\n해당 선석 배정을 조정 부탁드립니다.\n부두 운영팀 드림`,
      block, change: { type: 'block', block },
    })
  }

  // 2) 우선 접안 요청: 12~48시간 뒤 접안하는 첫 반출선을 기존 계획 부두 · 시각으로 고정
  //    (11-26 엔진 계획 없이 만든다. 최적화는 이 배를 옮길 수 있으므로 고정은 늘 의미 있는 조건)
  const pick = base
    .map((b) => ({ b, v: vById[b.vessel_id], etb: round10(toMin(b.etb)) }))
    .filter(({ b, v, etb }) => v && !used.has(v.id) && !v.in && etb >= 12 * 60 && etb <= 48 * 60 && etb >= v.eta && v.compat.includes(b.berth))
    .sort((x, y) => x.etb - y.etb)[0]
  if (pick) {
    used.add(pick.v.id)
    const bn = bById[pick.b.berth]?.name ?? pick.b.berth
    out.push({
      id: 'priority', kind: '우선 접안', from: '출하팀', fromAddr: 'shipping@example.com', at: -40,
      title: `${pick.v.name} ${bn} ${fmt(pick.etb)} 접안 요청 (고객사 선적 일정)`,
      body: `스케줄러님,\n\n고객사 선적 일정 때문에 ${pick.v.name}(${pick.v.product} ${pick.v.dir})을 아래대로 접안해야 합니다.\n\n부두: ${bn}\n접안: ${fmt(pick.etb)}\n\n이 시각에 맞춰 고정 부탁드립니다.\n출하팀 드림`,
      change: { type: 'fix', vid: pick.v.id, bid: pick.b.berth, etb: pick.etb },
    })
  }

  // 3) 탱크 상한 조정: 원유 입고가 몰려 안전재고 상한을 75%로
  out.push({
    id: 'tank-max', kind: '탱크 운영', from: '생산계획팀', fromAddr: 'production@example.com', at: -20,
    title: '원유 입고 집중, 탱크 안전재고 상한 75%로 운영 요청',
    body: '스케줄러님,\n\n이번 주 원유 입고가 몰려 있어 넘침 여유를 두려고 합니다. 계획할 때 탱크 안전재고 상한을 80%에서 75%로 낮춰 주십시오.\n\n생산계획팀 드림',
    change: { type: 'param', path: ['tank', 'safe_max_pct'], to: 75, label: '안전재고 상한', unit: '%' },
  })
  return out
}

/** 메일의 change를 한 줄로 */
export function changeText(scen, inc) {
  const c = inc.change
  if (!c) return '-'
  const vname = (vid) => scen.vessels.find((v) => v.id === vid)?.name ?? vid
  const bname = (id) => scen.berths.find((b) => b.id === id)?.name ?? id
  if (c.type === 'eta') return `${vname(c.vid)} ETA ${fmt(c.from)} → ${fmt(c.to)}`
  if (c.type === 'block') return `${c.block.berths.length > 3 ? `${c.block.berths.length}개 선석` : c.block.berths.map(bname).join(', ')} 사용 불가 ${fmt(c.block.start)} ~ ${fmt(c.block.end)} (${c.block.kind === 'WEATHER' ? '접안 금지' : '설비'})`
  if (c.type === 'fix') return `${vname(c.vid)} ${bname(c.bid)} ${fmt(c.etb)} 접안 고정`
  if (c.type === 'param') return `${c.label} ${c.to}${c.unit}`
  return '-'
}

/** 계획 조건(draft)에 change를 넣거나(on) 뺀다(off). 반영한 것은 incId로 표시해 되돌릴 수 있게 한다 */
export function applyChange(d, inc, on) {
  const c = inc.change
  if (!c) return
  if (c.type === 'eta') {
    const v = d.vessels.find((x) => x.id === c.vid)
    if (v) v.eta = on ? c.to : c.from
  } else if (c.type === 'block') {
    d.blocks = d.blocks.filter((b) => b.incId !== inc.id)
    if (on) d.blocks.push({ ...c.block, id: `blk-${inc.id}`, incId: inc.id, source: `${inc.from}: ${inc.title}` })
  } else if (c.type === 'fix') {
    d.fixes = d.fixes.filter((f) => f.vid !== c.vid)
    if (on) d.fixes.push({ vid: c.vid, bid: c.bid, etb: c.etb, incId: inc.id })
  } else if (c.type === 'param') {
    const [g, k] = c.path
    if (on) (d.params[g] ??= {})[k] = c.to
    else if (d.params[g]) { delete d.params[g][k]; if (!Object.keys(d.params[g]).length) delete d.params[g] }
  }
}
