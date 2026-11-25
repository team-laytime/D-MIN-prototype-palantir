// 실데이터셋 → 화면 모델 (11-24: 목 데이터를 모두 걷어내고 데이터 팀 묶음 + 팀 엔진 결과로 시작)
//  - 데이터셋 파일: public/data/<id>.json  (tools/real-data/build_dataset.py가 만든다, 비공개라 저장소에 없음)
//  - request = 팀 엔진 PlanRequest 그대로, results[] = 프리셋마다 엔진 PlanResponse
//  - 계획 조건을 고치면 request를 고쳐 엔진 API(/engine/plans, vite가 127.0.0.1:8000으로 넘김)에 다시 보낸다.
import { toIso, toMin } from './time.js'
import { BERTH_GEO } from './seaRoutes.js'
import { seedIncidents } from './incidents.js'
import { tankMargin } from './presets.js'

export async function loadIndex() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/index.json`)
  if (!r.ok) throw new Error('데이터셋 목록(public/data/index.json)이 없습니다. tools/real-data/build_dataset.py로 먼저 만드십시오.')
  return r.json()
}
export async function loadDataset(id) {
  const r = await fetch(`${import.meta.env.BASE_URL}data/${id}.json`)
  if (!r.ok) throw new Error(`데이터셋 ${id}를 불러오지 못했습니다 (${r.status})`)
  const ds = await r.json()
  ds.vesselRef = await loadVesselRef()
  return ds
}

// 11-25 호출부호별 선박명, 제원표 (D-MIN-dataset data/reference → tools/real-data/build_vessel_ref.py → public/data/vessel-ref.json).
//   파일이 없으면 빈 표로 두고 화면은 호출부호를 이름 대신 쓴다.
let refCache = null
async function loadVesselRef() {
  if (refCache) return refCache
  const r = await fetch(`${import.meta.env.BASE_URL}data/vessel-ref.json`).catch(() => null)
  refCache = r?.ok ? await r.json().catch(() => ({})) : {}
  return refCache
}

// ── 부두 ─────────────────────────────────────────────────────────────
// 위치: 팀 portwise 프로토타입과 같은 SK 울산 부두 좌표(공개 자료 수준). 가스부두는 공개 좌표가 없어 SK8 남쪽에 둔 근사 위치다.
const PIER_POS = {
  1: [35.5027, 129.3632], 2: [35.4986, 129.3658], 3: [35.4946, 129.3829], 4: [35.4927, 129.3842],
  5: [35.4892, 129.3863], 6: [35.4855, 129.3907], 7: [35.4824, 129.3907], 8: [35.4791, 129.3906],
  BUOY: [35.4483, 129.4236], GAS: [35.4762, 129.3893],
}
export function pierOf(id) {
  if (id.startsWith('BUOY')) return 'BUOY'
  if (id.startsWith('GAS')) return 'GAS'
  return id.split('-')[0]
}
export const pierName = (p) => (p === 'BUOY' ? '부이' : p === 'GAS' ? '가스부두' : `SK ${p}부두`)
export function berthName(id) {
  if (id.startsWith('BUOY')) return `${id.slice(4)}번 부이`
  if (id.startsWith('GAS')) return `가스부두 ${id.slice(3)}`
  return id.includes('-') ? `SK ${pierOf(id)}부두 ${id}` : `SK ${id}부두`
}
export const berthCode = (id) => (id.startsWith('BUOY') ? `B${id.slice(4)}` : id.startsWith('GAS') ? `G${id.slice(3)}` : id)
// 11-25 화면에 보이는 선석 이름(풀어 쓴 것): 2-1 → SK2부두 1번, 3 → SK3부두, BUOY2 → 부이 2번, GAS1 → 가스부두 1번
export const berthLabel = (id) => {
  if (id.startsWith('BUOY')) return `부이 ${id.slice(4)}번`
  if (id.startsWith('GAS')) return `가스부두 ${id.slice(3)}번`
  const [pier, n] = id.split('-')
  return n ? `SK${pier}부두 ${Number(n)}번` : `SK${pier}부두`
}

// ── 화물·방향 ─────────────────────────────────────────────────────────
export const CARGO = {
  FO: '연료유', DSL: '경유', 'R-G': '휘발유', SULF: '유황', YUBASE: '윤활기유', JET: '항공유', MDO: '선박용 경유', AROMA: '방향족',
  KERO: '등유', ASPH: '아스팔트', SLO: '슬롭유', CRUDE: '원유', PROPYLENE: '프로필렌', TOL: '톨루엔', NAPH: '나프타', PX: '파라자일렌',
  SRFO: '저유황 연료유', BENZENE: '벤젠', XYL: '자일렌', SM: '스티렌', ETHYLENE: '에틸렌', '1.3 BD': '부타디엔', 'BT-MIX': 'BT 혼합',
  BBR: 'BBR', 'O-1': 'O-1', 'C-HX': '사이클로헥산',
}
export const cargoName = (g) => CARGO[g] ?? g
// biz: IM 수입 · EX 수출 · DI 국내 입고 · DO 국내 출고. 탱크 기준으로는 IM·DI가 들어오고(양하) EX·DO가 나간다(선적).
export const BIZ = { IM: '수입', EX: '수출', DI: '국내 입고', DO: '국내 출고' }
export const isIn = (biz) => biz === 'IM' || biz === 'DI'

// 11-25 탱크 묶음: 팀 엔진 product_direction.tank_group과 같은 규칙(원유 / 반입 원료 / 양방향 / 제품 분류별 반출)
const DIR_IN = new Set(['CRUDE', 'L/S', '기유(양하)', 'MEOH', 'C9+ARO (JX)', 'UCO'])
const DIR_BOTH = new Set(['NAPH', 'LPG', 'BUTENE', 'FO'])
const CLASS_LABEL = { CR: '원유', PP: '석유제품', PC: '화학', LB: '윤활유', SP: '특수' }
export const tankGroupOf = (cargo, pclass) => (pclass === 'CR' ? '원유' : DIR_IN.has(cargo) ? '반입 원료' : DIR_BOTH.has(cargo) ? '양방향' : `${CLASS_LABEL[pclass] ?? pclass} 반출`)

export const vesselIdOf = (v) => `${v.call_sign}-${v.entry_year}-${v.voyage}-${v.stay_seq}`

/** 데이터셋 → 시나리오(화면 입력 모델). 엔진 요청(request)은 그대로 들고 있다가 다시 계산할 때 쓴다. */
export function buildScen(ds) {
  const req = ds.request
  const first = ds.results[0].response
  const planIds = new Set(first.plan.vessels.map((p) => p.vessel_id))
  const prods = req.master.products
  const piers = {}
  const berths = req.master.berths.map((b) => {
    const pier = pierOf(b.berth)
    const k = (piers[pier] = (piers[pier] ?? -1) + 1)
    const base = PIER_POS[pier] ?? PIER_POS[8]
    const pos0 = pier === 'BUOY' ? (b.berth === 'BUOY2' ? [35.4483, 129.4236] : [35.44, 129.43]) : [base[0] - k * 0.0011, base[1]]
    // 11-25 지도 위치는 바다 경로와 같은 표(seaRoutes.js BERTH_GEO): 계류점(moor)은 늘 물 위
    const geo = BERTH_GEO[b.berth]
    const pos = geo?.pos ?? pos0
    return {
      id: b.berth, name: berthName(b.berth), code: berthCode(b.berth), label: berthLabel(b.berth), pier, pierName: pierName(pier),
      maxDwt: b.max_dwt, maxDraft: b.max_draft, maxLoa: b.max_loa, minLoa: b.min_loa, size: b.size,
      products: [...new Set(prods.filter((p) => p.berth === b.berth).map((p) => cargoName(p.group)))],
      pos, moor: geo?.moor ?? [pos[0], pos[1] + 0.0019], approxPos: pier === 'GAS',
    }
  })
  const refs = ds.vesselRef ?? {}
  const ref = (v) => refs[v.call_sign] ?? {}
  const vessels = req.vessels.filter((v) => planIds.has(vesselIdOf(v))).map((v) => ({
    // 11-25 화면에는 선박명(한글)을 쓴다. 묶음에는 선박명 칸이 없어 호출부호로 선박명표(vesselRef)에서 찾고, 없으면 호출부호.
    id: vesselIdOf(v), name: ref(v).nameKo ?? ref(v).nameEn ?? v.call_sign, shipName: ref(v).nameKo ?? null, nameEn: ref(v).nameEn ?? null,
    flag: ref(v).flag ?? null, web: ref(v).web ?? null, usualBerths: ref(v).usualBerths ?? null,
    callSign: v.call_sign, voyage: v.voyage,
    cls: v.ship_class, vtype: v.vessel_type, cargo: v.cargo_group, product: cargoName(v.cargo_group), material: v.material_code,
    biz: v.biz, dir: BIZ[v.biz] ?? v.biz, in: isIn(v.biz),
    dwt: v.dwt, grt: v.grt, draft: v.draft, loa: v.loa, ton: v.qty, workHours: v.work_hours,
    tank: tankGroupOf(v.cargo_group, v.product_class),
    eta: toMin(v.eta), nor: toMin(v.nor_tender),
    laycan: v.laycan_from ? { from: toMin(v.laycan_from), to: toMin(v.laycan_to), case: v.laycan_case } : null,
    contract: { laytimeH: v.laytime_h, rateUsd: v.demurrage_rate?.amount ?? 0, noticeH: v.notice_hours ?? 6, weatherPct: v.weather_deduct_pct ?? 50, cfr: v.cfr },
    rates: v.rate_t_per_h ?? {}, compat: Object.keys(v.rate_t_per_h ?? {}),
    actual: v.actual_berth ? { bid: v.actual_berth, etb: toMin(v.berthed), etu: toMin(v.unberthed) } : null,
  })).sort((a, b) => a.eta - b.eta)
  // 같은 배가 기간 안에 여러 번 들어오면 이름이 겹친다. 겹칠 때만 항차를, 그래도 겹치면 접안 순번을 붙인다.
  const count = (key) => { const d = {}; for (const v of vessels) d[key(v)] = (d[key(v)] ?? 0) + 1; return d }
  const d1 = count((v) => v.name)
  for (const v of vessels) if (d1[v.name] > 1) v.name = `${v.name} ${Number(v.voyage)}항차`
  const d2 = count((v) => v.name)
  for (const v of vessels) if (d2[v.name] > 1) v.name = `${v.name} (${Number(v.id.split('-').at(-1))}번째 접안)`
  const t0 = toMin(first.window.start)
  const wind = (req.weather ?? []).map((w) => ({ t: toMin(w.time), ms: w.wind_ms, thunder: w.thunder, typhoon: w.typhoon })).filter((w) => w.t >= t0 - 24 * 60)
  // 11-25 생산계획과 탱크: 최적화 팀 후보정(make_tank_plan)으로 만든 주별 생산계획(요청 production_plan)과
  // 엔진이 1/1부터 실적으로 이어 센 기준 시각 재고(응답 tanks의 initial_t). 계획 입력이라 고치지 않는다.
  const win1 = toMin(first.window.end)
  const weekOf = (d) => toMin(`${d}T00:00:00+09:00`)
  const tanks = (first.tanks ?? []).map((t) => {
    const rows = (req.production_plan ?? []).filter((w) => w.tank === t.tank).map((w) => ({ from: weekOf(w.week_start), rate: w.rate_t_per_h })).sort((a, b) => a.from - b.from)
    const cur = rows.filter((w) => w.from <= t0).at(-1)
    const weeks = [cur, ...rows.filter((w) => w.from > t0 && w.from < win1)].filter(Boolean)
    // 11-25 재고 흐름 = 기존 계획(엔진 baseline, 다른 스케줄러가 미리 세워 둔 계획으로 가정)대로 갔을 때. 최적화 결과와 무관한 계획 입력이다.
    const base = t.baseline_levels_t ? { start: toMin(t.start), step: t.step_min ?? 60, lv: t.baseline_levels_t } : null
    return { name: t.tank, count: t.tanks, cap: t.capacity_t, start: t.initial_t, safeMin: t.safe_min_t, safeMax: t.safe_max_t, weeks, base }
  })
  // 11-25 기준 시각에 이미 접안해 작업 중인 배(계획 대상 아님): 실적 접안 < T < 실적 이안 (T에 접안하는 배는 계획 대상). 엔진도 이 기록으로 선석이 비는 시각을 잡는다.
  const berthIds = new Set(berths.map((b) => b.id))
  const occupied = req.vessels
    .filter((v) => v.berthed && v.unberthed && toMin(v.berthed) < t0 && toMin(v.unberthed) > t0 && berthIds.has(v.actual_berth))
    .map((v) => ({ bid: v.actual_berth, name: ref(v).nameKo ?? ref(v).nameEn ?? v.call_sign, product: cargoName(v.cargo_group), dir: BIZ[v.biz] ?? v.biz, etb: toMin(v.berthed), etu: toMin(v.unberthed) }))
    .sort((a, b) => a.etu - b.etu)
  return {
    id: ds.id, name: ds.label, summary: ds.source, bundle: ds.bundle, start: ds.start, days: ds.days, builtAt: ds.built_at,
    // 11-25 계획 대상이 아닌 배(기준 시각에 작업 중인 배 등)도 리스크 문구에 나온다. 호출부호 → 선박명
    nameByCall: Object.fromEntries(Object.entries(refs).map(([cs, r]) => [cs, r.nameKo ?? r.nameEn]).filter(([, n]) => n)),
    meta: ds.meta, berths, vessels, wind, tanks, occupied, nightPilot: first.params?.night_pilot ?? null,
    windDefault: first.params?.weather?.thresholds_ms ?? null,
    window: { start: t0, end: toMin(first.window.end) },
    // 스케줄러가 고치는 값: 선박 ETA(vessels[].eta), 부두 사용 불가(blocks), 고정 선박(fixes), 엔진 파라미터(params)
    blocks: [], fixes: [], params: {},
    // 11-25 계획 조건을 바꾸는 받은 메일(시연용, 실제 선박 · 부두로 만듦). 「반영」하면 계획 조건에 들어간다(lib/incidents.js)
    incidents: seedIncidents({ vessels, berths, window: { start: t0, end: toMin(first.window.end) } }, first.plan.vessels, first.baseline?.vessels ?? []),
    request: req,
    presets: ds.results.map((r) => r.preset),
  }
}

/** 엔진 PlanResponse → 화면의 후보(sim) */
export function toSim(resp, preset, id) {
  const p = resp.plan
  return {
    id, label: `후보 ${id}`, preset, status: resp.status, proven: p.proven, total: p.total_cents, bound: p.bound_cents,
    solveSec: p.solve_seconds ?? resp.elapsed_seconds, moves: p.moves, notes: resp.notes ?? [], dropped: resp.dropped ?? [],
    tankViolation: p.tank_violation ?? [], tanks: resp.tanks ?? [], requirements: p.requirements ?? [],
    placements: p.vessels.map(placement).sort((a, b) => a.etb - b.etb),
    baseline: resp.baseline ? { total: resp.baseline.total_cents ?? resp.baseline.vessels.reduce((s, v) => s + v.demurrage_cents, 0), placements: resp.baseline.vessels.map(placement) } : null,
  }
}
function placement(v) {
  const eta = toMin(v.eta), etb = toMin(v.etb)
  return {
    vid: v.vessel_id, bid: v.berth, fixed: v.fixed, eta, etb, etu: toMin(v.etu), ws: toMin(v.work_start), wf: toMin(v.work_end),
    ls: toMin(v.laytime_start), le: toMin(v.laytime_end), hose: toMin(v.hose_off), night: v.night_berthing,
    waitMin: Math.max(0, etb - eta),
    dem: { cents: v.demurrage_cents, excessMin: v.demurrage_minutes, weatherMin: v.weather_minutes },
  }
}

/** 프리셋별 응답들 → 체선료 낮은 순서로 후보 A·B·C */
export function rankSims(results) {
  return results
    .map((r) => ({ r, total: r.response.plan.total_cents }))
    .sort((a, b) => a.total - b.total || (a.r.response.plan.moves - b.r.response.plan.moves))
    .map(({ r }, i) => toSim(r.response, r.preset, String.fromCharCode(65 + i)))
}

/** 계획 조건(scen)으로 엔진 요청을 다시 만든다: ETA·부두 사용 불가·고정·파라미터 반영 */
export function buildRequest(scen, preset) {
  const req = structuredClone(scen.request)
  const eta = Object.fromEntries(scen.vessels.map((v) => [v.id, v.eta]))
  for (const v of req.vessels) {
    const id = vesselIdOf(v)
    if (id in eta && toMin(v.eta) !== eta[id]) v.eta = toIso(eta[id])
  }
  req.blocks = scen.blocks.map((b) => ({ berths: b.berths, start: toIso(b.start), end: toIso(b.end), kind: b.kind }))
  req.fixes = scen.fixes.map((f) => ({ vessel_id: f.vid, berth: f.bid, etb: toIso(f.etb) }))
  req.params = merge(merge(req.params ?? {}, preset.params ?? {}), scen.params ?? {})
  req.name = preset.label
  req.request_id = preset.id
  return req
}
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(o[k] ?? {}, v) : v; return o }

/** 엔진 API로 다시 계산 (후보 프리셋마다 한 번, 동시에) */
export async function recalc(scen, signal) {
  const health = await fetch('/engine/health', { signal }).catch(() => null)
  if (!health?.ok) throw new Error('엔진 서버(127.0.0.1:8000)에 연결되지 않았습니다. 엔진 저장소에서 `python -m berth_sim.api`로 띄우십시오.')
  const results = await Promise.all(scen.presets.map(async (preset) => {
    const r = await fetch('/engine/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildRequest(scen, preset)), signal })
    const body = await r.json()
    if (!r.ok) throw new Error(`${preset.label}: ${body.detail ?? body.title ?? r.status}`)
    return { preset, response: body }
  }))
  return results
}
