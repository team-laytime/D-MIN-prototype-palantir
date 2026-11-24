import { at } from './time.js'

// 전부 가상 데이터다. 일출·일몰은 팀 최적화 엔진(D-MIN-optimization berth_sim/sun.py) 근사식으로 뽑은 2026-11 울산 값이다.
// 조석은 계산에 쓰지 않는다(멘토링: 조석은 고려하지 않음). 부두 그룹(shiftGroup)은 팀 엔진 Shifting 표의 행 이름이다.
// 부두 이름·위치·제원은 SK 울산 액체부두 공개 자료 수준(팀 portwise 프로토타입과 같은 값)에 맞췄다.
const berths = () => [
  {
    id: 'B1', name: 'SK 6부두', code: 'SK6', maxDwt: 70000, maxDraft: 14.5,
    products: ['나프타', '경유', '휘발유', '벙커C'], shiftGroup: '#6',
    occupiedBy: 'SEA DRAGON', occupiedUntil: at(14, 9),
    facility: { known: true, maintenance: null },
    pos: [35.4855, 129.3907], moor: [35.4851, 129.3926],
  },
  {
    id: 'B2', name: 'SK 3부두', code: 'SK3', maxDwt: 50000, maxDraft: 11.5,
    products: ['휘발유', '경유', '항공유', '등유'], shiftGroup: '#3',
    occupiedBy: 'KOMODO', occupiedUntil: at(14, 4),
    facility: { known: true, maintenance: { start: at(15, 10), end: at(15, 14), label: '로딩암 2번 정기 점검' } },
    pos: [35.4946, 129.3829], moor: [35.4941, 129.3848],
  },
  {
    id: 'B3', name: 'SK 5부두', code: 'SK5', maxDwt: 15000, maxDraft: 9.0,
    products: ['등유', '경유', '휘발유'], shiftGroup: '#5-5',
    occupiedBy: null, occupiedUntil: null,
    facility: { known: false, maintenance: null },
    pos: [35.4892, 129.3863], moor: [35.4888, 129.3882],
  },
]

// 지도 배경용: 이번 계산에 쓰지 않는 다른 SK 시설과 묘박지(정박지) 대기 위치.
export const MAP_CONTEXT = {
  facilities: [
    { code: 'SK1', pos: [35.5027, 129.3632] }, { code: 'SK2', pos: [35.4986, 129.3658] },
    { code: 'SK4', pos: [35.4927, 129.3842] }, { code: 'SK7', pos: [35.4824, 129.3907] },
    { code: 'SK8', pos: [35.4791, 129.3906] }, { code: '2부이', pos: [35.4483, 129.4236] },
    { code: '3부이', pos: [35.44, 129.43] },
  ],
  // DWT 3만 톤 이하는 E2, 그보다 큰 선박은 E3 정박지에서 기다린다.
  anchorages: [
    { id: 'E2', label: 'E2 정박지', maxDwt: 30000, center: [35.4225, 129.4441],
      spots: [[35.42403, 129.42868], [35.42313, 129.44412], [35.42403, 129.45956], [35.41863, 129.4364]] },
    { id: 'E3', label: 'E3 정박지', maxDwt: Infinity, center: [35.4098, 129.4535],
      spots: [[35.41051, 129.43971], [35.41142, 129.45515], [35.41412, 129.47059], [35.4033, 129.44853]] },
  ],
}

// workMin = ETB→작업시작 1시간 + 물량 / 하역 속도 + 작업완료→ETU 2시간 (팀 엔진 after_etb s1~s3, 가장 빠른 부두 기준)
const work = (ton, rate) => 60 + Math.round((ton / rate) * 60) + 120

