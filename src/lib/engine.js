// 프로토타입용 규칙 평가기. 계산식은 팀 최적화 엔진 D-MIN-optimization(berth_sim)을 그대로 옮겼다.
//   ETB 산정: step1_prev_fix(① 이전 선박 · Direction/Switching), step2_night_pilot(② 야간 도선),
//             step3_berth_block(③-3 사용자 설정 부두 제약: 기상)
//   ETB 이후: after_etb s1~s12 (작업시작 → 작업완료 → ETU · 호스분리 → ETANR → 정박개시 → 정박종료 → 기상체선 → 체선료)
//   숫자는 params.default.json 기본값과 같다(PARAMS). 실제 구현에서는 Python 엔진 API가 맡는다.
import { WEATHER_CLAUSE } from './scenarios.js'

// params.default.json 중 이 화면이 쓰는 부분. 바꾸면 팀 엔진 기본값과 어긋나므로 같이 고친다.
export const PARAMS = {
  // 부두 그룹 → [Switching, Direction] 시간 (shifting.hours)
  shifting: { '#1~2': [1.5, 1.0], '#3': [1.5, 1.0], '#4': [1.0, 1.0], '#5-5': [1.0, 1.0], 'GAS1/2': [1.0, 1.0], '#6': [2.5, 1.5], '#7': [2.5, 1.5], '#8': [2.5, 1.5], Buoy: [1.0, 1.5] },
  nightPilot: { grtAlways: 75000, grtMin: 30000, draftMin: 10.5, grtPob2h: 50000, pobSmallH: 1.5, pobLargeH: 2.0, nightStartMin: 120, releaseMin: 480 },
  afterEtb: {
    etbToStartMin: 60, finishToEtuMin: 120, finishToHoseOffMin: 30, noticeH: 6,
    laycanFromMin: 360, laycanFromMinDaylight: 420, daylightMorningMin: 420,
    daylightTypes: ['원유선', '석유제품선'], noDaylightTypes: ['특수제품선', '윤활유제품선', '화학제품선'],
    crudeNoCfrLaytimePct: 50,
  },
}

