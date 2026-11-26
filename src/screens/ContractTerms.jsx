// 추출값 검토: 왼쪽 선박(거래) 목록, 오른쪽 추출값 표. 행을 누르면 바로 아래에 원문 문장이 열리고 추출된 부분이 강조된다.
// 검토 필수는 「원문과 일치」(스캔본 양식 기본값은 「변경 조항 없음 확인」)나 값 수정으로 끝내고, 다음 검토 항목으로 넘어간다.
// 스캔본 원문은 왼쪽 원본 쪽 이미지, 오른쪽 문자 인식 결과. 글자층이 있는 PDF는 원문 문장만.
import { Fragment, useState } from 'react'
import { Button, Callout, Checkbox, HTMLSelect, Icon, NonIdealState } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { dealViews, pageImage, pickDeal, review, useContract } from '../state/useContract.js'
import { GROUPS, KIND, REASON, SECTION, WEATHER, findInQuote, fmtValue, norm } from '../lib/contract.js'
import { Panel, Screen, St } from '../ui/kit.jsx'
import './contract.css'

const srcText = (s) => (s.clause ? s.clause : [`${KIND[s.kind]} ${s.doc_id}`, s.page && `${s.page}쪽`, SECTION[s.section]].filter(Boolean).join(' · '))

function Quote({ text, value, scan }) {
  if (!text) return <p className="ct-quote faint">{scan ? '문자 인식 결과에 이 항목이 없습니다.' : '원문 문장이 없습니다.'}</p>
  const hit = findInQuote(text, value)
  // 값 위치를 못 찾으면 문장 전체가 추출 근거다
  return <p className="ct-quote">{hit ? <>{hit[0]}<mark>{hit[1]}</mark>{hit[2]}</> : <mark>{text}</mark>}</p>
}

// 스캔본 원본 쪽. 값 위치(bbox)가 아직 없어 쪽 전체를 보인다. 목업에는 이미지가 없어 자리 표시만.
function ScanPage({ s }) {
  const label = s.page ? `원본 ${s.page}쪽 스캔 이미지` : s.section === 'rider' ? '원본 특약 쪽 스캔 이미지' : '원본 스캔 이미지 (쪽 번호 모름)'
  const url = pageImage(s.doc_id, s.page)
  if (url) return <img className="ct-scan-page" src={url} alt={label} />
  return <div className="ct-scan-page ph" role="img" aria-label={`${label} (자리 표시)`}><Icon icon="media" size={20} /><span>{label}</span></div>
}

const CONFIRM = { scan: '변경 조항 없음 확인' }

