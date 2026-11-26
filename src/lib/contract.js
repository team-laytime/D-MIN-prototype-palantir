// 계약 문서 파서(D-MIN-contract) 출력 → 추출값 검토 화면의 행. 파서 JSON은 고치지 않고 여기서만 화면용으로 바꾼다.
//   문서 JSON: { doc_id, kind: cp|recap|sales, cp|sales: { 필드: { value, evidence } }, review, link? }
//   evidence: { doc_id, page, section, quote, confidence, method: rule|llm|manual, ocr, reviewed_by }
//   deals.json: [{ documents, conflicts(C/P↔recap), mismatches(C/P↔매매 확인서), cp_gaps(C/P 빈칸을 매매 확인서로 채움) }]
// 검토 필수는 세 경우만: 스캔본 문자 인식(evidence.ocr), 규칙에 안 맞아 LLM이 판정(method llm), 문서끼리 다름(deals).
// 파서 review[]의 「필수 칸 없음」·「확신도 낮음(빈칸 표기)」은 이 기준에 들지 않아 쓰지 않는다.

export const KIND = { cp: 'C/P', recap: 'Recap', sales: '매매 확인서' }
// recap · sales 구역은 문서 종류와 같아 출처에 다시 쓰지 않는다
export const SECTION = { part1: 'Part I', rider: 'Rider' }
export const REASON = { ocr: '스캔 문자 인식', llm: 'LLM 판정', diff: '문서끼리 다름' }
export const GROUPS = ['체선료 계산 조건', '선박·화물', '계약 당사자·양식', '그 외 특약']

// edit가 있는 4개만 값을 고칠 수 있다(계산에 쓰는 값). weather는 파서의 weather_rule + bad_weather_half를 한 줄로 합친 것.
const F = (key, label, group, fmt = null, edit = false) => ({ key, label, group, fmt, edit })
export const FIELDS = [
  F('laytime_total_h', '허용 정박시간', 0, 'h', true),
  F('demurrage_rate_per_day', '일 체선료', 0, 'usd', true),
  F('nor_notice_h', '정박시간 개시 (NOR 뒤)', 0, 'h', true),
  F('weather', '기상 조항', 0, 'weather', true),
  F('laytime_terms', '정박시간 조건', 0),
  F('laytime_load_h', '선적 허용시간', 0, 'h'),
  F('laytime_discharge_h', '양하 허용시간', 0, 'h'),
  F('load_port_laytime_h', '선적항 허용시간', 0, 'h'),
  F('laytime_prorate', '부분 화물 비례 배분', 0),
  F('laytime_start_rule', '정박시간 개시 규칙', 0),
  F('laytime_end_rule', '정박시간 종료 규칙', 0),
  F('laycan_from', '레이캔 시작', 0), F('laycan_to', '레이캔 끝', 0),
  F('load_laydays_from', '선적 레이데이즈 시작', 0), F('load_laydays_to', '선적 레이데이즈 끝', 0),
  F('discharge_laydays_from', '양하 레이데이즈 시작', 0), F('discharge_laydays_to', '양하 레이데이즈 끝', 0),
  F('currency', '통화', 0),
  F('vessel_name', '선박명', 1), F('imo', 'IMO', 1), F('dwt', '재화중량 (DWT)', 1, 't'), F('cargo', '화물', 1),
  F('cp_qty_t', '계약 물량', 1, 't'), F('load_ports', '선적항', 1), F('discharge_ports', '양하항', 1),
  F('cp_form', '계약 양식', 2), F('owner', '선주', 2), F('charterer', '용선자', 2),
  F('incoterm', '인도 조건', 2), F('sk_role', '당사 역할', 2), F('rate_basis', '체선료 요율 기준', 2),
  F('anchorage_to_berth_counts', '정박지→부두 이동 산입', 3), F('berth_shift_counts', '부두 이동 산입', 3),
  F('half_rate_events', '반값 체선료 사유', 3), F('no_demurrage_events', '체선료 면제 사유', 3), F('laytime_exclusions', '정박시간 제외', 3),
]

// 파서는 '산입' 기준(FULL = 악천후 시간을 정박시간에 전부 산입)이고 계산은 '공제' 기준(weather_deduct_pct)이라 방향이 반대다.
export const WEATHER = { FULL: { label: '전부 산입', deduct: 0 }, HALF: { label: '절반 산입', deduct: 50 }, NONE: { label: '산입 안 함', deduct: 100 } }
export const weatherDeductPct = (code) => WEATHER[code]?.deduct ?? null