export const RULES = {
  'ETB-DIRECTION': { label: '부두가 비어 있으면 ETA + Direction' },
  'ETB-SWITCHING': { label: '앞 선박 ETU + Switching' },
  'NIGHT-PILOT': { label: '야간 도선 제한 (02~08시, Last POB 이후 도착)' },
  'BERTH-BLOCK-WX': { label: '기상 부두 제약: 종료 + Direction 뒤 접안' },
  'WORK-START': { label: '작업시작 = ETB + 1시간' },
  'WORK-FINISH': { label: '작업완료 = 작업시작 + 물량 ÷ 하역 속도(배 × 부두)' },
  'HOSE-OFF': { label: '호스분리 = 작업완료 + 30분, ETU = 작업완료 + 2시간' },
  ETANR: { label: 'ETANR = NVL(N/R Tender, ETA)' },
  'LT-EARLY': { label: 'Early Loading: ETANR · ETB < LayCan From → ETB' },
  'LT-MISS': { label: 'LayCan Miss: ETANR > LayCan To → ETB' },
  'LT-LAYCAN': { label: 'ETANR < LayCan From → LayCan From 날 07시(Daylight) · 06시' },
  'LT-NOTICE': { label: '정박개시 = ETANR + 계약 시간, ETB가 더 이르면 ETB' },
  'LT-MORNING': { label: 'Daylight: 일출 전 NOR → 그날 07시, 일몰 뒤 NOR → 다음 날 07시 (ETB가 더 이르면 ETB)' },
  'LT-END': { label: '정박종료 = 정박개시 + Laytime (원유선 · CFR 아님은 50%)' },
  'WX-DED-FULL': { label: '기상체선 시간 전부 공제' },
  'WX-DED-HALF': { label: '기상체선 시간 50% 공제 (선주 · SK 절반씩)' },
  'WX-DED-NONE': { label: '기상체선 시간 공제 없음' },
  'DEM-PRORATA': { label: '체선료 = (호스분리 − 정박종료 − 기상 공제) × 일 체선료 ÷ 24, 선박별 센트 HALF_UP' },
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
const dayStart = (t) => Math.floor(t / 1440) * 1440
const tod = (t) => ((t % 1440) + 1440) % 1440

// 일출 · 일몰: env.days(팀 엔진 sun.py 근사식으로 뽑은 값)에서 그날 값을 찾는다.
function sunOf(env, t) {
  const d = env.days.find((x) => dayStart(x.sunrise) === dayStart(t))
  if (d) return d
  const near = env.days.reduce((a, b) => (Math.abs(dayStart(b.sunrise) - dayStart(t)) < Math.abs(dayStart(a.sunrise) - dayStart(t)) ? b : a))
  const shift = dayStart(t) - dayStart(near.sunrise)
  return { sunrise: near.sunrise + shift, sunset: near.sunset + shift }
}

export function compatibleBerths(v, scen) {
  return scen.berths
    .filter((b) => b.products.includes(v.product) && v.dwt <= b.maxDwt && v.draft <= b.maxDraft)
    .map((b) => b.id)
}

/** 부두별 Switching · Direction (분). 계획 여유(env.switchBufferMin)는 Switching에만 더한다. */
export function shiftMin(b, env) {
  const [sw, dir] = PARAMS.shifting[b.shiftGroup]
  return { sw: sw * 60 + (env.switchBufferMin ?? 0), dir: dir * 60 }
}

/** 배 × 부두 하역 속도(t/h). 팀 엔진은 전처리(berth_prep)가 과거 실적으로 만들어 넣는 값이다. */
export const rateOf = (v, bid) => v.rates?.[bid] ?? v.pump

/** ETB → 작업시작 · 작업완료 · 호스분리 · ETU (after_etb s1~s4). */
export function afterEtb(v, bid, etb) {
  const a = PARAMS.afterEtb
  const rate = rateOf(v, bid)
  const workStart = etb + a.etbToStartMin
  const pumpMin = Math.round((v.ton / rate) * 60)
  const finish = workStart + pumpMin
  return { rate, pumpMin, workStart, finish, hoseOff: finish + a.finishToHoseOffMin, etu: finish + a.finishToEtuMin }
}

/** ② 야간 도선 제한 대상: GRT 7.5만 이상, 또는 GRT 3만 이상 · 수입선 · 흘수 10.5m 이상. */
export function nightPilotTarget(v) {
  const n = PARAMS.nightPilot
  return v.grt >= n.grtAlways || (v.grt >= n.grtMin && v.dir === '수입' && v.draft >= n.draftMin)
}

export function lastPob(v, env) {
  const n = PARAMS.nightPilot
  return sunOf(env, v.eta).sunset - (v.grt <= n.grtPob2h ? n.pobSmallH : n.pobLargeH) * 60
}

function nightPilot(v, etb, env) {
  if (!nightPilotTarget(v)) return etb
  const n = PARAMS.nightPilot
  if (v.eta >= lastPob(v, env)) {
    const release = dayStart(v.eta) + 1440 + n.releaseMin
    if (etb < release) return release
  }
  const m = tod(etb)
  if (m >= n.nightStartMin && m < n.releaseMin) return dayStart(etb) + n.releaseMin
  return etb
}

// ③-3 기상 부두 제약(전 부두, 사용자 입력): 후보 ETB가 [시작, 종료 + Direction)에 들면 종료 + Direction.
function weatherBlock(etb, dir, env) {
  const w = env.weather
  if (w && etb >= w.start && etb < w.end + dir) return w.end + dir
  return etb
}

/** ①~③ ETB 산정. 조정기를 ETB가 더 바뀌지 않을 때까지 반복한다(모든 제약 AND). */
export function earliestEtb(v, b, prevEtu, env) {
  const { sw, dir } = shiftMin(b, env)
  const ready = prevEtu === null ? null : prevEtu + sw
  const binding = ready !== null && v.eta + dir <= ready ? 'ETB-SWITCHING' : 'ETB-DIRECTION'
  const from = binding === 'ETB-SWITCHING' ? ready : v.eta + dir
  let etb = from
  const blockers = []
  for (let i = 0; i < 20; i++) {
    const start = etb
    for (const [rule, fn] of [['NIGHT-PILOT', (t) => nightPilot(v, t, env)], ['BERTH-BLOCK-WX', (t) => weatherBlock(t, dir, env)]]) {
      const next = fn(etb)
      if (next > etb) {
        blockers.push({ rule, from: etb, to: next })
        etb = next
      }
    }
    if (etb === start) break
  }
  return { etb, ready, from, binding, blockers, sw, dir }
}

/** 정박개시 (after_etb s5~s8). LayCan이 없는 배(양하)는 LayCan 분기를 건너뛴다. */
export function laytimeStart(v, etb, env) {
  const a = PARAMS.afterEtb
  const etanr = v.nrTender ?? v.eta
  const daylight = a.daylightTypes.includes(v.vesselType)
  const notice = (v.contract.norTurnH ?? a.noticeH) * 60
  const lc = v.contract.laycan
  if (lc) {
    if (etanr < lc.from && etb < lc.from) return { at: etb, rule: 'LT-EARLY', etanr, daylight, reason: 'Early Loading: ETANR, ETB < LayCan From → ETB' }
    if (etanr > lc.to) return { at: etb, rule: 'LT-MISS', etanr, daylight, reason: 'LayCan Miss: ETANR > LayCan To → ETB' }
    if (etanr < lc.from) {
      const at = dayStart(lc.from) + (daylight ? a.laycanFromMinDaylight : a.laycanFromMin)
      return { at, rule: 'LT-LAYCAN', etanr, daylight, reason: `ETANR < LayCan From → LayCan From 날 ${daylight ? '07' : '06'}:00` }
    }
  }
  const why = lc ? 'LayCan 안 도착' : 'LayCan 없음(양하)'
  let start
  let rule = 'LT-NOTICE'
  let reason
  if (!daylight) {
    start = etanr + notice
    reason = `${why} → ETANR + ${notice / 60}h`
  } else {
    const s = sunOf(env, etanr)
    if (etanr > s.sunrise && etanr < s.sunset) {
      start = etanr + notice
      reason = `${why} · 일출 < ETANR < 일몰 → ETANR + ${notice / 60}h`
    } else if (etanr <= s.sunrise) {
      start = dayStart(etanr) + a.daylightMorningMin
      rule = 'LT-MORNING'
      reason = `${why} · ETANR <= 일출 → ETANR 날 07:00`
    } else {
      start = dayStart(etanr) + 1440 + a.daylightMorningMin
      rule = 'LT-MORNING'
      reason = `${why} · ETANR >= 일몰 → 다음 날 07:00`
    }
  }
  if (etb < start) return { at: etb, rule, etanr, daylight, capped: true, reason: `${reason} → ETB가 더 이르므로 ETB` }
  return { at: start, rule, etanr, daylight, reason }
}

// until을 주면 그 시각까지 쌓인 값을 낸다(지도 시간 슬라이더용). 기본은 호스분리까지의 최종값이다.
// etu는 ETU(= 작업완료 + 2h)를 받는다. 호스분리 = 작업완료 + 30분 = ETU − 90분.
export function demurrage(v, etb, etu, env, until = etu) {
  const a = PARAMS.afterEtb
  const c = v.contract
  const clause = WEATHER_CLAUSE[c.weather]
  const hoseOff = etu - (a.finishToEtuMin - a.finishToHoseOffMin)
  const ls = laytimeStart(v, etb, env)
  const ltStart = ls.at
  const crudeHalf = v.vesselType === '원유선' && !c.cfr
  const allowMin = c.laytimeH * 60 * (crudeHalf ? a.crudeNoCfrLaytimePct / 100 : 1)
  const ltEnd = ltStart + allowMin
  const end = Math.min(until, hoseOff)
  const usedMin = Math.max(0, end - ltStart)
  const w = env.weather
  // 기상체선 시간 = 기상 제약 구간이 [정박개시, 호스분리]와 겹치는 시간 (s10, 2026-11-24 현업 확인)
  const wxOverlap = w ? overlap(ltStart, end, w.start, w.end) : 0
  const wxDeduct = wxOverlap * clause.ratio
  const countedMin = usedMin - wxDeduct
  const excessMin = Math.max(0, end - ltEnd - wxDeduct)
  const rateCents = c.rateUsd * 100
  // 0.5분 단위까지 정수로 다루고, 센트 반올림(HALF_UP)은 선박마다 한 번만 한다.
  const num = Math.round(excessMin * 2) * rateCents
  const den = 2880
  const cents = Math.floor((2 * num + den) / (2 * den))
  return {
    ltStart, ltStartRule: ls.rule, ltReason: ls.reason, etanr: ls.etanr, daylight: ls.daylight, ltEnd, crudeHalf,
    etb, etu, hoseOff, usedMin, wxOverlap, wxDeduct, clause, countedMin, allowMin, excessMin, rateCents, cents,
    rules: ['ETANR', ls.rule, 'LT-END', clause.rule, 'DEM-PRORATA'],
  }
}

// 시각 t에 선박이 어디서 무엇을 하는지와 그때까지 쌓인 체선료.
export function stateAt(sim, scen, t) {
  const v = Object.fromEntries(scen.vessels.map((x) => [x.id, x]))
  return sim.placements.map((p) => {
    const vs = v[p.vid]
    const phase = t < vs.eta ? 'coming' : t < p.etb ? 'waiting' : t < p.etu ? 'berthed' : 'left'
    const cents = phase === 'coming' ? 0 : demurrage(vs, p.etb, p.etu, scen.env, t).cents
    return { p, v: vs, phase, cents, ticking: cents > 0 && phase !== 'left', progress: phase === 'berthed' ? (t - p.etb) / (p.etu - p.etb) : 0 }
  })
}

// order: 접안 우선순위, assign: 선박→부두. assign이 없으면 도착순 기준안처럼 가장 빨리 댈 수 있는 부두를 고른다.
export function simulate(order, assign, scen, compat) {
  const free = {}
  const prev = {}
  for (const b of scen.berths) {
    free[b.id] = b.occupiedUntil ?? null
    prev[b.id] = b.occupiedBy
  }
  const byId = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  const berthById = Object.fromEntries(scen.berths.map((b) => [b.id, b]))
  const placements = []
  for (const vid of order) {
    const v = byId[vid]
    const options = assign ? [assign[vid]] : compat[vid]
    let best = null
    for (const bid of options) {
      const r = earliestEtb(v, berthById[bid], free[bid], scen.env)
      const work = afterEtb(v, bid, r.etb)
      const cand = { vid, bid, ...r, ...work, prev: prev[bid] }
      if (!best || cand.etb < best.etb || (cand.etb === best.etb && cand.etu < best.etu)) best = cand
    }
    if (!best) return null
    best.dem = demurrage(v, best.etb, best.etu, scen.env)
    best.waitMin = best.etb - v.eta
    placements.push(best)
    free[best.bid] = best.etu
    prev[best.bid] = byId[vid].name
  }
  return {
    order: [...order],
    assign: Object.fromEntries(placements.map((p) => [p.vid, p.bid])),
    placements,
    total: placements.reduce((s, p) => s + p.dem.cents, 0),
  }
}

function permutations(arr) {
  const out = []
  const a = [...arr]
  const c = new Array(a.length).fill(0)
  out.push([...a])
  let i = 0
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 ? c[i] : 0
      ;[a[j], a[i]] = [a[i], a[j]]
      out.push([...a])
      c[i]++
      i = 0
    } else {
      c[i] = 0
      i++
    }
  }
  return out
}

