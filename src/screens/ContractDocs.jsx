// 계약 문서 담당: C/P · recap · 매매 확인서 등록과 등록 문서 목록. recap은 브로커 메일로 오므로 본문 붙여 넣기가 따로 있다.
import { useState } from 'react'
import { Button, Icon, TextArea } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import { ERROR, FORM, dealViews, leftFor, pickDeal, registerFiles, registerText, useContract, docOf } from '../state/useContract.js'
import { KIND, vesselOf } from '../lib/contract.js'
import { Panel, Screen, Stats, St } from '../ui/kit.jsx'
import './contract.css'

function Status({ r, view }) {
  if (r.status === 'extracting') return <St tone="live">추출 중</St>
  if (r.status === 'error' || r.error) return <St tone="bad">{ERROR[r.error]}</St>
  if (r.kind === 'recap' && view?.recapOnly) return <St tone="warn">서명된 C/P 없이 recap만 있음</St>
  const n = view ? leftFor(view, r.docId) : 0
  return n ? <St tone="warn">검토 필수 {n}건</St> : <St tone="ok">추출 완료</St>
}

export default function ContractDocs() {
  const { role, go } = useApp()
  const s = useContract()
  const [text, setText] = useState('')
  const [drag, setDrag] = useState(false)
  const views = dealViews(s)
  const viewOf = (docId) => views.find((v) => v.docs.some((d) => d.doc_id === docId))
  const regs = [...s.regs].reverse()
  const files = (list) => { registerFiles([...list], role.name); setDrag(false) }
  const paste = () => { registerText(text, role.name); setText('') }
  const open = (view) => { pickDeal(view.key); go('terms') }

  return (
    <Screen tab="docs" title="계약 문서" desc="넣은 문서에서 파서가 계약 조건을 뽑습니다. 시연판은 미리 만든 파서 결과를 붙입니다.">
      <div className="ct-page">
        <Stats items={[
          { label: '등록 문서', value: s.regs.length },
          { label: '추출 중', value: s.regs.filter((r) => r.status === 'extracting').length, tone: 'accent' },
          { label: '검토 필수 남음', value: views.reduce((n, v) => n + v.left.length, 0), sub: `${views.filter((v) => v.left.length).length}척`, tone: 'amber' },
          { label: '예외', value: s.regs.filter((r) => r.error).length, sub: '다시 넣거나 확인 필요', tone: 'red' },
        ]} />
        <div className="ct-reg">
          <Panel code="UPLOAD" title="파일 올리기" desc="C/P · 매매 확인서 · 메일 파일 (PDF, 스캔 PDF, docx, eml)" pad>
            <label className={`ct-drop ${drag ? 'on' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); files(e.dataTransfer.files) }}>
              <input type="file" multiple accept=".pdf,.docx,.eml" className="ct-file" onChange={(e) => { files(e.target.files); e.target.value = '' }} />
              <Icon icon="cloud-upload" size={20} />
              <span>파일을 끌어다 놓거나 눌러서 고르기</span>
              <span className="faint tiny">여러 개를 한 번에 올릴 수 있습니다</span>
            </label>
          </Panel>
          <Panel code="PASTE" title="메일 본문 붙여 넣기" desc="브로커가 메일로 보낸 recap" pad>
            <TextArea className="ct-paste" fill rows={5} value={text} onChange={(e) => setText(e.target.value)} aria-label="메일 본문"
              placeholder={'메일 제목과 본문을 그대로 붙여 넣습니다.\n예) Fixture recap - SYN BELLATRIX / Demurrage USD 42,100 PDPR ...'} />
            <div className="ct-paste-foot">
              <span className="faint tiny">첫 줄을 문서 이름으로 씁니다</span>
              <Button intent="primary" icon="add" text="붙여 넣은 메일 등록" disabled={!text.trim()} onClick={paste} />
            </div>
          </Panel>
        </div>
        <Panel code="DOCS" title="등록 문서" desc={`${s.regs.length}건, 최근 등록 순. 추출이 끝난 문서를 누르면 추출값 검토로 갑니다`}>
          <table className="dt ct-docs">
            <thead><tr><th>문서 번호</th><th>종류</th><th>연결된 선박</th><th>형태</th><th>등록</th><th>추출 상태</th></tr></thead>
            <tbody>
              {regs.map((r) => {
                const doc = r.docId ? docOf(r.docId) : null
                const view = r.status === 'done' && !r.error ? viewOf(r.docId) : null
                return (
                  <tr key={r.no} className={view ? 'click' : ''} tabIndex={view ? 0 : undefined}
                    onClick={view ? () => open(view) : undefined} onKeyDown={view ? (e) => e.key === 'Enter' && open(view) : undefined}>
                    <td><div className="num">{r.docId ?? '—'}</div><div className="faint tiny ct-name">{r.name}</div></td>
                    <td>{r.status === 'extracting' ? <span className="faint">판정 중</span> : r.kind ? KIND[r.kind] : '—'}</td>
                    <td>{doc && vesselOf(doc) ? vesselOf(doc) : <span className="faint">—</span>}</td>
                    <td>{FORM[r.form]}</td>
                    <td><div className="num">{r.at.slice(5, 16)}</div><div className="faint tiny">{r.by}</div></td>
                    <td><Status r={r} view={view} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Panel>
      </div>
    </Screen>
  )
}
