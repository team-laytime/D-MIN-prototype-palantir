import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dealRows, detectKind, findInQuote, fmtValue, weatherDeductPct } from './contract.js'

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

test('스캔본: 특약 값은 confidence 0.8이어도, 양식 기본값도 검토 필수(스캔본 특약 미확인)', () => {
  const rows = dealRows([load('SYN-CP-304'), load('SYN-SC-302')], dealOf('SYN-CP-304'))
  const rider = row(rows, 'berth_shift_counts')
  assert.equal(rider.src.ev.confidence, 0.8)
  assert.equal(rider.reason, 'ocr')
  const nor = row(rows, 'nor_notice_h')
  assert.equal(nor.reason, 'scan')
  assert.equal(nor.value, 6)
  assert.equal(nor.sources[1].page, 3) // 원본 특약 쪽
  assert.equal(row(rows, 'weather').reason, 'scan')
  // 글자층 있는 C/P가 같이 있으면 기본값은 그냥 양식 기본값, 값도 글자층 쪽에서
  const both = dealRows([load('SYN-CP-304'), load('SYN-CP-302'), load('SYN-SC-302')], dealOf('SYN-CP-304'))
  assert.equal(row(both, 'nor_notice_h').status, 'default')
  assert.equal(row(both, 'laytime_total_h').src.doc_id, 'SYN-CP-302')
})

test('일 체선료: 매매 확인서가 CP 요율 준용이면 C/P 값이 기준', () => {
  // SYN VEGA: 스캔 C/P에서 못 읽음 → 매매 확인서 값을 임시로 쓰고 검토 필수
  const vega = row(dealRows([load('SYN-CP-304'), load('SYN-SC-302')], dealOf('SYN-CP-304')), 'demurrage_rate_per_day')
  assert.equal(vega.reason, 'rate')
  assert.equal(vega.value, 46300)
  assert.deepEqual(vega.sources.map((x) => x.doc_id), ['SYN-CP-304', 'SYN-SC-302'])
  // 두 문서 값이 다르면 문서 간 불일치, 적용값은 C/P
  const sc = load('SYN-SC-302')
  sc.sales.demurrage_rate_per_day.value = 47000
  const diff = row(dealRows([load('SYN-CP-302'), sc], null), 'demurrage_rate_per_day')
  assert.equal(diff.reason, 'diff')
  assert.equal(diff.value, 46300)
  assert.equal(diff.src.doc_id, 'SYN-CP-302')
  // 별도 요율은 다른 계약이라 쓰지 않는다
  sc.sales.rate_basis.value = '별도'
  assert.equal(row(dealRows([load('SYN-CP-304'), sc], null), 'demurrage_rate_per_day').status, 'empty')
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
})

test('값 표시와 종류 판정', () => {
  assert.equal(fmtValue({ fmt: 'usd' }, 64500), 'USD 64,500 /일')
  assert.equal(fmtValue({ fmt: 'weather' }, 'FULL'), '전부 산입 (계산 공제 0%)')
  assert.equal(fmtValue({}, '2028-02-14T00:00:00'), '2028-02-14 00:00')
  assert.equal(detectKind('Fixture recap - SYN RIGEL'), 'recap')
  assert.equal(detectKind('SYN_VEGA_매매확인서.pdf'), 'sales')
  assert.equal(detectKind('SYN_VEGA_CP.pdf'), 'cp')
  assert.equal(detectKind('Fwd_ 선적 일정 문의.eml'), null)
})