function combos(ids, compat) {
  let acc = [{}]
  for (const id of ids) {
    const next = []
    for (const partial of acc) for (const b of compat[id]) next.push({ ...partial, [id]: b })
    acc = next
  }
  return acc
}

const signature = (sim) =>
  sim.placements
    .slice()
    .sort((a, b) => a.bid.localeCompare(b.bid) || a.etb - b.etb)
    .map((p) => `${p.bid}:${p.vid}@${p.etb}`)
    .join('|')

export function fcfsOrder(scen) {
  return [...scen.vessels].sort((a, b) => a.eta - b.eta || a.id.localeCompare(b.id)).map((v) => v.id)
}

export function compatMap(scen) {
  return Object.fromEntries(scen.vessels.map((v) => [v.id, compatibleBerths(v, scen)]))
}

export function runSearch(scen, maxCandidates = 3) {
  const compat = compatMap(scen)
  const noBerth = scen.vessels.filter((v) => compat[v.id].length === 0)
  if (noBerth.length) return { error: `접안 가능한 부두가 없는 선박: ${noBerth.map((v) => v.name).join(', ')}` }

  const fcfs = simulate(fcfsOrder(scen), null, scen, compat)
  if (!fcfs) return { error: '도착순 기준안을 만들 수 없습니다. 입력값을 확인하십시오.' }
  const fcfsEtb = Object.fromEntries(fcfs.placements.map((p) => [p.vid, p]))

  const seen = new Map()
  let explored = 0
  const ids = scen.vessels.map((v) => v.id)
  const assigns = combos(ids, compat)
  for (const order of permutations(ids)) {
    for (const assign of assigns) {
      explored++
      const sim = simulate(order, assign, scen, compat)
      if (!sim) continue
      const sig = signature(sim)
      if (!seen.has(sig)) seen.set(sig, sim)
    }
  }
  const changed = (sim) =>
    sim.placements.filter((p) => p.bid !== fcfsEtb[p.vid].bid || p.etb !== fcfsEtb[p.vid].etb).map((p) => p.vid)

  const fcfsSig = signature(fcfs)
  // 도착순 기준안은 화면에서 뺐으므로(9110a3d) 기준안보다 싼 안만 남기지 않고, 도착순과 같은 안도 후보가 될 수 있다.
  const ranked = [...seen.entries()]
    .map(([sig, sim]) => ({ ...sim, sig, changed: changed(sim) }))
    .sort((a, b) => a.total - b.total || a.changed.length - b.changed.length || a.sig.localeCompare(b.sig))

  // 부두별 순서가 같은 안은 하나만 남기고, 이미 고른 안보다 모든 선박이 같거나 늦게 끝나는 안(지배되는 안)은 뺀다.
  const seq = (s) => s.placements.slice().sort((a, b) => a.bid.localeCompare(b.bid) || a.etb - b.etb).map((p) => `${p.bid}${p.vid}`).join('')
  const etuOf = (s) => Object.fromEntries(s.placements.map((p) => [p.vid, p.etu]))
  const dominated = (s, p) => {
    const a = etuOf(s)
    const b = etuOf(p)
    return Object.keys(a).every((k) => a[k] >= b[k])
  }
  const picked = []
  const seqSeen = new Set()
  for (const s of ranked) {
    if (seqSeen.has(seq(s))) continue
    if (picked.some((p) => dominated(s, p))) continue
    seqSeen.add(seq(s))
    picked.push(s)
    if (picked.length === maxCandidates) break
  }
  return {
    fcfs: { ...fcfs, sig: fcfsSig, changed: [], id: 'FCFS', label: '기준안 (도착순)' },
    candidates: picked.map((s, i) => ({ ...s, id: 'ABC'[i], label: `후보 ${'ABC'[i]}` })),
    explored,
    distinct: seen.size,
  }
}