// 특약에 바꾸는 조항이 없으면 양식 기본값. 값과 조항은 파서 프롬프트(D-MIN-contract src/cp_extract/llm.py)의 ASBATANKVOY 2025 Part II 기본값.
// shortcut: ASBATANKVOY만, 조항 원문 대신 요약 문장. 파서 레포에 양식별 기본값 표(조항 원문 포함)가 생기면 그걸 읽는다.
export const FORM_DEFAULTS = {
  nor_notice_h: { value: 6, clause: 'Part II 6', text: 'NOR 제출 6시간 뒤에 정박시간이 개시된다.' },
  weather: { value: 'HALF', clause: 'Part II 7(a)', text: '악천후로 부두 이동이 늦어진 시간은 정박시간에 절반만 산입한다.' },
  laytime_terms: { value: 'SHINC, 가역', clause: 'Part II 7', text: '일요일·공휴일 포함(SHINC), 선적과 양하 허용시간을 합산(가역)한다.' },
  laytime_prorate: { value: false, clause: 'Part II 7', text: '부분 화물이어도 허용시간을 비례 배분하지 않는다.' },
  laytime_end_rule: { value: '호스 분리·장비 철거·인원 하선 중 늦은 때 + 서류 3시간', clause: 'Part II 7(b)(c)', text: '호스 분리, 장비 철거, 인원 하선 중 가장 늦은 때에 서류 대기 3시간을 더한 때 끝난다.' },
  half_rate_events: { value: ['화재', '폭발', '폭풍', '파업', '직장 폐쇄', '설비 고장'], clause: 'Part II 8', text: '화재, 폭발, 폭풍, 파업, 직장 폐쇄, 설비 고장으로 생긴 체선은 반값이다.' },
  berth_shift_counts: { value: true, clause: 'Part II', text: '부두 사이 이동 시간은 정박시간에 산입한다.' },
  anchorage_to_berth_counts: { value: false, clause: 'Part II', text: '정박지·대기 장소에서 부두까지 이동하는 시간은 산입하지 않는다.' },
}

const CODE = { HOSES_OFF: '호스 분리 시 종료', PORT_CONGESTION: '항만 혼잡', CRUDE: '원유' }
const ORDER = { cp: 0, recap: 1, sales: 2 }

export const bodyOf = (doc) => doc.cp ?? doc.sales ?? {}
export const vesselOf = (doc) => bodyOf(doc).vessel_name?.value ?? doc.link?.vessel_name ?? null
// 문서 JSON은 2028-02-14T00:00:00, deals.json은 2028-02-14 00:00이라 비교 전에 맞춘다
export const norm = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v) ? v.slice(0, 16).replace('T', ' ') : v)

function pick(body, key) {
  if (key !== 'weather') return body[key] ?? null
  if (body.weather_rule?.value != null) return body.weather_rule
  if (body.bad_weather_half?.value === true) return { value: 'HALF', evidence: body.bad_weather_half.evidence }
  return null
}
const source = (doc, key, fallbackQuote = null) => {
  const c = pick(bodyOf(doc), key)
  const ev = c?.evidence ?? null
  return { doc_id: doc.doc_id, kind: doc.kind, value: c?.value ?? null, page: ev?.page ?? null, section: ev?.section ?? null, quote: ev?.quote ?? fallbackQuote, ev }
}

/**
 * 한 거래(같은 선박의 문서 묶음)의 추출값 행.
 * docs = 등록이 끝난 이 거래의 파서 문서들, deal = deals.json 항목(없으면 null).
 * 행: { key, label, group, fmt, edit, value, status: review|rule|default|empty, reason: ocr|llm|diff|null, src, sources[], note }
 */
