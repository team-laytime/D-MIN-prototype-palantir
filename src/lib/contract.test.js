import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { FIELDS, dealRows, detectKind, editKind, findInQuote, findQuoteInText, fmtValue, fromDraft, ocrLow, toDraft, weatherDeductPct } from './contract.js'

const load = (name) => JSON.parse(readFileSync(new URL(`../mock/contract/${name}.json`, import.meta.url), 'utf8'))
const deals = load('deals')
const dealOf = (id) => deals.find((d) => d.documents.includes(id))
const row = (rows, key) => rows.find((r) => r.key === key)

test('기상 조항: 파서 산입 기준 → 계산 공제 기준', () => {
  assert.equal(weatherDeductPct('FULL'), 0)
  assert.equal(weatherDeductPct('HALF'), 50)
  assert.equal(weatherDeductPct('NONE'), 100)
  assert.equal(weatherDeductPct(null), null)
})

test('규칙 추출만 있는 거래는 검토 필수가 없고, 비어 있는 계산 조건은 양식 기본값', () => {
  const rows = dealRows([load('SYN-CP-301'), load('SYN-SC-301')], dealOf('SYN-CP-301'))
  assert.equal(rows.filter((r) => r.status === 'review').length, 0)
  assert.equal(row(rows, 'laytime_total_h').value, 84)
  assert.equal(row(rows, 'laytime_total_h').status, 'rule')
  assert.equal(row(rows, 'nor_notice_h').status, 'default')
  assert.equal(row(rows, 'weather').value, 'HALF')
  // C/P에 없는 매매 확인서 칸은 매매 확인서에서
  assert.equal(row(rows, 'incoterm').src.doc_id, 'SYN-SC-301')
})

test('검토 필수: OCR · LLM · 문서 간 불일치', () => {
  const ocr = dealRows([load('SYN-CP-304'), load('SYN-SC-302')], dealOf('SYN-CP-304'))
  assert.equal(row(ocr, 'laytime_total_h').reason, 'ocr')
  const llm = dealRows([load('SYN-CP-303'), load('SYN-SC-303')], dealOf('SYN-CP-303'))
  assert.equal(row(llm, 'nor_notice_h').reason, 'llm')
  assert.equal(row(llm, 'nor_notice_h').value, 0) // LLM이 0을 뽑았으면 기본값 6으로 덮지 않는다
  assert.equal(row(llm, 'load_laydays_from').reason, 'diff')
  assert.equal(row(llm, 'load_laydays_from').src.doc_id, 'SYN-CP-303')
  assert.equal(row(llm, 'load_laydays_from').sources.length, 2)
})

test('스캔본: 특약 값은 confidence와 상관없이(evidence.ocr), 양식 기본값도 검토 필수(스캔본 특약 미확인)', () => {
  const rows = dealRows([load('SYN-CP-304'), load('SYN-SC-302')], dealOf('SYN-CP-304'))
  const rider = row(rows, 'berth_shift_counts')
  assert.equal(rider.src.section, 'rider')
  assert.equal(rider.src.ev.ocr, true)
  assert.equal(rider.reason, 'ocr')
  const nor = row(rows, 'nor_notice_h')
  assert.equal(nor.reason, 'scan')
  assert.equal(nor.value, 6)
  assert.equal(nor.sources[0].page, 3) // 확인할 곳(스캔 특약 시작 쪽)을 먼저
  assert.equal(nor.src.clause, 'ASBATANKVOY 2025 Part II 6') // 출처 칸은 값의 출처(양식 조항)
  assert.deepEqual([nor.srcTag, nor.check.doc_id, nor.check.section], ['양식 기본값', 'SYN-CP-304', 'rider'])
  assert.equal(row(rows, 'weather').reason, 'scan')
  // 글자층 있는 C/P가 같이 있으면 기본값은 그냥 양식 기본값, 값도 글자층 쪽에서
  const both = dealRows([load('SYN-CP-304'), load('SYN-CP-302'), load('SYN-SC-302')], dealOf('SYN-CP-304'))
  assert.equal(row(both, 'nor_notice_h').status, 'default')
  assert.equal(row(both, 'laytime_total_h').src.doc_id, 'SYN-CP-302')
})

