// 계약 문서 등록 · 추출값 검토 상태(시연용, 새로고침하면 처음으로). 날짜는 기준 시각 2025-11-09 09:00 기준: 등록은 직전 며칠, Laydays는 직후 며칠. 두 화면이 같이 쓰므로 workspace.js처럼 작은 외부 저장소로 둔다.
// 파서 서버가 없어서 「올리기」는 흉내다: 몇 초 「추출 중」 뒤, 미리 만든 파서 결과(src/mock/contract, D-MIN-contract eval4_llm)를 종류별로 차례로 붙인다.
import { useSyncExternalStore } from 'react'
import { dealRows, detectKind, vesselOf } from '../lib/contract.js'
import DEALS from '../mock/contract/deals.json'

const DOCS = Object.fromEntries(Object.values(import.meta.glob('../mock/contract/SYN-*.json', { eager: true, import: 'default' })).map((d) => [d.doc_id, d]))
export const FORM = { pdf: 'PDF', scan: '스캔 PDF', docx: 'DOCX', eml: '메일 (eml)', txt: '텍스트 (txt)', paste: '메일 붙여 넣기' }
export const ERROR = { vessel: '선박명 판독 실패', kind: '문서 종류 미확인', empty: '판독 불가', duplicate: '중복 등록', pool: '시연용 추출 결과 없음' }
const EXTRACT_MS = 1800
// 시연 시계: 상단 기준 시각(데이터셋 기본 2025-11-09 09:00)에서 화면을 연 뒤 흐른 만큼. 등록 · 검토 시각이 실제 오늘 날짜와 섞이지 않게 한다.
// shortcut: 기준 시각을 다른 날로 골라도 따라가지 않는다. 계약 화면이 데이터셋 시각을 쓰게 되면 app 상태의 T를 받는다.
const T0 = Date.parse('2025-11-09T09:00:00+09:00')
const OPENED = Date.now()
const clock = () => new Date(T0 + Date.now() - OPENED + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')

// 처음부터 등록돼 있는 문서: [파서 doc_id | null, 형태, 파일 이름, 등록 월-일 시각(기준 시각 직전 며칠), 오류]
const BY = '계약 담당 C'
const SEED = [
  // 파일 이름은 합성 계약서 묶음(D-MIN_합성계약서 eval4)의 원본 이름 그대로
  ['SYN-CP-301', 'pdf', 'SYN-CP-301.pdf', '11-05 08:41'],
  ['SYN-SC-301', 'pdf', 'SYN-SC-301.pdf', '11-05 08:42'],
  ['SYN-CP-304', 'scan', 'SYN-CP-304.pdf', '11-06 08:47'],
  ['SYN-SC-302', 'pdf', 'SYN-SC-302.pdf', '11-06 08:48'],
  ['SYN-CP-303', 'pdf', 'SYN-CP-303.pdf', '11-06 08:55'],
  ['SYN-SC-303', 'pdf', 'SYN-SC-303.pdf', '11-06 08:56'],
  ['SYN-CP-305', 'pdf', 'SYN-CP-305.pdf', '11-07 09:03'],
  ['SYN-RECAP-305', 'txt', 'SYN-RECAP-305.txt', '11-07 09:05'],
  ['SYN-SC-304', 'pdf', 'SYN-SC-304.pdf', '11-07 09:06'],
  ['SYN-CP-307', 'pdf', 'SYN-CP-307.pdf', '11-07 09:12'],
  ['SYN-SC-306', 'pdf', 'SYN-SC-306.pdf', '11-07 09:13'],
  ['SYN-CP-315', 'scan', 'SYN-CP-315.pdf', '11-08 09:20'], // OCR로 선박명을 못 읽음 → 선박명 판독 실패
  [null, 'eml', 'Fwd_ 선적 일정 문의.eml', '11-08 09:24', 'kind'],
  [null, 'scan', 'scan_0413.pdf', '11-08 09:25', 'empty'],
  [null, 'pdf', 'SYN-CP-301.pdf', '11-08 09:31', 'duplicate'],
]
// 올리면 붙는 파서 결과(종류별 차례). recap을 먼저 붙여 넣으면 SYN BELLATRIX가 「recap만 있음」이 되고, C/P를 올리면 풀린다.
const POOL = { cp: ['SYN-CP-302', 'SYN-CP-312', 'SYN-CP-314'], recap: ['SYN-RECAP-318'], sales: ['SYN-SC-310', 'SYN-SC-312'] }

let seq = 0
const reg = (docId, form, name, at, error = null, by = BY) => {
  const doc = docId ? DOCS[docId] : null
  return { no: ++seq, docId, kind: doc?.kind ?? null, form, name, at, by, status: error ? 'error' : 'done', error: error ?? (doc && !vesselOf(doc) ? 'vessel' : null) }
}
const fresh = () => {
  seq = 0
  return { regs: SEED.map(([id, form, name, md, err]) => reg(id, form, name, `2025-${md}`, err)), reviews: {}, pick: null }
}

let state = fresh()
let gen = 0 // 시연 초기화 횟수: 초기화 전에 시작한 「추출 중」이 끝나도 새 목록에 붙지 않게
let rev = 0
const listeners = new Set()
const set = (patch) => { state = { ...state, ...patch }; rev++; listeners.forEach((l) => l()) }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
/** 구독 훅: 바뀔 때마다 새 state 객체를 돌려준다. */
export const useContract = () => { useSyncExternalStore(subscribe, () => rev); return state }

const usedIds = () => new Set(state.regs.map((r) => r.docId).filter(Boolean))
const extDoc = (name) => {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'pdf' ? (/scan|스캔/i.test(name) ? 'scan' : 'pdf') : ['docx', 'eml', 'txt'].includes(ext) ? ext : null
}

/** 등록 한 건. 중복·빈 문서는 바로 오류, 나머지는 「추출 중」 뒤에 종류 판정 → 파서 결과 붙이기. */
function add({ form, name, empty, dupKey, probe }, by) {
  const at = clock()
  const dup = state.regs.some((r) => r.status !== 'error' && (r.dupKey ?? r.name) === dupKey)
  const error = dup ? 'duplicate' : empty ? 'empty' : null
  const r = { ...reg(null, form, name, at, error, by), dupKey, status: error ? 'error' : 'extracting' }
  set({ regs: [...state.regs, r] })
  if (error) return
  const g = gen
  setTimeout(() => {
    if (g !== gen) return
    const kind = detectKind(probe)
    // 파일 이름에 문서 번호(SYN-CP-312 등)나 선박명(마지막 단어, 예: BELLATRIX)이 있으면 그 결과를 먼저 붙인다
    const free = kind ? POOL[kind].filter((id) => !usedIds().has(id)) : []
    const P = probe.toUpperCase()
    const docId = free.find((id) => P.includes(id)) ?? free.find((id) => P.includes(vesselOf(DOCS[id])?.split(' ').pop())) ?? free[0]
    const doc = docId ? DOCS[docId] : null
    const done = !kind ? { status: 'error', error: 'kind' } : !doc ? { status: 'error', error: 'pool', kind }
      : { status: 'done', docId, kind: doc.kind, error: vesselOf(doc) ? null : 'vessel' }
    set({ regs: state.regs.map((x) => (x.no === r.no ? { ...x, ...done } : x)) })
  }, EXTRACT_MS)
}
export function registerFiles(files, by) {
  for (const f of files) {
    const form = extDoc(f.name)
    // shortcut: 파일 이름이 같으면 중복으로 본다. 실제 파서가 붙으면 내용 해시로 바꾼다.
    if (form) add({ form, name: f.name, empty: f.size === 0, dupKey: f.name, probe: f.name }, by)
  }
}
/** 붙여 넣은 메일 본문: 이름은 첫 줄(제목), 같은 본문이면 중복, 종류는 본문 전체로 판정. */
export function registerText(text, by) {
  add({ form: 'paste', name: text.trim().split('\n')[0].slice(0, 80), empty: !text.trim(), dupKey: `paste:${text.trim()}`, probe: text }, by)
}
export function pickDeal(key) { set({ pick: key }) }
/** 시연 초기화(상단 메뉴): 등록 문서 · 검토 기록을 처음 상태로. 다른 화면처럼 메모리에만 있어 새로고침해도 처음으로 돌아간다. */
export function resetContract() { gen++; state = fresh(); set({}) }
/** 검토 기록. value가 없으면 「원문과 일치」, 있으면 고친 값(이것도 검토 완료). from = 문서 간 불일치에서 고른 문서 종류(C/P · 매매 확인서 …). */
export function review(dealKey, field, by, value, from) {
  set({ reviews: { ...state.reviews, [`${dealKey}:${field}`]: { by, at: clock().slice(0, 16), ...(value !== undefined ? { value } : {}), ...(from ? { from } : {}) } } })
}
/** 같은 쪽 · 같은 이유의 검토 필수를 한 번에 「원문과 일치」(스캔본 특약 기본값이면 「변경 조항 없음」)로. */
export function reviewMany(dealKey, fields, by) {
  const at = clock().slice(0, 16)
  set({ reviews: { ...state.reviews, ...Object.fromEntries(fields.map((f) => [`${dealKey}:${f}`, { by, at }])) } })
}
/** 등록 한 건 지우기. 추출이 끝난 문서면 그 선박(거래)의 문서 조합이 바뀌므로 그 선박의 검토 기록도 처음으로 돌린다. */
export function removeReg(no) {
  const docId = state.regs.find((r) => r.no === no)?.docId
  const deal = docId && DEALS.find((d) => d.documents.includes(docId))
  const reviews = deal ? Object.fromEntries(Object.entries(state.reviews).filter(([k]) => !k.startsWith(`${deal.documents[0]}:`))) : state.reviews
  set({ regs: state.regs.filter((r) => r.no !== no), reviews })
}

/** 거래(선박)별 화면 모델: 등록이 끝난 문서만으로 행을 만든다. 선박명을 못 읽은 문서는 빠진다. */
export function dealViews(s) {
  const ids = new Set(s.regs.filter((r) => r.status === 'done' && !r.error).map((r) => r.docId))
  return DEALS.flatMap((deal) => {
    const docs = deal.documents.filter((id) => ids.has(id)).map((id) => DOCS[id])
    if (!docs.length) return []
    const key = deal.documents[0]
    const rows = dealRows(docs, deal)
    const left = rows.filter((r) => r.status === 'review' && !s.reviews[`${key}:${r.key}`])
    return [{ key, vessel: docs.map(vesselOf).find(Boolean), docs, rows, left, recapOnly: docs.some((d) => d.kind === 'recap') && !docs.some((d) => d.kind === 'cp') }]
  })
}
/** 등록 문서 한 건의 남은 검토 필수 수(이 문서가 출처인 행). */
export const leftFor = (view, docId) => view.left.filter((r) => r.sources.some((x) => x.doc_id === docId)).length
export const docOf = (docId) => DOCS[docId] ?? null
// 원본 쪽 이미지: 합성 계약서 원본 PDF 쪽을 그림으로 바꿔 넣은 것(pages/<doc_id>-<쪽>.jpg|png). 없으면 null → 화면은 자리 표시.
// PDF 16건의 파서 출력은 D-MIN-contract scan-review-info(153e2f9)를 규칙만(tesseract, LLM 없이) 돌린 것(data/out/front/rules).
// 그 출력에서 빈 LLM 칸 2개(SYN-CP-303 nor_notice_h, SYN-CP-314 laytime_prorate)만 eval4_llm 것을 남겼고, recap 2건은 eval4_llm 그대로.
// shortcut: LLM 최종본(data/out/front/llm)이 오면 16건을 그걸로 바꾸고 남긴 LLM 칸은 지운다.
// shortcut: 파서를 붙이면 서버가 쪽 이미지를 내보내는 주소로 바꾼다.
// 글자층 PDF 쪽은 1비트 PNG(150dpi, 쪽당 35~50KB), 스캔본은 흑백 JPEG(110dpi). 근거 박스는 둘 다 같은 방식(쪽 대비 비율)으로 얹는다
const PAGES = Object.fromEntries(Object.entries(import.meta.glob('../mock/contract/pages/*.{jpg,png}', { eager: true, query: '?url', import: 'default' }))
  .map(([path, url]) => [path.split('/').pop().replace(/\.(jpg|png)$/, ''), url]))
export const pageImage = (docId, page) => PAGES[`${docId}-${page}`] ?? null
export const pageCount = (docId) => Object.keys(PAGES).filter((k) => k.startsWith(`${docId}-`)).length
// 원본 전체 보기: PDF는 위 쪽 이미지(없으면 files/의 PDF를 브라우저 PDF 보기로), recap은 텍스트 원본(files/).
const name = (path) => path.split('/').pop().replace(/\.\w+$/, '')
const PDFS = Object.fromEntries(Object.entries(import.meta.glob('../mock/contract/files/*.pdf', { eager: true, query: '?url', import: 'default' })).map(([p, u]) => [name(p), u]))
const TEXTS = Object.fromEntries(Object.entries(import.meta.glob('../mock/contract/files/*.txt', { eager: true, query: '?raw', import: 'default' })).map(([p, t]) => [name(p), t]))
/** 원본 파일: { pages: 스캔본 쪽 수 } | { pdf: 주소 } | { text: 본문 } | null */
export const docFile = (docId) => (pageCount(docId) ? { pages: pageCount(docId) } : PDFS[docId] ? { pdf: PDFS[docId] } : TEXTS[docId] != null ? { text: TEXTS[docId] } : null)
