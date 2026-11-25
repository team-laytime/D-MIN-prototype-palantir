// 메일 첨부 보기 (11-25): 확정 통보 메일 미리보기와 메일함(보낸메일, 받은메일)이 같은 창을 쓴다.
//  - xlsx: 전체확정일정. 확정 스냅숏(plan)으로 시트를 만들고 「내려받기」는 실제 .xlsx 파일을 만든다.
//  - report: 접안계획 보고서. 지금 후보 계산 결과(useReport)로 그린다.
import { useMemo, useState } from 'react'
import { Button, Dialog, DialogBody, Icon } from '@blueprintjs/core'
import { useReport } from '../state/useReport.js'
import { logActivity } from '../lib/workspace.js'
import { scheduleSheets } from '../lib/mailGroups.js'
import { buildXlsx } from '../lib/xlsx.js'
import { ReportDoc } from './Report.jsx'

// 전체확정일정.xlsx 미리보기: 엑셀처럼 시트 탭 + 표
function XlsxSheet({ file, plan }) {
  const sheets = useMemo(() => scheduleSheets(plan), [plan])
  const [i, setI] = useState(0)
  const s = sheets[Math.min(i, sheets.length - 1)]
  const download = () => {
    const url = URL.createObjectURL(buildXlsx(sheets))
    const a = document.createElement('a'); a.href = url; a.download = file.name; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    logActivity('메일', '첨부 내려받기', file.name)
  }
  return (
    <div className="ml-xlsx">
      <div className="ml-xlsx-bar"><span className="tiny muted">전 부두 상세 일정, 시트 {sheets.length}장 (전체, 부두별, 안내)</span><Button size="small" icon="download" onClick={download}>내려받기 (.xlsx)</Button></div>
      <div className="ml-xlsx-grid">
        <table className="dt ml-sheet">
          <thead><tr><th className="c faint"></th>{s.rows[0].map((h, c) => <th key={c}>{h}</th>)}</tr></thead>
          <tbody>{s.rows.slice(1).map((r, ri) => <tr key={ri}><td className="c num faint">{ri + 2}</td>{r.map((v, c) => <td key={c} className={typeof v === 'number' ? 'num r' : ''}>{typeof v === 'number' ? v.toLocaleString() : v}</td>)}</tr>)}</tbody>
        </table>
      </div>
      <div className="ml-xlsx-tabs">{sheets.map((x, k) => <button type="button" key={x.name} className={k === i ? 'on' : ''} onClick={() => setI(k)}>{x.name}</button>)}</div>
    </div>
  )
}

/** 첨부 파일 단추들. 누르면 onOpen(file) */
export function AttachmentButtons({ files, onOpen }) {
  return files.map((f) => (
    <button type="button" key={f.name} className="ml-file" onClick={() => onOpen(f)} title="첨부 열어 보기">
      <Icon icon={f.kind === 'report' ? 'document' : 'th'} size={12} />{f.name}
    </button>
  ))
}

/** 첨부 보기 창. file이 없으면 닫혀 있다. plan = 그 메일의 확정 스냅숏 */
export default function AttachmentDialog({ file, plan, onClose }) {
  const { model } = useReport()
  return (
    <Dialog isOpen={!!file} onClose={onClose} title={file?.name} icon={file?.kind === 'report' ? 'document' : 'th'} className="ml-dialog wide">
      <DialogBody>
        {file?.kind === 'xlsx' && (plan ? <XlsxSheet file={file} plan={plan} /> : <p className="small muted">이 메일의 확정 일정을 찾을 수 없어 파일을 열 수 없습니다.</p>)}
        {file?.kind === 'report' && (model ? <ReportDoc m={model} /> : <p className="small muted">후보 계산 결과가 없어 보고서를 만들 수 없습니다.</p>)}
      </DialogBody>
    </Dialog>
  )
}