test('일 체선료: 매매 확인서가 CP 요율 준용이면 C/P 값이 기준', () => {
  // 스캔 C/P에서 못 읽음(예시: SYN-CP-304의 체선료율을 비움) → 매매 확인서 값을 임시로 쓰고 검토 필수
  const unreadCp = load('SYN-CP-304')
  unreadCp.cp.demurrage_rate_per_day = { value: null, evidence: null }
  const vega = row(dealRows([unreadCp, load('SYN-SC-302')], dealOf('SYN-CP-304')), 'demurrage_rate_per_day')
  assert.equal(vega.reason, 'rate')
  assert.equal(vega.value, 46300)
  assert.deepEqual(vega.sources.map((x) => x.doc_id), ['SYN-CP-304', 'SYN-SC-302'])
  assert.deepEqual([vega.src.doc_id, vega.srcTag, vega.check.doc_id, vega.check.scan], ['SYN-SC-302', '임시', 'SYN-CP-304', true])
  // 두 문서 값이 다르면 문서 간 불일치, 적용값은 C/P
  const sc = load('SYN-SC-302')
  sc.sales.demurrage_rate_per_day.value = 47000
  const diff = row(dealRows([load('SYN-CP-302'), sc], null), 'demurrage_rate_per_day')
  assert.equal(diff.reason, 'diff')
  assert.equal(diff.value, 46300)
  assert.equal(diff.src.doc_id, 'SYN-CP-302')
  // 별도 요율은 다른 계약이라 쓰지 않는다 → C/P에도 값이 없으니 계산 값 없음
  sc.sales.rate_basis.value = '별도'
  const own = row(dealRows([unreadCp, sc], null), 'demurrage_rate_per_day')
  assert.deepEqual([own.status, own.reason, own.value], ['review', 'missing', null])
})

test('cp_gaps: C/P가 비어 매매 확인서 값을 적용값으로, C/P 쪽 원문은 deals의 cp_text', () => {
  const rows = dealRows([load('SYN-CP-307'), load('SYN-SC-306')], dealOf('SYN-CP-307'))
  const r = row(rows, 'demurrage_rate_per_day')
  assert.equal(r.reason, 'diff')
  assert.equal(r.value, 12800)
  assert.equal(r.src.doc_id, 'SYN-SC-306')
  assert.equal(r.sources[0].quote, 'Demurrage per day: To be advised')
})

test('불일치는 두 문서가 다 등록됐을 때만: recap만 있으면 recap 값을 규칙 추출로', () => {
  const rows = dealRows([load('SYN-RECAP-318')], dealOf('SYN-RECAP-318'))
  const r = row(rows, 'demurrage_rate_per_day')
  assert.equal(r.status, 'rule')
  assert.equal(r.value, 42100)
})

test('원문 강조: 숫자·날짜 표기를 바꿔 찾고, 숫자 일부에는 걸리지 않는다', () => {
  assert.deepEqual(findInQuote('Demurrage per day: USD 64,500 per day pro rata', 64500), ['Demurrage per day: USD ', '64,500', ' per day pro rata'])
  assert.equal(findInQuote('Commencing: 14 February 2028', '2028-02-14T00:00:00')[1], '14 February 2028')
  assert.equal(findInQuote('Total laytime: 184 hours', 84), null)
  assert.equal(findInQuote('MT SYN ALTAIR, and', 'SYN ALTAIR')[1], 'SYN ALTAIR')
  assert.equal(findInQuote('laytime begins on tender of NOR', 0), null)
  assert.equal(findInQuote('Commencing: 12.11.2025', '2025-11-12T00:00:00')[1], '12.11.2025')
  assert.equal(findInQuote('LAYCAN : 13-15 NOV 2025', '2025-11-15T16:00:00')[1], '13-15 NOV 2025')
  assert.equal(findInQuote('LAYCAN : 06-08 NOV 2025', '2025-11-06T00:00:00')[1], '06-08 NOV 2025')
  assert.equal(findInQuote('Laydays: 14 NOV 2025 to 16 NOV 2025', '2025-11-16T16:00:00')[1], '16 NOV')
})

test('값 표시와 종류 판정', () => {
  assert.equal(fmtValue({ fmt: 'usd' }, 64500), 'USD 64,500 /일')
  assert.equal(fmtValue({ fmt: 'weather' }, 'FULL'), '전부 산입 (계산 공제 0%)')
  assert.equal(fmtValue({}, 'SHINC_NONREV'), 'SHINC, 비가역')
  assert.equal(fmtValue({}, 'PRO_RATA:75000'), '비례 배분 (만재 75,000 t 기준)')
  assert.equal(fmtValue({}, '2028-02-14T00:00:00'), '2028-02-14 00:00')
  assert.equal(detectKind('Fixture recap - SYN RIGEL'), 'recap')
  assert.equal(detectKind('SYN_VEGA_매매확인서.pdf'), 'sales')
  assert.equal(detectKind('SYN_VEGA_CP.pdf'), 'cp')
  assert.equal(detectKind('Fwd_ 선적 일정 문의.eml'), null)
})

test('원본 본문에서 근거 문장 찾기: 시연용으로 옮긴 날짜도 원본(원래 날짜) 줄에 맞춘다', () => {
  const text = 'FIXTURE RECAP\nLAYCAN : 06-08 NOV 2028\nDEM : USD 42,100 PDPR\n'
  const at = (q) => { const r = findQuoteInText(text, q); return r && text.slice(r[0], r[1]) }
  assert.equal(at('DEM : USD 42,100 PDPR'), 'DEM : USD 42,100 PDPR')
  assert.equal(at('LAYCAN : 16-18 NOV 2025'), 'LAYCAN : 06-08 NOV 2028')
  assert.equal(at('LAYCAN : 16-18 Dec 2025'), 'LAYCAN : 06-08 NOV 2028')
  assert.equal(at('FREIGHT : WS 95'), null)
})