const vessels = () => [
  { id: 'V1', name: 'PACIFIC JADE', product: '경유', dir: '수출', dwt: 48000, draft: 11.0, ton: 45000, pump: 2500,
    eta: at(14, 2), contract: { id: 'CA-2611-014', laytimeH: 26, rateUsd: 28000, norTurnH: 6, weather: 'FULL' } },
  { id: 'V2', name: 'OCEAN LILY', product: '휘발유', dir: '수출', dwt: 40000, draft: 10.2, ton: 35000, pump: 2500,
    eta: at(14, 5, 30), contract: { id: 'CA-2611-021', laytimeH: 22, rateUsd: 22000, norTurnH: 6, weather: 'HALF' } },
  { id: 'V3', name: 'GOLDEN STAR', product: '나프타', dir: '수입', dwt: 68000, draft: 13.2, ton: 62000, pump: 3000,
    eta: at(14, 8), contract: { id: 'CA-2610-087', laytimeH: 28, rateUsd: 45000, norTurnH: 6, weather: 'NONE' } },
  { id: 'V4', name: 'HANA MARU', product: '등유', dir: '수출', dwt: 12000, draft: 7.5, ton: 10000, pump: 1250,
    eta: at(14, 10), contract: { id: 'CA-2611-030', laytimeH: 14, rateUsd: 12000, norTurnH: 0, weather: 'FULL' } },
  { id: 'V5', name: 'STELLA', product: '항공유', dir: '수출', dwt: 45000, draft: 11.0, ton: 40000, pump: 2500,
    eta: at(14, 14), contract: { id: 'CA-2611-033', laytimeH: 26, rateUsd: 30000, norTurnH: 6, weather: 'FULL' } },
  { id: 'V6', name: 'BLUE CORAL', product: '벙커C', dir: '수출', dwt: 30000, draft: 9.8, ton: 25000, pump: 2000,
    eta: at(14, 20), contract: { id: 'CA-2611-041', laytimeH: 22, rateUsd: 18000, norTurnH: 6, weather: 'HALF' } },
].map((v) => ({ ...v, vesselType: '석유제품선', nrTender: null, ...SPECS[v.id], ...PARTICULARS[v.id], rates: RATES[v.id], contract: { ...v.contract, laycan: LAYCAN[v.id] }, workMin: work(v.ton, Math.max(...Object.values(RATES[v.id]))) }))

// 배 × 부두 하역 속도(t/h, 가상). 팀 엔진은 전처리(berth_prep/rates.py)가 과거 하역 실적
// (선박코드 + 자재 + 부두 → 없으면 부두 + 자재, 같은 배 기록은 물량 0.5~2배일 때만)의 평균으로 만든다.
const RATES = {
  V1: { B1: 2500, B2: 2250 }, V2: { B1: 2500, B2: 2000 }, V3: { B1: 3000 },
  V4: { B2: 1250, B3: 1000 }, V5: { B2: 2500 }, V6: { B1: 2000 },
}

// LayCan(가상). 데이터 팀 묶음 규칙: 울산에서 싣는 배만 있고 ATA 기준 3일 창(첫날 00:00 ~ 마지막 날 16:00),
// 실제 묶음은 창 안 60% · 조기 25% · 지연 15%이고, 이 시연 6척은 모두 창 안으로 둔다. 내리기만 하는 배(수입)는 없음(null) → LayCan 분기를 건너뛴다.
const LAYCAN = {
  V1: { from: at(13, 0), to: at(15, 16), case: '창 안' },
  V2: { from: at(13, 0), to: at(15, 16), case: '창 안' },
  V3: null,
  V4: { from: at(13, 0), to: at(15, 16), case: '창 안' },
  V5: { from: at(13, 0), to: at(15, 16), case: '창 안' },
  V6: { from: at(14, 0), to: at(16, 16), case: '창 안' },
}

// 선박 카드용 제원(가상). 선명·MMSI·IMO·호출부호는 실제 선박과 무관하다.
const SPECS = {
  V1: { flag: 'KR', mmsi: '440911201', imo: '9701234', callSign: 'D7PJ', type: '석유제품 운반선 (MR)', grt: 29800, loa: 183, beam: 32.2, prevPort: 'YEOSU, KOREA', voyage: '2026-1114' },
  V2: { flag: 'PA', mmsi: '351204000', imo: '9655432', callSign: '3FOL5', type: '석유제품 운반선 (MR)', grt: 25400, loa: 176, beam: 31.0, prevPort: 'DAESAN, KOREA', voyage: '2026-1121' },
  V3: { flag: 'MH', mmsi: '538009120', imo: '9588123', callSign: 'V7GS9', type: '석유제품 운반선 (LR1)', grt: 42100, loa: 228, beam: 32.3, prevPort: 'SINGAPORE', voyage: '2026-1087' },
  V4: { flag: 'JP', mmsi: '431002345', imo: '9811222', callSign: 'JD4521', type: '석유제품 운반선 (연안)', grt: 7850, loa: 118, beam: 18.6, prevPort: 'BUSAN, KOREA', voyage: '2026-1130' },
  V5: { flag: 'KR', mmsi: '440318900', imo: '9745678', callSign: 'D7SL', type: '석유제품 운반선 (MR)', grt: 28100, loa: 180, beam: 32.0, prevPort: 'GWANGYANG, KOREA', voyage: '2026-1133' },
  V6: { flag: 'SG', mmsi: '563045210', imo: '9690011', callSign: '9VBC2', type: '석유제품 운반선 (Handy)', grt: 18900, loa: 162, beam: 27.4, prevPort: 'ONSAN, KOREA', voyage: '2026-1141' },
}

