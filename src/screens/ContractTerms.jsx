// 추출값 검토: 왼쪽 선박(거래) 목록, 오른쪽 추출값 표. 행을 누르면 바로 아래에 근거가 열린다.
// 스캔본은 근거 줄을 원본 쪽에서 잘라 확대하고(파서 evidence.boxes) 위치에 박스를 친다. 글자층 PDF는 원문 문장에서 값을 강조한다.
// 문서 전체는 「원본 보기」 드로어로 본다. 검토 필수는 「원문과 일치」 · 「변경 조항 없음 확인」(같은 쪽 · 같은 이유는 한 번에),
// 문서 간 불일치는 어느 문서 값을 쓸지 고르고, 계산에 쓰는 4개는 값을 고칠 수 있다. 끝나면 다음 검토 항목으로 넘어가 초점도 옮긴다.
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, ButtonGroup, Callout, Checkbox, Drawer, HTMLSelect, Icon, NonIdealState } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { dealViews, docFile, pageCount, pageImage, pickDeal, review, reviewMany, useContract } from '../state/useContract.js'
import { GROUPS, KIND, REASON, SECTION, WEATHER, bodyOf, findInQuote, findQuoteInText, fmtValue, norm } from '../lib/contract.js'
import { Panel, Screen, St } from '../ui/kit.jsx'
import './contract.css'

// 값 표시: 모노 글꼴은 숫자 · 시각 · ID · 짧은 코드(KRUSN · USD)에만. 이름 · 한글 문장은 본문 글꼴(DESIGN.md: 모노 글꼴에 한글을 넣지 않는다)
function Val({ text }) {
  const [, base, unit = ''] = text.match(/^(.*?)( \/일)?$/)
  const data = !/[가-힣]/.test(base) && (/\d/.test(base) || /^[A-Z]{2,6}$/.test(base))
  return data ? <><span className="num">{base}</span>{unit}</> : text
}
// shortcut: 합성 계약서는 모두 A4 세로라 쪽 비율을 고정한다. 다른 크기 문서가 오면 이미지 크기에서 읽는다.
const PAGE_RATIO = 1.414
const DATE_HINT = '시연용으로 날짜를 옮겨, 화면 값과 원본(2028년)의 날짜가 다릅니다.'
const CONFIRM = { scan: '변경 조항 없음 확인', unread: '원본 확인함' }

function SrcLabel({ s }) {
  if (s.clause) return <>{s.clause}</>
  return <>{KIND[s.kind]} <span className="num">{s.doc_id}</span>{s.page ? ` · ${s.page}쪽` : ''}{SECTION[s.section] ? ` · ${SECTION[s.section]}` : ''}</>
}

// 특약 범위: 특약 근거가 나온 첫 쪽부터 문서 끝까지(특약은 C/P 뒤에 붙는다).
// shortcut: 파서가 특약 구간의 쪽 범위를 내주지 않아 추정한다. 파서 출력에 범위가 생기면 그걸 쓴다.
// 파서가 layout.sections를 주면 그 범위(c.range · c.boxM)를 쓴다.
const span = ([a, b]) => (a === b ? `${a}쪽` : `${a}~${b}쪽`)
const riderRange = (c) => { if (c.range) return span(c.range); const n = pageCount(c.doc_id); return n > c.page ? `${c.page}~${n}쪽` : `${c.page}쪽부터` }
const checkHint = (c) => (c?.section === 'rider' && c.page ? `${c.boxM ? `Box M(${span(c.boxM)})과 ` : ''}특약 ${riderRange(c)}에 이 조항을 바꾸는 문장이 없는지 확인합니다.` : null)

// 출처와 확인할 곳이 다른 행(임시 값 · 양식 기본값): 실제로 볼 문서
function CheckLabel({ c }) {
  return <>{KIND[c.kind]} <span className="num">{c.doc_id}</span>{c.scan ? ' 스캔' : ''}{c.boxM ? ` · Box M ${span(c.boxM)}` : ''}{c.section === 'rider' && c.page ? ` · 특약 ${riderRange(c)}` : ''}</>
}

function Quote({ text, value, scan }) {
  if (!text) return <p className="ct-quote faint">{scan ? 'OCR 판독 결과에 이 항목이 없습니다.' : '원문 문장이 없습니다.'}</p>
  const hit = findInQuote(text, value)
  // 값 위치를 못 찾으면 문장 전체가 추출 근거다
  return <p className="ct-quote">{hit ? <>{hit[0]}<mark>{hit[1]}</mark>{hit[2]}</> : <mark>{text}</mark>}</p>
}