// 후보 배치를 규칙과 하나씩 대조한다. 탐색 코드(earliestEtb)를 부르지 않고 따로 짜서 서로 검증한다.
export function validate(sim, scen) {
  const v = Object.fromEntries(scen.vessels.map((x) => [x.id, x]))
  const b = Object.fromEntries(scen.berths.map((x) => [x.id, x]))
  const w = scen.env.weather
  const n = PARAMS.nightPilot
  const out = []
  for (const p of sim.placements) {
    const vs = v[p.vid]
    const bs = b[p.bid]
    const { sw, dir } = shiftMin(bs, scen.env)
    if (!bs.products.includes(vs.product)) out.push(`${vs.name}: ${bs.name} 접안 불가 제품`)
    if (vs.dwt > bs.maxDwt || vs.draft > bs.maxDraft) out.push(`${vs.name}: ${bs.name} 제원 초과`)
    if (p.etb < vs.eta + dir) out.push(`${vs.name}: ETA + Direction 전 접안`)
    if (w && p.etb >= w.start && p.etb < w.end + dir) out.push(`${vs.name}: ${RULES['BERTH-BLOCK-WX'].label}`)
    if (nightPilotTarget(vs)) {
      const m = ((p.etb % 1440) + 1440) % 1440
      if (m >= n.nightStartMin && m < n.releaseMin) out.push(`${vs.name}: 야간 도선 제한 시간(02~08시) 접안`)
      if (vs.eta >= lastPob(vs, scen.env) && p.etb < Math.floor(vs.eta / 1440) * 1440 + 1440 + n.releaseMin) out.push(`${vs.name}: Last POB 뒤 도착인데 다음 날 08시 전 접안`)
    }
    const expectEtu = p.etb + PARAMS.afterEtb.etbToStartMin + Math.round((vs.ton / rateOf(vs, p.bid)) * 60) + PARAMS.afterEtb.finishToEtuMin
    if (p.etu !== expectEtu) out.push(`${vs.name}: ETU가 ETB + 1h + 물량/속도 + 2h와 다름`)
    if (bs.occupiedUntil !== null && p.etb < bs.occupiedUntil + sw) out.push(`${vs.name}: 기존 접안선과 겹침`)
  }
  for (const bid of Object.keys(b)) {
    const { sw } = shiftMin(b[bid], scen.env)
    const list = sim.placements.filter((p) => p.bid === bid).sort((x, y) => x.etb - y.etb)
    for (let i = 1; i < list.length; i++) {
      if (list[i].etb < list[i - 1].etu + sw) out.push(`${b[bid].name}: ${v[list[i - 1].vid].name}와 ${v[list[i].vid].name} Switching 부족`)
    }
  }
  return out
}

