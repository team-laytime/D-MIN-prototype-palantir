// 실데이터셋 → 화면 모델 (11-24: 목 데이터를 모두 걷어내고 데이터 팀 묶음 + 팀 엔진 결과로 시작)
//  - 데이터셋 파일: public/data/<id>.json  (tools/real-data/build_dataset.py가 만든다, 비공개라 저장소에 없음)
//  - request = 팀 엔진 PlanRequest 그대로. 11-26부터 계산 결과(results)는 넣지 않는다: 처음 열 때 initialResults가
//    A → (A로 고른) B · C를 엔진으로 계산하고 브라우저 저장소에 남긴다(lib/cache.js). 다음부터는 저장된 결과로 바로 뜬다.
//  - 계획 조건을 고치면 request를 고쳐 엔진 API(/engine/plans, vite가 127.0.0.1:8000으로 넘김)에 다시 보낸다.
import { toIso, toMin } from './time.js'
import { cacheGet, cacheSet, hashText, versionOf } from './cache.js'
import { BERTH_GEO } from './seaRoutes.js'
import { seedIncidents } from './incidents.js'
import { BASE_PRESET, C_PRESET, chooseB, tankMargin } from './presets.js'

export async function loadIndex() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/index.json`)
  if (!r.ok) throw new Error('데이터셋 목록(public/data/index.json)이 없습니다. tools/real-data/build_dataset.py로 먼저 만드십시오.')
  return r.json()
}
/**
 * 데이터셋 열기. id = '<파일>@<기준 시각 YYYY-MM-DD HH:MM>' (11-26 1년치 파일 하나 + 화면에서 고른 기준 시각).
 *   1년치 파일에는 하역 속도가 없다: 고른 시각 T 전에 끝난 과거 실적으로 팀 전처리 API(POST /prep/rates)가 계산한다
 *   (엔진 요청을 만들던 berth_prep request와 같은 함수 rate_rows). 받은 값은 브라우저 저장소에 남긴다.
 *   '@'가 없으면 예전처럼 날짜별 파일을 그대로 연다.
 */
export async function loadDataset(id, signal) {
  const [file, start] = id.split('@')
  const base = await loadFile(file)
  if (!start) return { ...base, vesselRef: await loadVesselRef() }
  const startIso = kstIso(start)
  const rates = await ratesFor(base, startIso, signal)
  const vessels = base.request.vessels.map((v, i) => ({ ...v, rate_t_per_h: rates[i] }))
  return {
    id, label: `${start} 현재, ${base.days * 24}시간 계획`, bundle: base.bundle, start, days: base.days, source: base.source,
    meta: base.meta, request: { ...base.request, start: startIso, vessels }, built_at: base.built_at, vesselRef: await loadVesselRef(),
  }
}

export const scenarioIdOf = (file, start) => `${file}@${start}`
/** 'YYYY-MM-DD HH:MM'(KST) → '2025-11-09T00:00:00Z' (엔진 요청 start와 같은 모양) */
export const kstIso = (text) => new Date(`${text.replace(' ', 'T')}:00+09:00`).toISOString().replace('.000Z', 'Z')

const files = {}
function loadFile(file) {
  files[file] ??= fetch(`${import.meta.env.BASE_URL}data/${file}.json`).then(async (r) => {
    if (!r.ok) throw new Error(`데이터셋 ${file}를 불러오지 못했습니다 (${r.status})`)
    return r.json()
  }).catch((e) => { delete files[file]; throw e })
  return files[file]
}

// 기준 시각별 하역 속도 (전처리 지문 + 파일 + 기준 시각을 키로 저장). 반환: 선박 순서대로 {부두: t/h} | null
const prepVersion = () => versionOf('rates', '/prep/health', (b) => b?.model?.version)
async function ratesFor(base, startIso, signal) {
  const ver = await prepVersion()
  const key = ver && `rates:${ver}:${hashText(`${base.bundle}|${base.built_at}|${startIso}`)}`
  const hit = key && await cacheGet(key)
  if (hit) return hit
  const p = base.past_shipments
  const past = p.qty.map((q, i) => ({ vessel_code: p.vessel_code[i], material_code: p.material_code[i], berth: p.berth[i],
    work_start: `${p.work_start[i].replace(' ', 'T')}:00+09:00`, work_end: `${p.work_end[i].replace(' ', 'T')}:00+09:00`, qty: q }))
  const vessels = base.request.vessels.map((v) => ({ call_sign: v.call_sign, entry_year: v.entry_year, voyage: v.voyage, stay_seq: v.stay_seq,
    vessel_code: v.vessel_code, material_code: v.material_code, qty: v.qty }))
  const r = await fetch('/prep/rates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start: startIso, vessels, past_shipments: past }), signal })
    .catch((e) => { if (e.name === 'AbortError') throw e; return null })
  if (!r) throw new Error('전처리 서버(127.0.0.1:8001)에 연결되지 않았습니다. 엔진 저장소에서 `PREP_API_HOST=127.0.0.1 .venv/bin/python -m berth_prep serve`로 띄우십시오.')
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(`하역 속도를 계산하지 못했습니다: ${body?.detail ?? body?.title ?? r.status}`)
  const out = body.vessels.map((v) => (Object.keys(v.rate_t_per_h ?? {}).length ? v.rate_t_per_h : null))
  if (key) cacheSet(key, out)
  return out
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
export const pierName = (p) => (p === 'BUOY' ? '부이' : p === 'GAS' ? '가스부두' : `${p}부두`)
export function berthName(id) {
  if (id.startsWith('BUOY')) return `${id.slice(4)}번 부이`
  if (id.startsWith('GAS')) return `가스부두 ${id.slice(3)}`
  return id.includes('-') ? `${pierOf(id)}부두 ${id}` : `${id}부두`
}
export const berthCode = (id) => (id.startsWith('BUOY') ? `B${id.slice(4)}` : id.startsWith('GAS') ? `G${id.slice(3)}` : id)
// 11-25 화면에 보이는 선석 이름(풀어 쓴 것): 2-1 → SK2부두 1번, 3 → SK3부두, BUOY2 → 부이 2번, GAS1 → 가스부두 1번
export const berthLabel = (id) => {
  if (id.startsWith('BUOY')) return `부이 ${id.slice(4)}번`
  if (id.startsWith('GAS')) return `가스부두 ${id.slice(3)}번`
  const [pier, n] = id.split('-')
  return n ? `${pier}부두 ${Number(n)}번` : `${pier}부두`
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

/**
 * 데이터셋 → 시나리오(화면 입력 모델). 엔진 요청(request)은 그대로 들고 있다가 다시 계산할 때 쓴다.
 * 11-26 엔진 결과 없이 요청만으로 만든다(처음 열 때 후보 계산을 기다리지 않고 운영 현황을 띄움).
 *   계획 대상 = 기준 시각 T에 아직 접안 전이고 ETA < T + 기간이며 하역 속도가 있는 배 (엔진 규칙과 같음, 11-09 데이터셋 91척 일치)
 *   기존 계획(existing) = 그 배들의 실제 접안 기록 (다른 스케줄러가 세워 둔 계획으로 가정)
 *   탱크 재고 · 엔진 규칙 값처럼 엔진만 아는 것은 engineFacts로, 후보 A가 나오면 채운다.
 */
export function buildScen(ds, first = ds.results?.[0]?.response ?? null) {
  const req = ds.request
  const T = toMin(req.start), days = ds.days ?? 3
  const planIds = new Set(req.vessels.filter((v) => (!v.berthed || toMin(v.berthed) >= T) && toMin(v.eta) < T + days * 1440
    && Object.keys(v.rate_t_per_h ?? {}).length).map(vesselIdOf))
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
  // 제원표에 빈 값이 문자열 'None'으로 들어온 것은 없는 값으로 본다
  const refs = Object.fromEntries(Object.entries(ds.vesselRef ?? {}).map(([cs, r]) => [cs, Object.fromEntries(Object.entries(r).filter(([, x]) => x !== 'None'))]))
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
  // 11-26 화면에는 이름만(사용자 결정). 항차 · 접안 순번은 fullName으로 — 마우스를 올렸을 때와 선박 카드에서만 쓴다.
  for (const v of vessels) {
    const seq = Number(v.id.split('-').at(-1))
    v.fullName = `${v.name} ${Number(v.voyage)}항차${seq > 1 ? ` (${seq}번째 접안)` : ''}`
  }
  const t0 = T
  const wind = (req.weather ?? []).map((w) => ({ t: toMin(w.time), ms: w.wind_ms, thunder: w.thunder, typhoon: w.typhoon })).filter((w) => w.t >= t0 - 24 * 60)
  // 기존 계획: 계획 대상 배의 실제 접안 기록 (엔진 응답 baseline과 같은 모양)
  const existing = req.vessels.filter((v) => planIds.has(vesselIdOf(v)) && v.berthed && v.actual_berth)
    .map((v) => ({ vessel_id: vesselIdOf(v), berth: v.actual_berth, eta: v.eta, etb: v.berthed, etu: v.unberthed }))
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
    meta: ds.meta, berths, vessels, wind, occupied,
    existing: {
      id: 'existing', label: '기존 계획', preset: null, tanks: [],
      placements: existing.map((p) => ({ vid: p.vessel_id, bid: p.berth, eta: toMin(p.eta), etb: toMin(p.etb), etu: toMin(p.etu), dem: { cents: 0 } })).sort((a, b) => a.etb - b.etb),
    },
    ...engineFacts(ds, first, existing), // 엔진 결과가 있으면 기존 계획도 엔진 계산값(체선 · 정박시간)으로
    // 스케줄러가 고치는 값: 선박 ETA(vessels[].eta), 부두 사용 불가(blocks), 고정 선박(fixes), 엔진 파라미터(params)
    blocks: [], fixes: [], params: {},
    // 11-25 계획 조건을 바꾸는 받은 메일(시연용, 실제 선박 · 부두로 만듦). 「반영」하면 계획 조건에 들어간다(lib/incidents.js)
    //   11-26 기존 계획(실제 접안 기록)으로 만든다 → 엔진 결과와 상관없이 늘 같은 메일
    incidents: seedIncidents({ vessels, berths, window: { start: t0, end: t0 + days * 1440 } }, existing, existing),
    request: req,
  }
}

/**
 * 엔진만 아는 계획 입력: 탱크(1/1부터 실적으로 이어 센 T 재고, 기존 계획대로의 재고 흐름) · 야간 도선 · 풍속 기준 · 계획 구간 끝 · 후보 프리셋.
 * first(후보 A 응답)가 없으면 비워 두고, A가 나오면 이것만 다시 채운다(계획 조건 버전은 그대로 — 스케줄러가 고치는 값이 아님).
 */
export function engineFacts(ds, first, existing = []) {
  const req = ds.request
  const t0 = toMin(req.start)
  const win1 = first ? toMin(first.window.end) : Math.max(t0 + (ds.days ?? 3) * 1440, ...existing.map((p) => toMin(p.etu)))
  const weekOf = (d) => toMin(`${d}T00:00:00+09:00`)
  // 11-25 생산계획과 탱크: 최적화 팀 후보정(make_tank_plan)으로 만든 주별 생산계획(요청 production_plan)과
  // 엔진이 1/1부터 실적으로 이어 센 기준 시각 재고(응답 tanks의 initial_t). 계획 입력이라 고치지 않는다.
  const tanks = (first?.tanks ?? []).map((t) => {
    const rows = (req.production_plan ?? []).filter((w) => w.tank === t.tank).map((w) => ({ from: weekOf(w.week_start), rate: w.rate_t_per_h })).sort((a, b) => a.from - b.from)
    const cur = rows.filter((w) => w.from <= t0).at(-1)
    const weeks = [cur, ...rows.filter((w) => w.from > t0 && w.from < win1)].filter(Boolean)
    // 11-25 재고 흐름 = 기존 계획(엔진 baseline, 다른 스케줄러가 미리 세워 둔 계획으로 가정)대로 갔을 때. 최적화 결과와 무관한 계획 입력이다.
    const base = t.baseline_levels_t ? { start: toMin(t.start), step: t.step_min ?? 60, lv: t.baseline_levels_t } : null
    return { name: t.tank, count: t.tanks, cap: t.capacity_t, start: t.initial_t, safeMin: t.safe_min_t, safeMax: t.safe_max_t, weeks, base }
  })
  // 기존 계획을 엔진 계산식으로 평가한 값(응답 baseline: 실제 선석 · ETB에서의 작업 · 정박시간 · 체선료)
  const evaluated = first?.baseline?.vessels?.length
    ? { existing: { id: 'existing', label: '기존 계획', preset: null, tanks: [], placements: first.baseline.vessels.map(placement).sort((a, b) => a.etb - b.etb) } }
    : {}
  return {
    ...evaluated,
    tanks, nightPilot: first?.params?.night_pilot ?? null, windDefault: first?.params?.weather?.thresholds_ms ?? null,
    window: { start: t0, end: win1 },
    presets: ds.results?.map((r) => r.preset) ?? [BASE_PRESET, BASE_PRESET, C_PRESET], // B 자리는 A가 나온 뒤 고른다
    engineReady: Boolean(first),
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

/**
 * 프리셋별 응답들 → 후보 A · B · C (11-25: 체선료 순이 아니라 자리 고정 — A 기본, B 상황형, C 배별 지연 대비).
 * A 동점 규칙: B가 A와 체선료가 같고 탱크가 더 안전하면, A는 B의 계획을 쓴다(같은 돈이면 더 안전한 쪽). B에는 그 사실을 적는다.
 * request가 있으면 같이 둔다(리스크 모델에 그대로 보냄).
 */
export function rankSims(results) {
  const sims = results.map((r, i) => ({ ...toSim(r.response, r.preset, String.fromCharCode(65 + i)), req: r.request ?? null, resp: r.response }))
  const [a, b] = sims
  if (a && b && a.total === b.total && tankMargin(b) > tankMargin(a) + 0.05) {
    const merged = { ...toSim(b.resp, a.preset, 'A'), req: b.req, resp: b.resp }
    merged.notes = [...merged.notes, `체선료가 같은 후보 B(${b.preset.label}) 계획이 탱크가 더 안전해 그 계획을 씀`]
    sims[0] = merged
    sims[1] = { ...b, notes: [...b.notes, '후보 A와 체선료 · 계획이 같음 (A가 이 계획을 씀)'], sameAsA: true }
  }
  return sims
}

/**
 * 11-25 리스크 모델 API(POST /risk/risks, 팀 berth_risk): 엔진에 보낸 요청과 받은 응답을 그대로 보내 리스크 목록을 받는다.
 * 응답 {counts: {HIGH, MEDIUM, LOW}, risks[]: {id, kind, severity, title, vessel_ids, berth, tank, start, end, evidence, cost_per_hour}, notes[]}
 */
//   탱크 리스크는 리스크 모델이 고정 마지노선(기본 20/80%, 1·4·7%p)으로 판정한다(계획의 안전 범위와 무관).
//   요청이 1년치 실적을 담아 6MB가 넘고(지연 규칙이 1/1부터 탱크 재고를 다시 센다) 후보 하나에 5초 이상 걸린다.
//   같은 요청의 결과는 이 브라우저 세션에 저장해 두고 다시 쓴다(새로고침·화면 이동 때 기다리지 않게).
// 11-26 리스크 결과는 브라우저 저장소(lib/cache.js)에 리스크 모델 지문(GET /risk/health의 model.version)과 함께 남긴다.
//   규칙이 바뀌면 지문이 달라져 다시 계산한다.
const riskVersion = () => versionOf('risk', '/risk/health', (b) => b?.model?.version)

export async function fetchRisks(req, resp, signal) {
  const payload = JSON.stringify({ plan_request: req, plan_response: resp, rates: null })
  const ver = await riskVersion()
  const key = ver && `risk:${ver}:${hashText(payload)}`
  const hit = key && await cacheGet(key)
  if (hit) return hit
  const r = await fetch('/risk/risks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal })
    .catch((e) => { if (e.name === 'AbortError') throw e; return null })
  if (!r) throw new Error('리스크 서버(127.0.0.1:8002)에 연결되지 않았습니다')
  const body = await r.json().catch(() => null)
  if (!r.ok) throw new Error(body?.detail ?? body?.title ?? `리스크 서버 오류 ${r.status}${r.status >= 500 ? ' (리스크 서버가 꺼져 있을 수 있습니다)' : ''}`)
  if (key) cacheSet(key, body)
  return body
}

// 11-25 프론트 작업 중에만: 엔진 계산 제한 시간을 60초 → 5초로 줄인다(다시 계산 · 「반영하면?」 미리 계산이 빨리 끝나게).
//   작업이 끝나면 null로 돌려 데이터셋 요청 값(60초)을 쓴다.
export const DEV_TIME_LIMIT_S = null

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
  if (DEV_TIME_LIMIT_S) req.params = merge(req.params, { solver: { time_limit_s: DEV_TIME_LIMIT_S } })
  req.name = preset.label
  req.request_id = preset.id
  return req
}
const merge = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(o[k] ?? {}, v) : v; return o }

// 11-26 엔진 결과도 브라우저 저장소에 남긴다. 키 = 엔진 지문(코드 · 파라미터 기본값) + 요청 내용.
//   같은 계획 조건 · 같은 후보면 엔진을 다시 부르지 않는다(처음 화면 · 다시 계산 · 「단독 반영 시」 모두).
const engineVersion = () => versionOf('plan', '/engine/health', (b) => b?.engine && `${b.engine.version}.${String(b.engine.params_sha256).slice(0, 8)}`)

/** 엔진 POST /plans (저장된 결과가 있으면 그것). 계획을 찾은 결과만 남긴다. 오류는 status를 붙여 던진다(429 = 대기열이 참) */
export async function solveCached(request, signal) {
  const text = JSON.stringify(request)
  const ver = await engineVersion()
  const key = ver && `plan:${ver}:${hashText(text)}`
  const hit = key && await cacheGet(key)
  if (hit) return hit
  const r = await fetch('/engine/plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text, signal })
    .catch((e) => { if (e.name === 'AbortError') throw e; return null })
  if (!r) throw new Error('엔진 서버(127.0.0.1:8000)에 연결되지 않았습니다. 엔진 저장소에서 `python -m berth_sim.api`로 띄우십시오.')
  const body = await r.json().catch(() => null)
  if (!r.ok) throw Object.assign(new Error(body?.detail ?? body?.title ?? `엔진 오류 ${r.status}`), { status: r.status })
  if (key && body?.plan) cacheSet(key, body)
  return body
}

/** 엔진에 계획 하나 (프리셋 하나). 「반영하면?」 미리 계산에 쓴다 */
export async function solveOne(scen, preset, signal) {
  const request = buildRequest(scen, preset)
  return { preset, request, response: await solveCached(request, signal) }
}

/** 엔진 API로 다시 계산 (후보 프리셋마다 한 번, 동시에) */
export async function recalc(scen, signal, presets = scen.presets) {
  const health = await fetch('/engine/health', { signal }).catch((e) => { if (e.name === 'AbortError') throw e; return null })
  if (!health?.ok) throw new Error('엔진 서버(127.0.0.1:8000)에 연결되지 않았습니다. 엔진 저장소에서 `python -m berth_sim.api`로 띄우십시오.')
  // 11-25 계획을 못 찾으면(NO_PLAN, 제한 시간이 짧거나 엔진이 바쁠 때) 그 후보만 제한 시간을 20초로 늘려 한 번 더 푼다
  const solve = async (preset, retry) => {
    const request = buildRequest(scen, preset)
    if (retry) request.params = merge(request.params, { solver: { time_limit_s: Math.max(20, request.params.solver?.time_limit_s ?? 0) } })
    for (;;) {
      try {
        return { preset, request, response: await solveCached(request, signal) }
      } catch (e) {
        if (e.name === 'AbortError') throw e
        if (e.status !== 429) throw Object.assign(new Error(`${preset.label}: ${e.message}`), { status: e.status })
        await sleep(15000, signal) // 엔진 대기열이 참(다른 계산 중): 잠시 뒤 다시
      }
    }
  }
  return Promise.all(presets.map(async (preset) => {
    let out = await solve(preset, false)
    if (!out.response.plan) out = await solve(preset, true)
    if (!out.response.plan) throw new Error(`${preset.label}: 이 조건으로 계획을 찾지 못했습니다 (${out.response.status})`)
    return out
  }))
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')) }, { once: true })
})

/**
 * 11-26 처음 열 때 후보 A · B · C (데이터셋에 결과가 없을 때). B는 A 계획의 탱크 · 예보 풍속으로 고르므로 A를 먼저 푼다.
 * 요청은 「다시 계산」과 같은 규칙(buildRequest)으로 만들어, 조건을 안 바꾸고 다시 계산하면 저장된 결과가 그대로 쓰인다.
 * onStep('A' | 'BC')로 진행을 알린다. 반환: [{preset, request, response}] × 3
 */
export async function initialResults(ds, onStep, signal) {
  onStep?.('A')
  const bare = { request: ds.request, vessels: [], blocks: [], fixes: [], params: {} }
  const [a] = await recalc(bare, signal, [BASE_PRESET])
  const scenA = buildScen({ ...ds, results: [a] })
  const b = chooseB(scenA, rankSims([a])[0])
  onStep?.('BC')
  const [rb, rc] = await recalc(scenA, signal, [b, C_PRESET])
  return [a, rb, rc]
}