// 근거 줄을 원본 쪽에서 잘라 확대한다. 위치는 모두 쪽 대비 비율이라 %로 놓는다. 위아래로 한 줄쯤 여유, 가로는 쪽 너비의 절반 이상(맥락 · 선명도).
function Crop({ s, onOpen, small = false }) {
  const url = pageImage(s.doc_id, s.page)
  const bx = s.ev?.boxes
  if (!url || !bx?.length) return null
  const lo = Math.min(...bx.map((b) => b[0])); const hi = Math.max(...bx.map((b) => b[2]))
  const W = Math.min(1, Math.max(hi - lo + 0.06, 0.5))
  const x0 = Math.min(Math.max(0, (lo + hi) / 2 - W / 2), 1 - W)
  const y0 = Math.max(0, Math.min(...bx.map((b) => b[1])) - 0.02)
  const H = Math.min(1, Math.max(...bx.map((b) => b[3])) + 0.02) - y0
  const pct = (v) => `${v * 100}%`
  return (
    <button type="button" className={`ct-crop ${small ? 'small' : ''}`} style={{ aspectRatio: `${W} / ${H * PAGE_RATIO}` }} onClick={onOpen}
      aria-label={`원본 ${s.page}쪽에서 근거 위치 크게 보기`} title="원본 쪽에서 크게 보기">
      <img src={url} alt="" style={{ width: pct(1 / W), left: pct(-x0 / W), top: pct(-y0 / H) }} />
      {bx.map((b, i) => <span key={i} className="ct-box" style={{ left: pct((b[0] - x0) / W), top: pct((b[1] - y0) / H), width: pct((b[2] - b[0]) / W), height: pct((b[3] - b[1]) / H) }} />)}
    </button>
  )
}

// 근거 위치를 모르는 스캔본(문자 인식이 값을 못 읽음 · 특약에 조항이 없는지 확인): 쪽 전체를 작게, 누르면 원본 보기
function ScanPage({ s, hint, onOpen }) {
  const page = s.page ?? 1
  const url = pageImage(s.doc_id, page)
  const rider = s.section === 'rider' && !s.ev && s.page
  const label = rider ? `원본 특약 ${riderRange(s)}` : s.page ? `원본 ${s.page}쪽` : '원본 (근거 쪽 모름)'
  if (!url) return <div className="ct-scan-page ph" role="img" aria-label={`${label} 스캔 이미지 (자리 표시)`}><Icon icon="media" size={20} /><span>{label} 스캔 이미지</span></div>
  return (
    <figure className="ct-scan-fig">
      <button type="button" className="ct-scan-btn" onClick={() => onOpen(s.doc_id, page, hint)} aria-label={`${label} 원본 보기`}><img className="ct-scan-page" src={url} alt="" /></button>
      <figcaption className="faint tiny">{rider ? `특약 ${riderRange(s)}` : s.page ? `${s.page}쪽` : '근거 위치를 모릅니다'} · 누르면 원본 보기</figcaption>
    </figure>
  )
}

function Source({ s, row, cur, pick, onOpen }) {
  const file = !s.clause && docFile(s.doc_id)
  // 근거 위치가 없는 확인 대상: 원본을 열 때 무엇을 찾아야 하는지 같이 넘긴다
  const hint = s.section === 'rider' && !s.ev ? checkHint(s)
    : row.reason === 'rate' && s.doc_id === row.check?.doc_id ? `OCR이 이 값을 읽지 못해 근거 위치가 없습니다. 쪽을 넘기며 「${row.label}」 칸을 찾아 확인합니다.` : null
  const open = () => onOpen(s.doc_id, s.page, hint)
  const value = pick ? fmtValue(row, s.value, cur) : null
  // 근거 박스가 있으면 스캔본 · 글자층 PDF 모두 원본 쪽에서 잘라 위치를 보인다. 글자층은 아래 원문 문장이 정확한 글자다
  const crop = s.ev?.boxes?.length && pageImage(s.doc_id, s.page)
  const quoteTitle = s.scan ? 'OCR 판독 결과' : '원문 문장'
  return (
    <div className="ct-src">
      <div className="ct-src-head">
        <span><SrcLabel s={s} /></span>
        {s.clause && <span className="chip">양식 조항 요약</span>}
        {pick && <span>이 문서 값 <b><Val text={value} /></b></span>}
        {s.scan && <span className="chip amber">{s.ev?.ocr ? 'OCR 판독' : '스캔본'}</span>}
        {s.ev?.ocr_conf != null && <span>인식 신뢰도 <span className="num">{Math.round(s.ev.ocr_conf * 100)}%</span></span>}
        {file && <Button size="small" variant="minimal" icon="document-open" text="원본 보기" onClick={open} />}
      </div>
      {crop
        ? <div className="ct-crop-wrap"><Crop s={s} onOpen={open} /><div><span className="faint tiny">{quoteTitle}</span><Quote text={s.quote} value={s.value ?? row.value} scan={s.scan} /></div></div>
        : s.scan
          ? <div className="ct-scan"><ScanPage s={s} hint={hint} onOpen={onOpen} /><div><span className="faint tiny">OCR 판독 결과</span><Quote text={s.quote} value={s.value ?? row.value} scan /></div></div>
          : <Quote text={s.quote} value={s.clause ? null : s.value ?? row.value} />}
    </div>
  )
}

