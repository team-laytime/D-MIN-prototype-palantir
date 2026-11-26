// 계약 문서 파서(D-MIN-contract) 출력 → 추출값 검토 화면의 행. 파서 JSON은 고치지 않고 여기서만 화면용으로 바꾼다.
//   문서 JSON: { doc_id, kind: cp|recap|sales, cp|sales: { 필드: { value, evidence } }, review, link? }
//   evidence: { doc_id, page, section, quote, confidence, method: rule|llm|manual, ocr, reviewed_by }
//   deals.json: [{ documents, conflicts(C/P↔recap), mismatches(C/P↔매매 확인서), cp_gaps(C/P 빈칸을 매매 확인서로 채움) }]
// 검토 필수: 스캔본 문자 인식(evidence.ocr, confidence와 상관없이), 스캔본만 있을 때의 양식 기본값(특약을 못 읽었을 수 있음),
// 규칙에 안 맞아 LLM이 판정(method llm), 문서 간 불일치(deals · 체선료 요율 기준), C/P 요율을 못 읽음.
// 파서 review[]는 쓰지 않는다: 스캔본 특약 값은 confidence 0.8이라 review[]에 안 들어가고, 「필수 칸 없음」은 이 기준이 아니다.

export const KIND = { cp: 'C/P', recap: 'Recap', sales: '매매 확인서' }
// recap · sales 구역은 문서 종류와 같아 출처에 다시 쓰지 않는다
export const SECTION = { part1: 'Part I', rider: 'Rider' }
export const REASON = { ocr: 'OCR 판독', scan: '스캔본 특약 미확인', llm: 'AI 판독', diff: '문서 간 불일치', rate: 'C/P 요율 미확인', missing: '계산 값 없음', unread: 'OCR 못 읽음' }
// 계산에 쓰는 4개(값을 고칠 수 있는 칸)를 맨 위에 따로 둔다
export const GROUPS = ['계산에 쓰는 값', '정박시간 · 레이데이즈', '선박·화물', '계약 당사자·양식', '그 외 특약']

// edit가 있는 4개만 값을 고칠 수 있다(계산에 쓰는 값). weather는 파서의 weather_rule + bad_weather_half를 한 줄로 합친 것.
const F = (key, label, group, fmt = null, edit = false) => ({ key, label, group, fmt, edit })
export const FIELDS = [
  F('laytime_total_h', '허용 정박시간 (Laytime)', 0, 'h', true),
  F('demurrage_rate_per_day', '체선료율 (Demurrage)', 0, 'usd', true),
  F('nor_notice_h', 'NOR 후 정박시간 개시 (Notice time)', 0, 'h', true),
  F('weather', '악천후 조항 (Weather)', 0, 'weather', true),
  F('laytime_terms', '정박시간 조건', 1),
  F('laytime_load_h', '선적 허용시간', 1, 'h'),
  F('laytime_discharge_h', '양하 허용시간', 1, 'h'),
  F('load_port_laytime_h', '선적항 허용시간', 1, 'h'),
  F('laytime_prorate', '부분 적재 시 비례 배분 (Pro rata)', 1),
  F('laytime_start_rule', '정박시간 개시 규칙', 1),
  F('laytime_end_rule', '정박시간 종료 규칙', 1),
  F('laycan_from', '레이캔 시작', 1), F('laycan_to', '레이캔 끝', 1),
  F('load_laydays_from', '선적 Laydays 개시일', 1), F('load_laydays_to', '선적 Cancelling일', 1),
  F('discharge_laydays_from', '양하 Laydays 개시일', 1), F('discharge_laydays_to', '양하 Cancelling일', 1),
  F('currency', '통화', 1),
  F('vessel_name', '선박명', 2), F('imo', 'IMO', 2), F('dwt', '재화중량 (DWT)', 2, 't'), F('cargo', '화물', 2),
  F('cp_qty_t', 'C/P 수량', 2, 't'), F('load_ports', '선적항', 2), F('discharge_ports', '양하항', 2),
  F('cp_form', 'C/P 양식 (Form)', 3), F('owner', '선주', 3), F('charterer', '용선자', 3),
  F('incoterm', '인도 조건', 3), F('sk_role', '당사 역할', 3), F('rate_basis', '체선료 요율 기준', 3),
  F('anchorage_to_berth_counts', '정박지→선석 이동시간 산입', 4), F('berth_shift_counts', '선석 이동(Shifting) 산입', 4),
  F('half_rate_events', '체선료 반감 사유 (Half demurrage)', 4), F('no_demurrage_events', '체선료 면제 사유', 4), F('laytime_exclusions', '정박시간 공제 사유 (Exceptions)', 4),
]