// 선박 카드 '제원' 칸(가상). 실제 솔루션에서는 AIS 정적 정보(길이·폭·선종·건조 연도 등)와
// 대리점·선박 원부 자료(소유·관리사·선급·탱크)로 채운다 (console/docs/data-sources.md).
// aisDest·aisEtaDiff는 AIS 항해 정보(선장 입력)를 흉내 낸 값: 계획 ETA보다 몇 분 어긋나 있다.
const PARTICULARS = {
  V1: { built: 2017, cls: 'KR', nt: 12900, depth: 19.1, speedKn: 13.5, engine: 'MAN B&W 6S50ME-C8.2 · 8,600kW', owner: 'Pacific Marine Ltd. (가상)', manager: '해성선박관리 (가상)', cargoM3: 54200, tanks: 12, manifold: '12in × 4', aisDest: 'KR USN', aisEtaDiff: 12 },
  V2: { built: 2014, cls: 'LR', nt: 10800, depth: 18.2, speedKn: 13.0, engine: 'MAN B&W 6S50MC-C · 7,860kW', owner: 'Ocean Lily Shipping S.A. (가상)', manager: 'Aegean Ship Mgmt (가상)', cargoM3: 46800, tanks: 10, manifold: '12in × 4', aisDest: 'ULSAN', aisEtaDiff: -25 },
  V3: { built: 2012, cls: 'ABS', nt: 15800, depth: 21.0, speedKn: 14.0, engine: 'MAN B&W 6S60ME-C8 · 11,300kW', owner: 'Golden Star Maritime (가상)', manager: 'Pacific Basin Tankers (가상)', cargoM3: 78500, tanks: 14, manifold: '16in × 4', aisDest: 'KRUSN', aisEtaDiff: 95 },
  V4: { built: 2019, cls: 'NK', nt: 2690, depth: 9.4, speedKn: 11.5, engine: 'Yanmar 6EY22 · 2,100kW', owner: '하나해운 (가상)', manager: '하나해운 (가상)', cargoM3: 11200, tanks: 8, manifold: '8in × 3', aisDest: 'ULSAN KOREA', aisEtaDiff: 150 },
  V5: { built: 2016, cls: 'KR', nt: 12000, depth: 18.8, speedKn: 13.0, engine: 'MAN B&W 6S50ME-B9 · 8,200kW', owner: 'Stella Tankers Co. (가상)', manager: '한서선박 (가상)', cargoM3: 51000, tanks: 12, manifold: '12in × 4', aisDest: 'KR USN', aisEtaDiff: 8 },
  V6: { built: 2010, cls: 'DNV', nt: 8300, depth: 15.2, speedKn: 12.0, engine: 'Wärtsilä 6RT-flex50 · 7,100kW', owner: 'Blue Coral Pte. Ltd. (가상)', manager: 'Straits Tanker Mgmt (가상)', cargoM3: 34500, tanks: 10, manifold: '10in × 4', aisDest: 'ULSAN', aisEtaDiff: -40 },
}

// 울산 일출 · 일몰 (팀 엔진 berth_sim/sun.py, NOAA 근사식, 분 단위 반올림)
export const SUN_DAYS = [
  { day: 13, sunrise: at(13, 6, 56), sunset: at(13, 17, 19) },
  { day: 14, sunrise: at(14, 6, 57), sunset: at(14, 17, 18) },
  { day: 15, sunrise: at(15, 6, 58), sunset: at(15, 17, 17) },
  { day: 16, sunrise: at(16, 6, 59), sunset: at(16, 17, 17) },
  { day: 17, sunrise: at(17, 7, 0), sunset: at(17, 17, 16) },
  { day: 18, sunrise: at(18, 7, 1), sunset: at(18, 17, 16) },
]