function StatusCell({ row, rv }) {
  if (rv) {
    return (
      <span className="ct-rv">
        {rv.from ? <span className="chip blue">{rv.from} 값 적용</span>
          : 'value' in rv ? <span className="chip blue">직접 수정</span>
            : <St tone="ok">{row.reason === 'scan' ? '변경 조항 없음' : '원문과 일치'}</St>}
        <span className="faint tiny">{rv.by} · <span className="num">{rv.at.slice(11)}</span></span>
      </span>
    )
  }
  if (row.status === 'review') return <span className="ct-rv"><St tone="warn">검토 필수</St><span className="chip amber">{REASON[row.reason]}</span></span>
  if (row.status === 'rule') return <St tone="idle">자동 추출</St>
  if (row.status === 'default') return <St tone="idle">양식 기본값</St>
  return <span className="faint">값 없음</span>
}

// 값 고치기: 숫자 3개는 입력, 기상 조항은 산입 기준 3가지 중 하나(계산 공제 %를 같이 보인다).
function Editor({ row, current, onSave }) {
  const [draft, setDraft] = useState(current ?? (row.fmt === 'weather' ? 'HALF' : ''))
  const n = Number(draft)
  const ok = row.fmt === 'weather' ? draft in WEATHER : draft !== '' && Number.isFinite(n) && n >= 0
  return (
    <div className="ct-edit">
      {row.fmt === 'weather'
        ? <HTMLSelect value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${row.label} 값`}
          options={Object.entries(WEATHER).map(([value, w]) => ({ value, label: `${w.label} (계산 공제 ${w.deduct}%)` }))} />
        : <input className="bp6-input num" type="number" min="0" step={row.fmt === 'usd' ? 100 : 1} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`${row.label} 값`} />}
      <span className="faint tiny">{row.fmt === 'usd' ? 'USD /일' : row.fmt === 'h' ? '시간' : ''}</span>
      <Button icon="edit" text="고친 값 저장" disabled={!ok || (row.fmt === 'weather' ? draft : n) === current} onClick={() => onSave(row.fmt === 'weather' ? draft : n)} />
    </div>
  )
}

function Detail({ row, rv, cur, peers, autoFocus, onConfirm, onConfirmAll, onPick, onSave, onOpen }) {
  const ref = useRef(null)
  // 앞 항목을 확인하고 넘어왔으면 이 항목의 첫 동작(값을 넣어야 하는 행은 입력 칸)에 초점: 키보드로 이어서 검토
  useEffect(() => { if (autoFocus) ref.current?.querySelector('.ct-actions button:not([disabled]), .ct-actions input, .ct-actions select')?.focus() }, [autoFocus])
  // 문서 값 고르기: 문서 간 불일치 · C/P 요율 미확인 · 못 읽은 칸을 다른 문서 값으로 임시로 채운 경우
  const pick = row.reason === 'diff' || row.reason === 'rate' || (row.reason === 'unread' && row.value != null)
  // 값이 없으니 「일치」가 아니라 받은 값을 넣어 끝낸다(계산에 쓰는 칸)
  const fill = row.edit && row.value == null && (row.reason === 'missing' || row.reason === 'unread')
  const todo = row.status === 'review' && !rv
  const verb = CONFIRM[row.reason] ?? '원문과 일치'
  return (
    <div className="ct-detail-body" ref={ref}>
      {row.note && <p className="ct-note">{row.note}</p>}
      {row.sources.map((s) => <Source key={s.doc_id ?? s.clause} s={s} row={row} cur={cur} pick={pick} onOpen={onOpen} />)}
      {todo && peers.length > 0 && (
        <div className="ct-peers">
          <div className="ct-src-head">{row.reason === 'scan' ? `같은 이유(스캔본 특약 미확인)의 다른 항목 ${peers.length}건` : `같은 쪽(${row.src.page}쪽)의 다른 검토 필수 ${peers.length}건`}</div>
          <ul>
            {peers.map((r) => {
              const v = fmtValue(r, r.value, cur)
              return (
                <li key={r.key}>
                  <span className="ct-peer-label">{r.label}</span>
                  <span><Val text={v} /></span>
                  {r.src?.ev?.boxes && <Crop s={r.src} small onOpen={() => onOpen(r.src.doc_id, r.src.page)} />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <div className="ct-actions">
        {todo && !pick && !fill && <Button intent="primary" icon="tick" text={verb} onClick={onConfirm} />}
        {todo && fill && <span className="c-amber small">값을 넣어 저장하면 검토가 끝납니다.</span>}
        {todo && !pick && !fill && peers.length > 0 && <Button icon="tick-circle" text={`${verb}: 위 ${peers.length}건까지 모두 (${peers.length + 1}건)`} onClick={onConfirmAll} />}
        {todo && pick && row.sources.filter((s) => s.value != null && !s.clause).map((s) => (
          <Button key={s.doc_id} intent={norm(s.value) === norm(row.value) ? 'primary' : 'none'} icon="tick" text={`${KIND[s.kind]} 값 적용`} onClick={() => onPick(s)} />
        ))}
        {rv && 'value' in rv && <span className="faint small">파서 값 <Val text={fmtValue(row, row.value, cur)} /></span>}
        {row.edit && <Editor row={row} current={rv?.value ?? norm(row.value)} onSave={onSave} />}
        {!row.edit && !todo && row.status !== 'empty' && <span className="faint small">원문 확인만 하는 항목입니다. 값은 계산에 쓰는 4개만 고칠 수 있습니다.</span>}
      </div>
    </div>
  )
}

// 원본 전체 보기: PDF(스캔본 · 글자층)는 쪽 이미지 위에 근거 위치를 칠하고, recap(텍스트 · 메일)은 본문의 근거 문장을 굵게 · 밑줄로.
// 표시 범위는 이 항목 · 검토 필수 · 전체 · 끄기. 칠한 곳을 누르면 그 항목의 값과 상태가 뜬다.
// 쪽 이미지는 버튼, Ctrl/⌘ + 휠(트랙패드 핀치), 두 번 누르기로 확대하고, 확대하면 끌어서 옮긴다.
const rowKeyOf = (k) => (k === 'weather_rule' || k === 'bad_weather_half' ? 'weather' : k)
const MARKS = [['field', '이 항목'], ['review', '검토 필수'], ['all', '전체'], ['off', '끄기']]
const ZOOM = [1, 4]

function rowStatus(r, rv) {
  if (!r) return '표에 없는 항목'
  if (rv) return rv.from ? `${rv.from} 값 적용` : 'value' in rv ? '직접 수정' : r.reason === 'scan' ? '변경 조항 없음 확인' : '원문과 일치 확인'
  return r.status === 'review' ? `검토 필수 · ${REASON[r.reason]}` : r.status === 'rule' ? '자동 추출' : r.status === 'default' ? '양식 기본값' : '값 없음'
}

// 칠한 곳을 눌렀을 때의 설명(쪽 이미지에서는 그 위치 아래, 본문에서는 위쪽 줄)
function PopInfo({ k, doc, row, rv, cur, onGoto, onClose }) {
  const c = bodyOf(doc)[k]
  const v = fmtValue(k === 'bad_weather_half' ? {} : row ?? {}, c.value, cur)
  return (
    <>
      <div className="ct-pop-head"><b>{row?.label ?? k}</b><Button size="small" variant="minimal" icon="cross" aria-label="설명 닫기" onClick={onClose} /></div>
      <div>이 문서 값 <b><Val text={v} /></b></div>
      <div className={row?.status === 'review' && !rv ? 'c-amber' : 'muted'}>{rowStatus(row, rv)}</div>
      {c.evidence.ocr_conf != null && <div className="faint">인식 신뢰도 <span className="num">{Math.round(c.evidence.ocr_conf * 100)}%</span></div>}
      {row?.src?.doc_id && row.src.doc_id !== doc.doc_id && <div className="faint">적용값은 {KIND[row.src.kind]} <span className="num">{row.src.doc_id}</span> 값</div>}
      {row && <Button size="small" icon="th" text="추출값 표에서 보기" onClick={() => onGoto(row.key)} />}
    </>
  )
}

// recap 본문: 근거 문장 위치를 찾아(findQuoteInText) 겹치는 구간은 합치고, 칠한 구간을 누르면 설명
function TextDoc({ text, marks, field, sel, onSel }) {
  const ranges = marks.map(([k, c]) => { const r = findQuoteInText(text, c.evidence.quote); return r && { s: r[0], e: r[1], k } }).filter(Boolean)
  const cuts = [...new Set([0, text.length, ...ranges.flatMap((r) => [r.s, r.e])])].sort((a, b) => a - b)
  const parts = cuts.slice(0, -1).map((a, i) => ({ a, b: cuts[i + 1], keys: ranges.filter((r) => r.s <= a && r.e >= cuts[i + 1]).map((r) => r.k) }))
  return (
    <pre className="ct-txt">
      {parts.map(({ a, b, keys }) => (keys.length
        ? <mark key={a} role="button" tabIndex={0} className={`${keys.some((k) => rowKeyOf(k) === field) ? 'on' : 'other'} ${keys.includes(sel) ? 'sel' : ''}`}
          aria-label={`근거 문장: ${keys.join(', ')}`} onClick={() => onSel(keys[0])} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSel(keys[0]) } }}>{text.slice(a, b)}</mark>
        : <Fragment key={a}>{text.slice(a, b)}</Fragment>))}
    </pre>
  )
}

function DocViewer({ doc, page, field, hint, rows, left, rvOf, cur, onGoto, onClose }) {
  const file = docFile(doc.doc_id)
  const [p, setP] = useState(page ?? 1)
  const [mode, setMode] = useState(field ? 'field' : 'all')
  const [sel, setSel] = useState(null)
  const [z, setZ] = useState(1)
  const scroller = useRef(null)
  const anchor = useRef(null)
  const drag = useRef(null)
  const rowOf = (k) => rows.find((r) => r.key === rowKeyOf(k))
  const todo = new Set(left.filter((r) => r.sources.some((x) => x.doc_id === doc.doc_id)).map((r) => r.key))
  const want = ([k]) => mode === 'all' || (mode === 'field' && rowKeyOf(k) === field) || (mode === 'review' && todo.has(rowKeyOf(k)))
  const onPage = file?.pages ? Object.entries(bodyOf(doc)).filter(([, c]) => c?.evidence?.page === p && c.evidence.boxes?.length) : []
  const shown = onPage.filter(want)
  const textMarks = file?.text != null ? Object.entries(bodyOf(doc)).filter(([, c]) => c?.evidence?.quote).filter(want) : []
  const modes = (
    <>
      <span className="faint small">표시</span>
      <ButtonGroup size="small">
        {MARKS.map(([m, t]) => <Button key={m} text={t} active={mode === m} disabled={m === 'field' && !field} aria-pressed={mode === m} onClick={() => { setMode(m); setSel(null) }} />)}
      </ButtonGroup>
    </>
  )
  const info = sel && <PopInfo k={sel.k} doc={doc} row={rowOf(sel.k)} rv={rowOf(sel.k) && rvOf(rowOf(sel.k).key)} cur={cur} onGoto={onGoto} onClose={() => setSel(null)} />

  // 확대: 커서(없으면 가운데) 아래 지점이 그대로 있게 스크롤을 맞춘다
  const zoomTo = (next, cx, cy) => {
    const el = scroller.current
    const nz = Math.min(ZOOM[1], Math.max(ZOOM[0], Math.round(next * 100) / 100))
    if (!el || nz === z) return
    const r = el.getBoundingClientRect()
    const x = cx == null ? el.clientWidth / 2 : cx - r.left
    const y = cy == null ? el.clientHeight / 2 : cy - r.top
    anchor.current = { fx: (el.scrollLeft + x) / el.scrollWidth, fy: (el.scrollTop + y) / el.scrollHeight, x, y }
    setZ(nz)
  }
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo
  useLayoutEffect(() => {
    const a = anchor.current; const el = scroller.current
    if (!a || !el) return
    el.scrollLeft = a.fx * el.scrollWidth - a.x
    el.scrollTop = a.fy * el.scrollHeight - a.y
    anchor.current = null
  }, [z])
  // Ctrl/⌘ + 휠(맥 트랙패드 핀치도 ctrlKey로 온다)은 확대, 그냥 휠은 스크롤. React onWheel은 passive라 직접 붙인다
  const attach = useCallback((el) => {
    scroller.current = el
    if (!el) return
    el.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomRef.current(zRef.current * Math.exp(-e.deltaY * 0.004), e.clientX, e.clientY)
    }, { passive: false })
  }, [])
  const zRef = useRef(z)
  zRef.current = z
  // 끌어서 옮기기. 거의 안 움직였으면 클릭으로 보고 떠 있는 설명을 닫는다
  const down = (e) => {
    if (e.button !== 0 || e.target.closest('.ct-box, .ct-pop')) return
    const el = scroller.current
    drag.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop, moved: false }
  }
  const move = (e) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true
    scroller.current.scrollLeft = d.l - (e.clientX - d.x)
    scroller.current.scrollTop = d.t - (e.clientY - d.y)
  }
  const up = () => { const d = drag.current; drag.current = null; if (d && !d.moved) setSel(null) }
  const go = (np) => { setP(np); setSel(null) }

  const popBox = sel && bodyOf(doc)[sel.k]?.evidence?.boxes?.[sel.i]
  return (
    <Drawer isOpen position="right" size="760px" onClose={onClose} icon="document" title={`${KIND[doc.kind]} ${doc.doc_id} 원본`} className="ct-viewer">
      <div className="ct-viewer-body">
        {file?.pages && (
          <>
            <div className="ct-viewer-bar">
              <Button size="small" variant="minimal" icon="chevron-left" aria-label="앞 쪽" disabled={p <= 1} onClick={() => go(p - 1)} />
              <span className="small"><span className="num">{p} / {file.pages}</span>쪽</span>
              <Button size="small" variant="minimal" icon="chevron-right" aria-label="다음 쪽" disabled={p >= file.pages} onClick={() => go(p + 1)} />
              <span className="ct-viewer-sep" />
              {modes}
              <span className="ct-viewer-sep" />
              <Button size="small" variant="minimal" icon="zoom-out" aria-label="축소" disabled={z <= ZOOM[0]} onClick={() => zoomTo(z - 0.5)} />
              <Button size="small" variant="minimal" text={<span className="num">{Math.round(z * 100)}%</span>} title="폭 맞춤" aria-label="폭에 맞추기" onClick={() => zoomTo(1)} />
              <Button size="small" variant="minimal" icon="zoom-in" aria-label="확대" disabled={z >= ZOOM[1]} onClick={() => zoomTo(z + 0.5)} />
            </div>
            <p className="faint small ct-viewer-hint">
              {hint ?? (page ? `이 항목 근거는 ${page}쪽입니다.` : '이 항목은 근거 위치를 모릅니다.')} 이 쪽 표시 {shown.length}곳 / 추출 {onPage.length}곳 · 칠한 곳을 누르면 무엇인지 보입니다 · Ctrl/⌘ + 휠, 두 번 누르기로 확대
            </p>
            <div className={`ct-viewer-scroll ${z > 1 ? 'zoomed' : ''}`} ref={attach}>
              <div className="ct-viewer-page" style={{ width: `${z * 100}%` }}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { drag.current = null }}
                onDoubleClick={(e) => { if (!e.target.closest('.ct-box, .ct-pop')) zoomTo(z < 2 ? 2 : 1, e.clientX, e.clientY) }}>
                <img src={pageImage(doc.doc_id, p)} alt={`${doc.doc_id} 원본 ${p}쪽 스캔 이미지`} draggable={false} />
                {shown.map(([k, c]) => c.evidence.boxes.map((b, i) => (
                  <button type="button" key={`${k}-${i}`} aria-label={`${rowOf(k)?.label ?? k} 근거 위치`}
                    className={`ct-box ${rowKeyOf(k) === field ? 'on' : 'other'} ${sel?.k === k ? 'sel' : ''}`}
                    style={{ left: `${b[0] * 100}%`, top: `${b[1] * 100}%`, width: `${(b[2] - b[0]) * 100}%`, height: `${(b[3] - b[1]) * 100}%` }}
                    onClick={(e) => { e.stopPropagation(); setSel({ k, i }) }} />
                )))}
                {popBox && (
                  <div className="ct-pop" role="dialog" aria-label="칠한 곳 설명" style={{ left: `${Math.min(popBox[0], 0.55) * 100}%`, top: `calc(${popBox[3] * 100}% + 6px)` }}>{info}</div>
                )}
              </div>
            </div>
          </>
        )}
        {file?.pdf && <iframe className="ct-pdf" title={`${doc.doc_id} 원본 PDF`} src={`${file.pdf}#page=${page ?? 1}`} />}
        {file?.text != null && (
          <>
            <div className="ct-viewer-bar">{modes}</div>
            <p className="faint small ct-viewer-hint">{hint ?? ''} 근거 문장 {textMarks.length}곳을 굵게 · 밑줄로 표시했습니다 · 누르면 무엇인지 보입니다</p>
            {sel && <div className="ct-pop ct-pop-bar" role="dialog" aria-label="칠한 곳 설명">{info}</div>}
            <div className="ct-viewer-scroll"><TextDoc text={file.text} marks={textMarks} field={field} sel={sel?.k} onSel={(k) => setSel({ k })} /></div>
          </>
        )}
        {!file && <NonIdealState icon="document" title="원본 파일이 없습니다" description="시연 데이터에 이 문서의 원본은 넣지 않았습니다." />}
        <p className="faint tiny ct-viewer-note">{DATE_HINT}</p>
      </div>
    </Drawer>
  )
}

export default function ContractTerms() {
  const { role } = useApp()
  const s = useContract()
  const views = dealViews(s)
  const view = views.find((v) => v.key === s.pick) ?? views[0]
  const [open, setOpen] = useState(null)
  const [showEmpty, setShowEmpty] = useState(false)
  const [viewer, setViewer] = useState(null)
  const focusNext = useRef(false)
  // 자식(Detail)의 초점 옮기기가 끝난 뒤 내린다
  useEffect(() => { focusNext.current = false })

  if (!view) {
    return (
      <Screen tab="terms" title="추출값 검토">
        <NonIdealState icon="document" title="검토할 문서가 없습니다" description="「문서 등록」에서 문서를 넣으면 추출이 끝난 뒤 여기에 선박별로 모입니다." />
      </Screen>
    )
  }

  const cur = view.rows.find((r) => r.key === 'currency')?.value ?? 'USD'
  const rvOf = (key) => s.reviews[`${view.key}:${key}`]
  const choose = (key) => { pickDeal(key); setOpen(null) }
  // 다음 검토 항목: 이 선박에서 지금 행 뒤의 남은 것 → 없으면 남은 것이 있는 다음 선박의 첫 항목
  const next = (doneKeys, fromKey) => {
    focusNext.current = true
    const left = view.left.filter((r) => !doneKeys.includes(r.key))
    const i = view.rows.findIndex((r) => r.key === fromKey)
    const after = left.find((r) => view.rows.indexOf(r) > i) ?? left[0]
    if (after) return setOpen(after.key)
    const vi = views.indexOf(view)
    const other = [...views.slice(vi + 1), ...views.slice(0, vi)].find((v) => v.left.length)
    if (other) { pickDeal(other.key); setOpen(other.left[0].key) } else setOpen(null)
  }
  // 한 번에 확인할 수 있는 같은 묶음: 같은 스캔 쪽의 문자 인식 값, 또는 스캔본 특약 기본값 전부
  const peersOf = (row) => (row.reason === 'ocr'
    ? view.left.filter((r) => r.key !== row.key && r.reason === 'ocr' && r.src?.doc_id === row.src?.doc_id && r.src?.page === row.src?.page)
    : row.reason === 'scan' ? view.left.filter((r) => r.key !== row.key && r.reason === 'scan') : [])
  const confirm = (row) => { review(view.key, row.key, role.name); next([row.key], row.key) }
  const confirmAll = (row) => { const keys = [row.key, ...peersOf(row).map((r) => r.key)]; reviewMany(view.key, keys, role.name); next(keys, row.key) }
  const pickValue = (row, src) => { review(view.key, row.key, role.name, norm(src.value), KIND[src.kind]); next([row.key], row.key) }
  const save = (row, value) => { review(view.key, row.key, role.name, value); if (row.status === 'review' && !rvOf(row.key)) next([row.key], row.key) }
  const openDoc = (docId, page, field, hint = null) => setViewer({ docId, page, field, hint })
  // 값 없는 항목은 기본으로 접어 둔다. 계산에 쓰는 4개는 비어 있어도 고칠 수 있게 늘 보인다.
  const emptyCount = view.rows.filter((r) => r.status === 'empty' && !r.edit).length
  const visible = view.rows.filter((r) => showEmpty || r.status !== 'empty' || r.edit)
  const viewerDoc = viewer && view.docs.find((d) => d.doc_id === viewer.docId)

  return (
    <Screen tab="terms" title="추출값 검토" desc="검토 필수는 OCR 판독 값 · 스캔본의 양식 기본값, AI 판독, 문서 간 불일치입니다. 나머지는 원문만 볼 수 있습니다.">
      <div className="ct-grid">
        <Panel code="VESSELS" title="선박" desc={`${views.length}척`}>
          <ul className="ct-vessels">
            {views.map((v) => (
              <li key={v.key}>
                <button type="button" className={`ct-vessel ${v.key === view.key ? 'on' : ''}`} aria-current={v.key === view.key ? 'true' : undefined} onClick={() => choose(v.key)}>
                  <span className="ct-vessel-main">
                    <span className="ct-vessel-name">{v.vessel}</span>
                    <span className="faint tiny">{v.docs.map((d) => KIND[d.kind]).join(' · ')}{v.recapOnly && v.left.length > 0 && <span className="c-amber"> · C/P 없음</span>}</span>
                  </span>
                  {v.left.length > 0
                    ? <span className="ct-left num" aria-label={`검토 필수 ${v.left.length}건`}>{v.left.length}</span>
                    : v.recapOnly ? <St tone="warn" className="tiny">C/P 없음</St> : <St tone="ok" className="tiny">끝</St>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel code="TERMS" title={view.vessel}
          actions={<>
            <span role="status" aria-live="polite" className={view.left.length || view.recapOnly ? 'c-amber small' : 'c-green small'}>
              {view.left.length ? `검토 필수 ${view.left.length}건 남음` : view.recapOnly ? '서명된 C/P 없음' : '검토 끝'}
            </span>
            <Checkbox className="ct-check" checked={showEmpty} onChange={(e) => setShowEmpty(e.currentTarget.checked)} label={`값 없는 항목 보기 (${emptyCount})`} />
          </>}>
          <div className="ct-docbar">
            <span className="faint small">원본</span>
            {view.docs.map((d) => (
              <Button key={d.doc_id} size="small" variant="outlined" icon="document-open" onClick={() => openDoc(d.doc_id, null, null)}
                text={<>{KIND[d.kind]} <span className="num">{d.doc_id}</span></>} disabled={!docFile(d.doc_id)} />
            ))}
            <span className="faint tiny ct-docbar-note">{DATE_HINT}</span>
          </div>
          {view.recapOnly && (
            <Callout intent="warning" icon="warning-sign" className="ct-callout" title="서명된 C/P 없이 recap만 있습니다">
              값은 recap 기준입니다. 서명된 C/P를 넣으면 문서끼리 다시 맞춰 봅니다.
            </Callout>
          )}
          <table className="dt ct-terms">
            <thead><tr><th>항목</th><th>적용값</th><th>출처</th><th>추출 · 검토 상태</th></tr></thead>
            {GROUPS.map((g, gi) => {
              const rows = visible.filter((r) => r.group === gi)
              if (!rows.length) return null
              return (
                <tbody key={g}>
                  <tr className="ct-group"><td colSpan={4}>{g}</td></tr>
                  {rows.map((r) => {
                    const rv = rvOf(r.key)
                    const on = open === r.key
                    const toggle = () => setOpen(on ? null : r.key)
                    const shown = fmtValue(r, rv && 'value' in rv ? rv.value : r.value, cur)
                    return (
                      <Fragment key={r.key}>
                        <tr className={`click ${on ? 'on' : ''} ${r.status === 'empty' ? 'ct-empty' : ''}`} tabIndex={0} aria-expanded={on}
                          onClick={toggle} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle() } }}>
                          <td>{r.label}{r.edit && <span className="chip ct-calc">계산</span>}</td>
                          <td className={rv && 'value' in rv ? 'c-blue' : r.status === 'default' ? 'muted' : ''}><Val text={shown} /></td>
                          <td className="faint small">
                            {r.src ? <SrcLabel s={r.src} /> : '—'}{r.srcTag && ` (${r.srcTag})`}
                            {r.check && r.status === 'review' && !rv && <div className="ct-check-at">확인할 곳: <CheckLabel c={r.check} /></div>}
                          </td>
                          <td><StatusCell row={r} rv={rv} /></td>
                        </tr>
                        {on && (
                          <tr className="ct-detail"><td colSpan={4}>
                            <Detail key={r.key} row={r} rv={rv} cur={cur} peers={peersOf(r)} autoFocus={focusNext.current}
                              onConfirm={() => confirm(r)} onConfirmAll={() => confirmAll(r)} onPick={(src) => pickValue(r, src)} onSave={(v) => save(r, v)}
                              onOpen={(docId, page, hint) => openDoc(docId, page, r.key, hint)} />
                          </td></tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              )
            })}
          </table>
        </Panel>
      </div>
      {viewerDoc && <DocViewer key={`${viewer.docId}-${viewer.page}-${viewer.field}`} doc={viewerDoc} page={viewer.page} field={viewer.field} hint={viewer.hint}
        rows={view.rows} left={view.left} rvOf={rvOf} cur={cur} onGoto={(k) => { setViewer(null); focusNext.current = true; setOpen(k) }} onClose={() => setViewer(null)} />}
    </Screen>
  )
}