// 파서는 '산입' 기준(FULL = 악천후 시간을 정박시간에 전부 산입)이고 계산은 '공제' 기준(weather_deduct_pct)이라 방향이 반대다.
export const WEATHER = { FULL: { label: '전부 산입', deduct: 0 }, HALF: { label: '절반 산입', deduct: 50 }, NONE: { label: '산입 안 함', deduct: 100 } }
export const weatherDeductPct = (code) => WEATHER[code]?.deduct ?? null

// 특약에 바꾸는 조항이 없으면 양식 기본값. 값과 조항은 파서 프롬프트(D-MIN-contract src/cp_extract/llm.py)의 ASBATANKVOY 2025 Part II 기본값.
// shortcut: ASBATANKVOY만, 조항 원문 대신 요약 문장. 파서 레포에 양식별 기본값 표(조항 원문 포함)가 생기면 그걸 읽는다.
export const FORM_DEFAULTS = {
  nor_notice_h: { value: 6, clause: 'Part II 6', text: 'NOR 제출 6시간 뒤에 정박시간이 개시된다.' },
  weather: { value: 'HALF', clause: 'Part II 7(a)', text: '악천후로 선석 이동이 늦어진 시간은 정박시간에 절반만 산입한다.' },
  laytime_terms: { value: 'SHINC, 가역', clause: 'Part II 7', text: '일요일·공휴일 포함(SHINC), 선적과 양하 허용시간을 합산(가역)한다.' },
  laytime_prorate: { value: false, clause: 'Part II 7', text: '부분 적재여도 허용시간을 비례 배분하지 않는다.' },
  laytime_end_rule: { value: '호스 분리·장비 철거·인원 하선 중 늦은 때 + 서류 3시간', clause: 'Part II 7(b)(c)', text: '호스 분리, 장비 철거, 인원 하선 중 가장 늦은 때에 서류 대기 3시간을 더한 때 끝난다.' },
  half_rate_events: { value: ['화재', '폭발', '폭풍', '파업', '직장 폐쇄', '설비 고장'], clause: 'Part II 8', text: '화재, 폭발, 폭풍, 파업, 직장 폐쇄, 설비 고장으로 생긴 체선은 체선료를 반감한다.' },
  berth_shift_counts: { value: true, clause: 'Part II', text: '선석 사이 이동(Shifting) 시간은 정박시간에 산입한다.' },
  anchorage_to_berth_counts: { value: false, clause: 'Part II', text: '정박지·대기 장소에서 선석까지 이동하는 시간은 산입하지 않는다.' },
}

const CODE = { HOSES_OFF: '호스 분리 시 종료', PORT_CONGESTION: '항만 혼잡', CRUDE: '원유' }
const ORDER = { cp: 0, recap: 1, sales: 2 }

export const bodyOf = (doc) => doc.cp ?? doc.sales ?? {}
export const vesselOf = (doc) => bodyOf(doc).vessel_name?.value ?? doc.link?.vessel_name ?? null
// 스캔본: 문자 인식한 칸이 하나라도 있는 문서(파서 reconcile._ocr와 같은 기준)
export const isScan = (doc) => Object.values(bodyOf(doc)).some((c) => c?.evidence?.ocr)
const riderPage = (doc) => {
  const pages = Object.values(bodyOf(doc)).filter((c) => c?.evidence?.section === 'rider').map((c) => c.evidence.page)
  return pages.length ? Math.min(...pages) : null
}
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
  return { doc_id: doc.doc_id, kind: doc.kind, value: c?.value ?? null, page: ev?.page ?? null, section: ev?.section ?? null, quote: ev?.quote ?? fallbackQuote, ev, scan: isScan(doc) }
}