const nightOf = (t, env) => !env.days.some((d) => t >= d.sunrise && t < d.sunset)

export function risks(sim, scen) {
  const v = Object.fromEntries(scen.vessels.map((x) => [x.id, x]))
  const b = Object.fromEntries(scen.berths.map((x) => [x.id, x]))
  const P = sim.placements
  const w = scen.env.weather
  const out = []

  if (!w) {
    out.push({ key: 'weather', label: '날씨 급변', state: '해당 없음', evidence: '계산 기간 내 기상 악화 예보 없음.', alternative: '-', caution: '예보 갱신 시 재계산.' })
  } else {
    const near = P.filter((p) => Math.abs(p.etb - w.start) <= 180 || Math.abs(p.etb - w.end) <= 180)
    out.push(near.length
      ? { key: 'weather', label: '날씨 급변', state: '해당', at: w.start,
          evidence: `${near.map((p) => v[p.vid].name).join(', ')} 접안이 기상 악화 구간 경계 3시간 이내. 예보가 앞당겨지거나 길어지면 접안이 밀립니다.`,
          alternative: '기상 해제 직후 접안 순서를 미리 확정하고 도선사·예선 대기 요청.',
          caution: '단기예보 갱신(05·11·17·23시)마다 같은 조건으로 재계산해 순위 변동 확인.' }
      : { key: 'weather', label: '날씨 급변', state: '해당 없음', evidence: '기상 악화 구간 경계 3시간 이내 접안 없음.', alternative: '-', caution: '예보 갱신 시 재계산.' })
  }

  const maint = P.filter((p) => b[p.bid].facility.maintenance && overlap(p.etb, p.etu, b[p.bid].facility.maintenance.start, b[p.bid].facility.maintenance.end) > 0)
  const unknown = [...new Set(P.filter((p) => !b[p.bid].facility.known).map((p) => b[p.bid].name))]
  if (maint.length) {
    const m = b[maint[0].bid].facility.maintenance
    out.push({ key: 'facility', label: '설비', state: '해당', at: m.start,
      evidence: `${maint.map((p) => v[p.vid].name).join(', ')} 작업이 ${b[maint[0].bid].name} ${m.label}과 겹침.${unknown.length ? ` ${unknown.join(', ')} 설비 일정 미입력.` : ''}`,
      alternative: '점검을 작업 종료 이후로 조정하거나, 점검 중 로딩암 1기 기준으로 작업 시간을 늘려 재계산.',
      caution: '점검 중에도 펌프율이 같다고 가정한 계산입니다.' })
  } else if (unknown.length) {
    out.push({ key: 'facility', label: '설비', state: '판단 불가', evidence: `${unknown.join(', ')} 설비 점검 일정 미입력.`, alternative: '설비팀에 해당 기간 점검 일정 확인 후 입력.', caution: '확인 전에는 확정 대상에서 제외.' })
  } else {
    out.push({ key: 'facility', label: '설비', state: '해당 없음', evidence: '접안 기간과 겹치는 설비 점검 없음.', alternative: '-', caution: '-' })
  }

  const tankHits = scen.tanks.flatMap((t) => P.filter((p) => v[p.vid].dir === '수입' && v[p.vid].product === t.product && p.etb < t.readyAt && v[p.vid].ton > t.ullageTon).map((p) => ({ p, t })))
  out.push(tankHits.length
    ? { key: 'tank', label: '탱크', state: '해당', at: tankHits[0].p.etb,
        evidence: `${v[tankHits[0].p.vid].name} 하역량 ${v[tankHits[0].p.vid].ton.toLocaleString()}톤 > ${tankHits[0].t.product} 탱크 여유 ${tankHits[0].t.ullageTon.toLocaleString()}톤. ${tankHits[0].t.note}.`,
        alternative: '하역 속도를 낮춰 여유 확보 시각에 맞추거나, 여유 확보 이후 하역을 시작하는 후보와 비교.',
        caution: '하역 속도를 바꾸면 작업 종료 시각과 체선료가 달라지므로 재계산 필요.' }
    : { key: 'tank', label: '탱크', state: '해당 없음', evidence: '수입 선박 하역 시점 탱크 여유 충분.', alternative: '-', caution: '-' })

  const late = scen.urgent.map((u) => ({ u, p: P.find((p) => p.vid === u.vid) })).filter(({ u, p }) => p && p.etu > u.deadline)
  out.push(!scen.urgent.length
    ? { key: 'urgent', label: '긴급 출하', state: '판단 불가', evidence: '긴급 출하 계획 미입력.', alternative: '출하팀에 긴급 출하 여부 확인.', caution: '-' }
    : late.length
      ? { key: 'urgent', label: '긴급 출하', state: '해당', at: late[0].u.deadline,
          evidence: late.map(({ u, p }) => `${v[u.vid].name}: ${u.note} 납기 대비 ${Math.round((p.etu - u.deadline) / 60)}시간 지연.`).join(' '),
          alternative: '해당 선박을 앞당긴 후보와 체선료 차이 비교.', caution: '납기 위반 비용은 체선료 합계에 포함되지 않음.' }
      : { key: 'urgent', label: '긴급 출하', state: '해당 없음', evidence: `긴급 출하(${scen.urgent.map((u) => v[u.vid].name).join(', ')}) 납기 내 완료.`, alternative: '-', caution: '-' })

  const night = P.filter((p) => nightOf(p.etb, scen.env))
  out.push(night.length
    ? { key: 'safety', label: '현장 안전', state: '해당', at: Math.min(...night.map((p) => p.etb)),
        evidence: `야간 접안 ${night.length}건: ${night.map((p) => v[p.vid].name).join(', ')}.`,
        alternative: '야간 접안을 일출 이후로 미룬 후보와 체선료 차이 비교.',
        caution: '작업 지시 전 야간 도선·계류 인력 배치 확인.' }
    : { key: 'safety', label: '현장 안전', state: '해당 없음', evidence: '야간 접안 없음.', alternative: '-', caution: '-' })

  return out
}