test('계산에 쓰는 값이 비면 검토 필수(계산 값 없음): C/P 빈칸 표기를 근거로', () => {
  const r = row(dealRows([load('SYN-CP-307')], dealOf('SYN-CP-307')), 'demurrage_rate_per_day')
  assert.deepEqual([r.status, r.reason, r.value], ['review', 'missing', null])
  assert.equal(r.src.quote, 'Demurrage per day: To be advised')
  // 매매 확인서가 있으면 지금처럼 문서 간 불일치(C/P 빈칸을 매매 확인서 값으로)
  assert.equal(row(dealRows([load('SYN-CP-307'), load('SYN-SC-306')], dealOf('SYN-CP-307')), 'demurrage_rate_per_day').reason, 'diff')
})

test('파서 layout · unread 출력: 특약 범위 · Box M, OCR 못 읽음', () => {
  const cp = load('SYN-CP-304')
  cp.layout = { pages: 5, sections: { part1: [1, 2], box_m: [2, 2], rider: [3, 5] } }
  // 허용 정박시간: 라벨 줄은 찾았는데 값을 못 읽음 → 계산 값이라 값을 넣어 끝낸다
  cp.cp.laytime_total_h = { value: null, evidence: { ...cp.cp.laytime_total_h.evidence, unread: true } }
  // 선적 Laydays 개시일: C/P에서 못 읽고 매매 확인서 값으로 채움 → 임시, 확인할 곳은 스캔 C/P
  cp.cp.load_laydays_from = { value: null, evidence: { ...cp.cp.load_laydays_from.evidence, unread: true } }
  const rows = dealRows([cp, load('SYN-SC-302')], dealOf('SYN-CP-304'))
  const nor = row(rows, 'nor_notice_h')
  assert.deepEqual([nor.check.page, nor.check.range, nor.check.boxM], [3, [3, 5], [2, 2]])
  const lt = row(rows, 'laytime_total_h')
  assert.deepEqual([lt.status, lt.reason, lt.value, lt.src.doc_id], ['review', 'unread', null, 'SYN-CP-304'])
  const ld = row(rows, 'load_laydays_from')
  assert.deepEqual([ld.reason, ld.srcTag, ld.src.doc_id, ld.check.doc_id], ['unread', '임시', 'SYN-SC-302', 'SYN-CP-304'])
  // 글자층 C/P 사본이 같이 있으면 그 값이 기준이라 검토 필수가 아니다
  assert.equal(row(dealRows([cp, load('SYN-CP-302'), load('SYN-SC-302')], dealOf('SYN-CP-304')), 'load_laydays_from').status, 'rule')
})

test('값 고치기: 칸 종류마다 입력 꼴, 입력 → 문서 JSON과 같은 꼴', () => {
  const f = (k) => FIELDS.find((x) => x.key === k)
  assert.deepEqual(['dwt', 'weather', 'berth_shift_counts', 'load_laydays_from', 'half_rate_events', 'imo'].map((k) => editKind(f(k))),
    ['number', 'weather', 'bool', 'datetime', 'list', 'text'])
  assert.equal(toDraft(f('load_laydays_from'), '2025-11-13T00:00:00'), '2025-11-13T00:00')
  assert.equal(fromDraft(f('load_laydays_from'), '2025-11-14T08:30'), '2025-11-14T08:30:00')
  assert.equal(fromDraft(f('load_laydays_from'), '14/11'), undefined)
  assert.equal(fromDraft(f('dwt'), '157900'), 157900)
  assert.equal(fromDraft(f('dwt'), '-1'), undefined)
  assert.equal(fromDraft(f('berth_shift_counts'), 'false'), false)
  assert.equal(toDraft(f('half_rate_events'), ['PORT_CONGESTION', '파업']), '항만 혼잡, 파업')
  assert.deepEqual(fromDraft(f('half_rate_events'), '화재, 파업 ,'), ['화재', '파업'])
  assert.equal(toDraft(f('laytime_terms'), 'SHINC_NONREV'), 'SHINC, 비가역')
  assert.equal(fromDraft(f('imo'), ' 1007017 '), '1007017')
  assert.equal(fromDraft(f('imo'), '  '), undefined)
})

test('ocrLow: 0.5 미만만 원본 확인, 못 읽은 칸(null)은 표시 없음', () => {
  assert.equal(ocrLow({ ocr_conf: 0 }), true)
  assert.equal(ocrLow({ ocr_conf: 0.5 }), false)
  assert.equal(ocrLow({ ocr_conf: null }), false)
  assert.equal(ocrLow(undefined), false)
})