function StatusCell({ row, rv }) {
  if (rv) {
    return (
      <span className="ct-rv">
        {'value' in rv ? <span className="chip blue">직접 수정</span> : <St tone="ok">{row.reason === 'scan' ? '변경 조항 없음' : '원문과 일치'}</St>}
        <span className="faint tiny">{rv.by} · {rv.at.slice(11)}</span>
      </span>
    )
  }
  if (row.status === 'review') return <span className="ct-rv"><St tone="warn">검토 필수</St><span className="chip amber">{REASON[row.reason]}</span></span>
  if (row.status === 'rule') return <St tone="idle">규칙 추출</St>
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

function Detail({ row, rv, cur, onConfirm, onSave }) {
  return (
    <div className="ct-detail-body">
      {row.note && <p className="ct-note">{row.note}</p>}
      {row.sources.map((s) => (
        <div key={s.doc_id ?? s.clause} className="ct-src">
          <div className="ct-src-head">
            <span className="num">{srcText(s)}</span>
            {s.clause && <span className="chip">양식 조항 요약</span>}
            {(row.reason === 'diff' || row.reason === 'rate') && <span>이 문서 값 <b className="num">{fmtValue(row, s.value, cur)}</b></span>}
            {s.scan && <span className="chip amber">{s.ev?.ocr ? '스캔 문자 인식' : '스캔본'}</span>}
          </div>
          {s.scan
            ? (
              <div className="ct-scan">
                <ScanPage s={s} />
                <div><span className="faint tiny">문자 인식 결과</span><Quote text={s.quote} value={s.value ?? row.value} scan /></div>
              </div>
            )
            : <Quote text={s.quote} value={s.clause ? null : s.value ?? row.value} />}
        </div>
      ))}
      <div className="ct-actions">
        {row.status === 'review' && !rv && <Button intent="primary" icon="tick" text={CONFIRM[row.reason] ?? '원문과 일치'} onClick={onConfirm} />}
        {rv && 'value' in rv && <span className="faint small">원래 값 {fmtValue(row, row.value, cur)}</span>}
        {row.edit && <Editor row={row} current={rv?.value ?? norm(row.value)} onSave={onSave} />}
        {!row.edit && row.status !== 'review' && row.status !== 'empty' && <span className="faint small">원문 확인만 하는 항목입니다. 값은 계산 조건 4개만 고칠 수 있습니다.</span>}
      </div>
    </div>
  )
}

export default function ContractTerms() {
  const { role } = useApp()
  const s = useContract()
  const views = dealViews(s)
  const view = views.find((v) => v.key === s.pick) ?? views[0]
  const [open, setOpen] = useState(null)
  const [showEmpty, setShowEmpty] = useState(false)

  if (!view) {
    return (
      <Screen tab="terms" title="추출값 검토">
        <NonIdealState icon="document" title="검토할 문서가 없습니다" description="「계약 문서」에서 문서를 넣으면 추출이 끝난 뒤 여기에 선박별로 모입니다." />
      </Screen>
    )
  }

  const cur = view.rows.find((r) => r.key === 'currency')?.value ?? 'USD'
  const rvOf = (key) => s.reviews[`${view.key}:${key}`]
  const choose = (key) => { pickDeal(key); setOpen(null) }
  // 다음 검토 항목: 이 선박에서 지금 행 뒤의 남은 것 → 없으면 남은 것이 있는 다음 선박의 첫 항목
  const next = (doneKey) => {
    const left = view.left.filter((r) => r.key !== doneKey)
    const i = view.rows.findIndex((r) => r.key === doneKey)
    const after = left.find((r) => view.rows.indexOf(r) > i) ?? left[0]
    if (after) return setOpen(after.key)
    const vi = views.indexOf(view)
    const other = [...views.slice(vi + 1), ...views.slice(0, vi)].find((v) => v.left.length)
    if (other) { pickDeal(other.key); setOpen(other.left[0].key) } else setOpen(null)
  }
  const confirm = (row) => { review(view.key, row.key, role.name); next(row.key) }
  const save = (row, value) => { review(view.key, row.key, role.name, value); if (row.status === 'review' && !rvOf(row.key)) next(row.key) }
  // 값 없는 항목은 기본으로 접어 둔다. 계산 조건 4개는 비어 있어도 고칠 수 있게 늘 보인다.
  const emptyCount = view.rows.filter((r) => r.status === 'empty' && !r.edit).length
  const visible = view.rows.filter((r) => showEmpty || r.status !== 'empty' || r.edit)

  return (
    <Screen tab="terms" title="추출값 검토" desc="검토 필수는 스캔본 값 · 스캔본의 양식 기본값, LLM 판정, 문서 간 불일치입니다. 나머지는 원문만 볼 수 있습니다.">
      <div className="ct-grid">
        <Panel code="VESSELS" title="선박" desc={`${views.length}척`}>
          <ul className="ct-vessels">
            {views.map((v) => (
              <li key={v.key}>
                <button type="button" className={`ct-vessel ${v.key === view.key ? 'on' : ''}`} aria-current={v.key === view.key ? 'true' : undefined} onClick={() => choose(v.key)}>
                  <span className="ct-vessel-main">
                    <span className="ct-vessel-name">{v.vessel}</span>
                    <span className="faint tiny">{v.docs.map((d) => KIND[d.kind]).join(' · ')}</span>
                  </span>
                  {v.left.length > 0
                    ? <span className="rail-badge hot num" aria-label={`검토 필수 ${v.left.length}건`}>{v.left.length}</span>
                    : <St tone="ok" className="tiny">끝</St>}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel code="TERMS" title={view.vessel} desc={view.docs.map((d) => d.doc_id).join(', ')}
          actions={<>
            <span className={view.left.length ? 'c-amber small' : 'c-green small'}>{view.left.length ? `검토 필수 ${view.left.length}건 남음` : '검토 끝'}</span>
            <Checkbox className="ct-check" checked={showEmpty} onChange={(e) => setShowEmpty(e.currentTarget.checked)} label={`값 없는 항목 보기 (${emptyCount})`} />
          </>}>
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
                    return (
                      <Fragment key={r.key}>
                        <tr className={`click ${on ? 'on' : ''} ${r.status === 'empty' ? 'ct-empty' : ''}`} tabIndex={0} aria-expanded={on}
                          onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } }}>
                          <td>{r.label}{r.edit && <span className="chip ct-calc">계산</span>}</td>
                          <td className={rv && 'value' in rv ? 'c-blue num' : r.status === 'default' ? 'muted' : 'num'}>{fmtValue(r, rv && 'value' in rv ? rv.value : r.value, cur)}</td>
                          <td className="faint small">{r.src ? srcText(r.src) : '—'}</td>
                          <td><StatusCell row={r} rv={rv} /></td>
                        </tr>
                        {on && (
                          <tr className="ct-detail"><td colSpan={4}>
                            <Detail key={r.key} row={r} rv={rv} cur={cur} onConfirm={() => confirm(r)} onSave={(v) => save(r, v)} />
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
    </Screen>
  )
}