// 같은 순서·부두 배정을 유지한 채 도착 시각과 기상 구간이 바뀌면 금액과 순위가 어떻게 되는지 본다.
export function sensitivity(target, all, scen) {
  const compat = compatMap(scen)
  const rankOf = (totals, id) => Object.entries(totals).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).findIndex(([k]) => k === id) + 1
  const baseTotals = Object.fromEntries(all.map((s) => [s.id, s.total]))
  const baseRank = rankOf(baseTotals, target.id)
  const cases = []
  for (const v of scen.vessels) {
    for (const d of [-360, 360]) {
      cases.push({ label: `${v.name} 도착 ${d > 0 ? '6시간 늦음' : '6시간 빠름'}`, patch: (s) => { s.vessels.find((x) => x.id === v.id).eta += d } })
    }
  }
  if (scen.env.weather) {
    cases.push({ label: '기상 악화 6시간 연장', patch: (s) => { s.env.weather.end += 360 } })
    cases.push({ label: '기상 악화 6시간 일찍 시작', patch: (s) => { s.env.weather.start -= 360 } })
  }
  return cases.map((c) => {
    const s2 = JSON.parse(JSON.stringify(scen)) // Vue 반응형 프록시도 복제할 수 있게
    c.patch(s2)
    const totals = {}
    for (const s of all) {
      const r = s.id === 'FCFS' ? simulate(fcfsOrder(s2), null, s2, compat) : simulate(s.order, s.assign, s2, compat)
      totals[s.id] = r ? r.total : Infinity
    }
    const after = totals[target.id]
    return { label: c.label, delta: after === Infinity ? null : after - target.total, rankBefore: baseRank, rankAfter: rankOf(totals, target.id) }
  }).sort((a, b) => (b.rankAfter !== b.rankBefore) - (a.rankAfter !== a.rankBefore) || Math.abs(b.delta ?? 1e15) - Math.abs(a.delta ?? 1e15))
}