const env = () => ({
  // 계획 여유(분): 부두별 Switching에 더하는 값 (팀 엔진 shifting.buffer_switch_h, 기본 0)
  switchBufferMin: 0,
  days: SUN_DAYS.map((d) => ({ ...d })),
  // 기상은 '사용자 설정 부두 제약'(멘토링 장표 13쪽: 기상 정보 대신 부두 제약 시간 설정)으로 전 부두에 건다.
  weather: { start: at(14, 18), end: at(15, 6), label: '강풍 주의보 (최대 풍속 17m/s)', source: '기상청 단기예보 (가상)' },
})

const tanks = () => [
  { product: '나프타', ullageTon: 52000, readyAt: at(15, 6), note: '11/15 06:00 이후 공정 투입으로 여유 7만 톤 이상 확보 예정' },
]

const urgent = () => [
  { vid: 'V5', deadline: at(15, 22), note: '김해·김포 항공유 재고 보충 출하' },
]

// 스케줄러가 바꿀 수 있는 값(11-20 피드백). 계약 정보는 바꿀 수 없다.
//   switchBufferMin(교대 여유)은 env에 있고, 나머지 둘은 계산 직전에 applyParams로 반영한다.
export const DEFAULT_PARAMS = { safetyStockPct: 5, weatherMarginH: 0 }

/** 계산에 쓰는 시나리오: 기상 여유만큼 접안 금지 구간을 넓히고, 안전재고만큼 탱크 여유를 줄인다. */
export function applyParams(s) {
  const p = s.params ?? DEFAULT_PARAMS
  const o = structuredClone(s)
  if (o.env.weather && p.weatherMarginH) {
    o.env.weather.start -= p.weatherMarginH * 60
    o.env.weather.end += p.weatherMarginH * 60
  }
  o.tanks = o.tanks.map((t) => ({ ...t, ullageTon: Math.round(t.ullageTon * (1 - p.safetyStockPct / 100)) }))
  return o
}

// 부두 담당(가상). 확정 일정 화면에서 연락처로 쓴다.
export const BERTH_TEAMS = {
  B1: { team: 'SK 6부두 하역 2팀', lead: '김도윤 반장', tel: '052-000-6021' },
  B2: { team: 'SK 3부두 하역 1팀', lead: '박서준 반장', tel: '052-000-3011' },
  B3: { team: 'SK 5부두 하역 1팀', lead: '이하은 반장', tel: '052-000-5011' },
}

// 돌발 상황(가상). 계산 입력과 별개로 현장에서 메일로 들어오는 소식이다(11-20 피드백: 알림함은 이런 걸 받는 곳).
const incidents = () => [
  { id: 'INC-1', at: at(14, 7, 40), from: '설비팀 정비파트', kind: '부두 공사', berth: 'B2', title: 'SK 3부두 로딩암 2번 점검을 11/15 08:00으로 2시간 앞당길 수 있음', effect: '확정되면 SK 3부두 11/15 08:00~14:00 접안선 작업 시간이 늘어남' },
  { id: 'INC-2', at: at(14, 7, 55), from: '생산계획팀', kind: '재고 변동', title: '나프타 공정 투입 지연, 11/15 06:00 이후 여유 확보가 6시간 늦어질 수 있음', effect: 'GOLDEN STAR 하역 시작 가능 시각이 늦어질 수 있음' },
]

function build(id, name, summary, patch) {
  const s = { id, name, summary, berths: berths(), vessels: vessels(), env: env(), tanks: tanks(), urgent: urgent(), incidents: incidents(), params: { ...DEFAULT_PARAMS } }
  patch?.(s)
  return s
}

export const SCENARIOS = {
  S1: () => build('S1', '기상 악화 예보일 선박 집중', '11/14 18시부터 12시간 강풍 예보, 6척이 하루 안에 도착'),
  S2: () => build('S2', '평시 (기상 이상 없음)', 'S1과 같은 선박, 기상 악화 예보 없음', (s) => { s.env.weather = null }),
  S3: () => build('S3', '대형선 지연 + 야간 도선 제한', 'GOLDEN STAR가 8시간 늦게 도착해 Last POB를 넘김, 다음 날 08시까지 접안 불가', (s) => {
    s.vessels.find((v) => v.id === 'V3').eta = at(14, 16)
  }),
}

export const WEATHER_CLAUSE = {
  FULL: { label: '기상체선 시간 전부 공제', ratio: 1, rule: 'WX-DED-FULL' },
  HALF: { label: '기상체선 시간 50% 공제', ratio: 0.5, rule: 'WX-DED-HALF' },
  NONE: { label: '기상체선 시간 공제 없음', ratio: 0, rule: 'WX-DED-NONE' },
}