/**
 * 한 거래(같은 선박의 문서 묶음)의 추출값 행.
 * docs = 등록이 끝난 이 거래의 파서 문서들, deal = deals.json 항목(없으면 null).
 * 행: { key, label, group, fmt, edit, value, status: review|rule|default|empty, reason: ocr|scan|llm|diff|rate|missing|unread|null, src, sources[], note,
 *       srcTag: 출처가 확인 대상이 아닐 때 붙이는 말(임시 · 양식 기본값), check: 실제로 확인할 문서 { doc_id, kind, page, section, scan } }
 */
export function dealRows(docs, deal) {
  // 같은 종류면 글자층이 있는 문서를 먼저(파서 reconcile과 같이 C/P 원본이 스캔 사본보다 앞)
  const ds = [...docs].sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || isScan(a) - isScan(b))
  const byId = Object.fromEntries(ds.map((d) => [d.doc_id, d]))
  // 문서끼리 다른 값: 두 문서가 다 등록돼 있을 때만 센다
  const diffs = {}
  for (const c of deal?.conflicts ?? []) if (c.documents.every((id) => byId[id])) diffs[c.field] = { resolved: c.resolved_value, docs: c.documents, why: 'C/P와 recap 값이 다릅니다. 파서는 C/P 값을 골랐습니다.' }
  for (const m of deal?.mismatches ?? []) if (byId[deal.documents[0]] && byId[m.sc]) diffs[m.field] = { resolved: m.resolved_value, docs: [deal.documents[0], m.sc], why: 'C/P와 매매 확인서 값이 다릅니다. 파서는 C/P 값을 골랐습니다.' }
  for (const g of deal?.cp_gaps ?? []) if (byId[deal.documents[0]] && byId[g.sc]) diffs[g.field] = { resolved: g.resolved_value, docs: [deal.documents[0], g.sc], cpText: g.cp_text, why: 'C/P에 값이 없어(「' + g.cp_text + '」) 매매 확인서 값을 씁니다.' }
  const form = ds.map((d) => bodyOf(d).cp_form?.value).find(Boolean) ?? ''
  const cps = ds.filter((d) => d.kind === 'cp')
  const scanOnly = cps.length > 0 && cps.every(isScan)

  return FIELDS.map((f) => {
    const row = { ...f, value: null, status: 'empty', reason: null, src: null, sources: [], note: null, srcTag: null, check: null }
    const diff = diffs[f.key]
    if (diff) {
      row.sources = diff.docs.map((id, i) => source(byId[id], f.key, i === 0 ? diff.cpText ?? null : null))
      row.value = diff.resolved
      row.src = row.sources.find((s) => norm(s.value) === norm(diff.resolved)) ?? row.sources[0]
      return { ...row, status: 'review', reason: 'diff', note: diff.why }
    }
    // 일 체선료: 매매 확인서가 「CP 요율 준용」이면 C/P 값이 기준이다(파서 reconcile.py와 같은 규칙). 「별도」 요율은 다른 계약이라 쓰지 않는다.
    if (f.key === 'demurrage_rate_per_day') {
      const sc = ds.find((d) => d.kind === 'sales' && bodyOf(d).rate_basis?.value === 'CP 요율 준용' && bodyOf(d)[f.key]?.value != null)
      const cp = ds.find((d) => d.kind !== 'sales' && bodyOf(d)[f.key]?.value != null)
      if (sc && cp && bodyOf(cp)[f.key].value !== bodyOf(sc)[f.key].value) {
        row.sources = [source(cp, f.key), source(sc, f.key)]
        return { ...row, value: row.sources[0].value, src: row.sources[0], status: 'review', reason: 'diff', note: `매매 확인서가 C/P 요율을 따르는데(CP 요율 준용) 두 문서 값이 다릅니다. ${KIND[cp.kind]} 값을 씁니다.` }
      }
      if (sc && !cp) {
        const scS = source(sc, f.key)
        row.sources = cps[0] ? [source(cps[0], f.key), scS] : [scS]
        // 적용값은 매매 확인서에서 임시로 가져오지만, 확인할 곳은 C/P(요율의 기준)
        const check = cps[0] ? { doc_id: cps[0].doc_id, kind: 'cp', page: null, section: null, scan: isScan(cps[0]) } : null
        return { ...row, value: scS.value, src: scS, status: 'review', reason: 'rate', srcTag: '임시', check,
          note: `매매 확인서는 C/P 요율을 따르는데(CP 요율 준용) ${cps[0] ? 'C/P에서 체선료율을 읽지 못했습니다' : 'C/P가 아직 없습니다'}. 매매 확인서 값을 임시로 씁니다. 원본 C/P에서 요율을 확인하십시오.` }
      }
    }
    const hit = ds.filter((d) => !(f.key === 'demurrage_rate_per_day' && d.kind === 'sales')).map((d) => source(d, f.key)).find((s) => s.value != null)
    // 스캔본에서 라벨 줄은 찾았는데 값을 못 읽은 칸(파서 evidence.unread: value null, quote · boxes는 라벨 줄)
    const unread = ds.map((d) => source(d, f.key)).find((s) => s.ev?.unread)
    // 다른 문서(recap · 매매 확인서) 값으로 채워졌으면 그 값은 임시, 확인할 곳은 못 읽은 스캔본. 글자층 C/P 사본이 채웠으면 그게 기준이라 그대로
    if (unread && hit && (hit.kind !== 'cp' || hit.scan)) {
      return { ...row, value: hit.value, src: hit, sources: [unread, hit], status: 'review', reason: 'unread', srcTag: '임시',
        check: { doc_id: unread.doc_id, kind: unread.kind, page: unread.page, section: unread.section, scan: true },
        note: `${KIND[unread.kind]} 스캔본에서 이 칸의 값을 OCR이 읽지 못해 ${KIND[hit.kind]} 값을 임시로 씁니다. ${KIND[unread.kind]} 원본에서 값을 확인하십시오.` }
    }
    if (hit) {
      const reason = hit.ev?.ocr ? 'ocr' : hit.ev?.method === 'llm' ? 'llm' : null
      const note = reason === 'ocr' ? '스캔본을 OCR로 판독한 문장이라 글자가 틀렸을 수 있습니다.'
        : reason === 'llm' ? `규칙에 맞는 문장이 없어 AI(LLM)가 판독했습니다 (확신도 ${hit.ev.confidence}).` : null
      return { ...row, value: hit.value, src: hit, sources: [hit], status: reason ? 'review' : 'rule', reason, note }
    }
    if (unread) {
      return { ...row, src: unread, sources: [unread], status: 'review', reason: 'unread',
        note: `스캔본에서 이 칸의 라벨은 찾았지만 OCR이 값을 읽지 못했습니다. 원본에서 값을 확인하십시오.${f.edit ? ' 계산에 쓰는 값이라 값을 넣어야 계산할 수 있습니다.' : ''}` }
    }
    const def = form.startsWith('ASBATANKVOY') ? FORM_DEFAULTS[f.key] : null
    if (def) {
      const src = { clause: `${form} ${def.clause}`, quote: def.text }
      if (!scanOnly) return { ...row, value: def.value, src, sources: [src], status: 'default', note: '특약에 바꾸는 조항이 없어 양식 기본값을 씁니다.' }
      // 스캔본은 특약에 조항이 없는 건지 문자 인식이 못 읽은 건지 모른다 → 원본 특약 쪽을 보고 확인
      // 값의 출처는 양식 조항이지만, 확인할 곳은 스캔 C/P의 특약(바꾸는 조항이 없는지). 특약 시작 쪽부터 연다
      // 특약 · Box M 쪽 범위는 파서 layout.sections(있으면), 없으면 특약 근거가 나온 첫 쪽부터
      const sec = cps[0].layout?.sections ?? {}
      const page = { doc_id: cps[0].doc_id, kind: 'cp', value: null, page: sec.rider?.[0] ?? riderPage(cps[0]), range: sec.rider ?? null, boxM: sec.box_m ?? null, section: 'rider', quote: null, scan: true }
      return { ...row, value: def.value, src, sources: [page, src], status: 'review', reason: 'scan', srcTag: '양식 기본값', check: page,
        note: '스캔본이라 특약에 이 조항을 바꾸는 문장이 없는 건지, OCR이 못 읽은 건지 알 수 없습니다. 원본 특약 쪽에 바꾸는 조항이 없으면 확인하십시오. 그때까지는 양식 기본값을 씁니다.' }
    }
    // 계산에 쓰는 값이 비면 계산을 못 한다 → 검토 필수. 문서에 빈칸 표기(To be advised · TBA)가 있으면 그 문장을 근거로 보인다
    if (f.edit) {
      const blank = ds.map((d) => source(d, f.key)).filter((s) => s.ev)
      return { ...row, src: blank[0] ?? null, sources: blank, status: 'review', reason: 'missing',
        note: `계산에 쓰는 값인데 문서에 값이 없습니다${blank.length ? `(「${blank[0].quote}」)` : ''}. 받은 값을 직접 넣어야 계산할 수 있습니다.` }
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
 * 문장 안의 값 위치는 파서가 주지 않아 값의 표기를 바꿔 가며 찾는다: 64500 → 64,500 · 2028-02-14 → 14 February 2028 · 14.02.2028 · 13-15 FEB 2028.
 */
export function findInQuote(quote, value) {
  if (!quote || value == null || typeof value === 'boolean') return null
  let pats = []
  if (typeof value === 'number') pats = [value.toLocaleString('en-US'), String(value)].map((s) => `(?<![\\d.,])${esc(s)}(?![\\d,])`)
  else {
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) {
      const d = Number(m[3]); const mon = MONTHS[Number(m[2]) - 1]; const m3 = mon.slice(0, 3)
      // 기간 표기(13-15 NOV 2025)는 시작 · 끝 어느 쪽이든 기간 전체를 강조한다
      const range = [`0?${d}-\\d{1,2} ${m3} ${m[1]}`, `\\d{1,2}-0?${d} ${m3} ${m[1]}`]
      pats = [...[`${m[3]}.${m[2]}.${m[1]}`, `${d} ${mon} ${m[1]}`, `${mon} ${d}, ${m[1]}`].map(esc), ...range, ...[`${d} ${mon}`, `${d} ${m3}`, `${mon} ${d}`].map(esc)]
        .map((s) => `(?<!\\d)${s}`)
    } else pats = [esc(String(value))]
  }
  for (const p of pats) {
    const hit = new RegExp(p, 'i').exec(quote)
    if (hit) return [quote.slice(0, hit.index), hit[0], quote.slice(hit.index + hit[0].length)]
  }
  return null
}

/**
 * 원본 본문(recap 메일 · 텍스트)에서 근거 문장 위치 찾기 → [시작, 끝] 또는 null.
 * 목업 값은 시연용으로 날짜를 옮겨 원본과 숫자 · 달 이름이 다를 수 있어, 그 둘은 느슨하게(숫자 아무거나 · 달 이름 아무거나) 맞춘다.
 */
const MONTH_WORD = new RegExp(`\\b(${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|')})\\b`, 'gi')
export function findQuoteInText(text, quote) {
  if (!text || !quote?.trim()) return null
  const exact = text.indexOf(quote)
  if (exact >= 0) return [exact, exact + quote.length]
  const pat = esc(quote.trim()).replace(MONTH_WORD, '[A-Za-z]+').replace(/\d+/g, '\\d+').replace(/\s+/g, '\\s+')
  const hit = new RegExp(pat, 'i').exec(text)
  return hit ? [hit.index, hit.index + hit[0].length] : null
}

/** 파일 이름이나 붙여 넣은 본문으로 종류 판정(시연용 흉내). 못 정하면 null = 종류 판정 실패. */
export function detectKind(text) {
  if (/recap/i.test(text)) return 'recap'
  if (/매매|sales|confirmation|(^|[^a-z])s\/?c([^a-z]|$)/i.test(text)) return 'sales'
  if (/(^|[^a-z])c\/?p([^a-z]|$)|charter|asbatankvoy|용선/i.test(text)) return 'cp'
  return null
}
