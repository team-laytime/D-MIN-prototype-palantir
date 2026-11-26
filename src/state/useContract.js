// 계약 문서 등록 · 추출값 검토 상태(시연용, 새로고침하면 처음으로). 두 화면이 같이 쓰므로 workspace.js처럼 작은 외부 저장소로 둔다.
// 파서 서버가 없어서 「올리기」는 흉내다: 몇 초 「추출 중」 뒤, 미리 만든 파서 결과(src/mock/contract, D-MIN-contract eval4_llm)를 종류별로 차례로 붙인다.
import { useSyncExternalStore } from 'react'
import { nowText } from '../lib/workspace.js'
import { dealRows, detectKind, vesselOf } from '../lib/contract.js'
import DEALS from '../mock/contract/deals.json'

const DOCS = Object.fromEntries(Object.values(import.meta.glob('../mock/contract/SYN-*.json', { eager: true, import: 'default' })).map((d) => [d.doc_id, d]))
export const FORM = { pdf: 'PDF', scan: '스캔 PDF', docx: 'DOCX', eml: '메일 (eml)', paste: '메일 붙여 넣기' }
export const ERROR = { vessel: '선박을 못 찾음', kind: '종류 판정 실패', empty: '글자를 하나도 못 읽음', duplicate: '중복 등록', pool: '시연용 추출 결과 없음' }
const EXTRACT_MS = 1800

// 처음부터 등록돼 있는 문서: [파서 doc_id | null, 형태, 파일 이름, 등록 시각, 오류]
const BY = '계약 담당 C'
const SEED = [
  ['SYN-CP-301', 'pdf', 'SYN_ALTAIR_CP_signed.pdf', '08:41'],
  ['SYN-SC-301', 'pdf', 'SYN_ALTAIR_매매확인서.pdf', '08:42'],
  ['SYN-CP-304', 'scan', 'SYN_VEGA_CP_scan.pdf', '08:47'],
  ['SYN-SC-302', 'docx', 'SYN_VEGA_매매확인서.docx', '08:48'],
  ['SYN-CP-303', 'pdf', 'SYN_DENEB_CP_signed.pdf', '08:55'],
  ['SYN-SC-303', 'pdf', 'SYN_DENEB_매매확인서.pdf', '08:56'],
  ['SYN-CP-305', 'pdf', 'SYN_RIGEL_CP_signed.pdf', '09:03'],
  ['SYN-RECAP-305', 'paste', 'Fixture recap - SYN RIGEL', '09:05'],
  ['SYN-SC-304', 'eml', 'SYN_RIGEL_매매확인서.eml', '09:06'],
  ['SYN-CP-307', 'pdf', 'SYN_ARCTURUS_CP_signed.pdf', '09:12'],
  ['SYN-SC-306', 'pdf', 'SYN_ARCTURUS_매매확인서.pdf', '09:13'],
  ['SYN-CP-315', 'scan', 'scan_0412.pdf', '09:20'], // 문자 인식으로 선박명을 못 읽음 → 선박을 못 찾음
  [null, 'eml', 'Fwd_ 선적 일정 문의.eml', '09:24', 'kind'],
  [null, 'scan', 'scan_0413.pdf', '09:25', 'empty'],
  [null, 'pdf', 'SYN_ALTAIR_CP_signed.pdf', '09:31', 'duplicate'],
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
  return { regs: SEED.map(([id, form, name, hm, err]) => reg(id, form, name, `2026-11-26 ${hm}`, err)), reviews: {}, pick: null }
}

let state = fresh()
let rev = 0
const listeners = new Set()
const set = (patch) => { state = { ...state, ...patch }; rev++; listeners.forEach((l) => l()) }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
/** 구독 훅: 바뀔 때마다 새 state 객체를 돌려준다. */
export const useContract = () => { useSyncExternalStore(subscribe, () => rev); return state }

const usedIds = () => new Set(state.regs.map((r) => r.docId).filter(Boolean))
const extDoc = (name) => {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'pdf' ? (/scan|스캔/i.test(name) ? 'scan' : 'pdf') : ext === 'docx' ? 'docx' : ext === 'eml' ? 'eml' : null
}

/** 등록 한 건. 중복·빈 문서는 바로 오류, 나머지는 「추출 중」 뒤에 종류 판정 → 파서 결과 붙이기. */
function add({ form, name, empty, dupKey, probe }, by) {
  const at = nowText()
  const dup = state.regs.some((r) => r.status !== 'error' && (r.dupKey ?? r.name) === dupKey)
  const error = dup ? 'duplicate' : empty ? 'empty' : null
  const r = { ...reg(null, form, name, at, error, by), dupKey, status: error ? 'error' : 'extracting' }
  set({ regs: [...state.regs, r] })
  if (error) return
  setTimeout(() => {
    const kind = detectKind(probe)
    // 파일 이름·본문에 선박명(마지막 단어, 예: BELLATRIX)이 있으면 그 선박 결과를 먼저 붙인다
    const free = kind ? POOL[kind].filter((id) => !usedIds().has(id)) : []
    const docId = free.find((id) => probe.toUpperCase().includes(vesselOf(DOCS[id])?.split(' ').pop())) ?? free[0]
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
/** 검토 기록. value가 없으면 「원문과 일치」, 있으면 직접 고친 값(이것도 검토 완료). */
export function review(dealKey, field, by, value) {
  set({ reviews: { ...state.reviews, [`${dealKey}:${field}`]: { by, at: nowText().slice(0, 16), ...(value !== undefined ? { value } : {}) } } })
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