export function dealRows(docs, deal) {
  const ds = [...docs].sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
  const byId = Object.fromEntries(ds.map((d) => [d.doc_id, d]))
  // 문서끼리 다른 값: 두 문서가 다 등록돼 있을 때만 센다
  const diffs = {}
  for (const c of deal?.conflicts ?? []) if (c.documents.every((id) => byId[id])) diffs[c.field] = { resolved: c.resolved_value, docs: c.documents, why: 'C/P와 recap 값이 다릅니다. 파서는 C/P 값을 골랐습니다.' }
  for (const m of deal?.mismatches ?? []) if (byId[deal.documents[0]] && byId[m.sc]) diffs[m.field] = { resolved: m.resolved_value, docs: [deal.documents[0], m.sc], why: 'C/P와 매매 확인서 값이 다릅니다. 파서는 C/P 값을 골랐습니다.' }
  for (const g of deal?.cp_gaps ?? []) if (byId[deal.documents[0]] && byId[g.sc]) diffs[g.field] = { resolved: g.resolved_value, docs: [deal.documents[0], g.sc], cpText: g.cp_text, why: 'C/P에 값이 없어(「' + g.cp_text + '」) 매매 확인서 값을 씁니다.' }
  const form = ds.map((d) => bodyOf(d).cp_form?.value).find(Boolean) ?? ''

  return FIELDS.map((f) => {
    const row = { ...f, value: null, status: 'empty', reason: null, src: null, sources: [], note: null }
    const diff = diffs[f.key]
    if (diff) {
      row.sources = diff.docs.map((id, i) => source(byId[id], f.key, i === 0 ? diff.cpText ?? null : null))
      row.value = diff.resolved
      row.src = row.sources.find((s) => norm(s.value) === norm(diff.resolved)) ?? row.sources[0]
      return { ...row, status: 'review', reason: 'diff', note: diff.why }
    }
    const hit = ds.map((d) => source(d, f.key)).find((s) => s.value != null)
    if (hit) {
      const reason = hit.ev?.ocr ? 'ocr' : hit.ev?.method === 'llm' ? 'llm' : null
      const note = reason === 'ocr' ? '스캔본을 문자 인식한 문장이라 글자가 틀렸을 수 있습니다.'
        : reason === 'llm' ? `규칙에 맞는 문장이 없어 LLM이 판정했습니다 (확신도 ${hit.ev.confidence}).` : null
      return { ...row, value: hit.value, src: hit, sources: [hit], status: reason ? 'review' : 'rule', reason, note }
    }
    const def = form.startsWith('ASBATANKVOY') ? FORM_DEFAULTS[f.key] : null
    if (def) {
      const src = { clause: `${form} ${def.clause}`, quote: def.text }
      return { ...row, value: def.value, src, sources: [src], status: 'default', note: '특약에 바꾸는 조항이 없어 양식 기본값을 씁니다.' }
    }
    return { ...row, note: '문서에서 이 항목을 찾지 못했습니다.' }
  })
}

/** 화면에 보이는 값. cur = 거래의 통화(일 체선료 앞에 붙임). */
export function fmtValue(f, v, cur = 'USD') {
  if (v == null || v === '') return '—'
  v = norm(v)
  if (f.fmt === 'weather') return WEATHER[v] ? `${WEATHER[v].label} (계산 공제 ${WEATHER[v].deduct}%)` : String(v)
  if (typeof v === 'number') {
    const n = v.toLocaleString('en-US')
    return f.fmt === 'usd' ? `${cur} ${n} /일` : f.fmt === 'h' ? `${n} h` : f.fmt === 't' ? `${n} t` : n
  }
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (Array.isArray(v)) return v.map((x) => CODE[x] ?? x).join(', ')
  return CODE[v] ?? String(v)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/**
 * 원문 문장에서 추출값이 나온 부분 찾기 → [앞, 찾은 부분, 뒤] 또는 null(못 찾음: 화면은 문장 전체를 강조).
 * 파서가 값 위치(bbox, span)를 주지 않아 값의 표기를 바꿔 가며 찾는다: 64500 → 64,500 · 2028-02-14 → 14 February 2028.
 */
export function findInQuote(quote, value) {
  if (!quote || value == null || typeof value === 'boolean') return null
  let pats = []
  if (typeof value === 'number') pats = [value.toLocaleString('en-US'), String(value)].map((s) => `(?<![\\d.,])${esc(s)}(?![\\d,])`)
  else {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) {
      const d = Number(m[3]); const mon = MONTHS[Number(m[2]) - 1]
      pats = [`${d} ${mon} ${m[1]}`, `${mon} ${d}, ${m[1]}`, `${d} ${mon}`, `${d} ${mon.slice(0, 3)}`, `${mon} ${d}`].map((s) => `(?<!\\d)${esc(s)}`)
    } else pats = [esc(String(value))]
  }
  for (const p of pats) {
    const hit = new RegExp(p, 'i').exec(quote)
    if (hit) return [quote.slice(0, hit.index), hit[0], quote.slice(hit.index + hit[0].length)]
  }
  return null
}

/** 파일 이름이나 붙여 넣은 본문으로 종류 판정(시연용 흉내). 못 정하면 null = 종류 판정 실패. */
export function detectKind(text) {
  if (/recap/i.test(text)) return 'recap'
  if (/매매|sales|confirmation|(^|[^a-z])s\/?c([^a-z]|$)/i.test(text)) return 'sales'
  if (/(^|[^a-z])c\/?p([^a-z]|$)|charter|asbatankvoy|용선/i.test(text)) return 'cp'
  return null
}
