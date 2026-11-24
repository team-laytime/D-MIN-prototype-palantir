// 메일 본문 렌더러. 본문 글 사이에 [[표:그룹]] [[간트:그룹]] 표시가 있으면 그 자리에
// 그 부서가 맡은 부두의 일정표와 선석별 간트를 그린다(입출항 작업지시자처럼 부두가 없으면 전 부두).
// 복사할 때는 plainBody()로 표시를 글자 표로 바꾼다. 값은 확정 스냅숏(plan)에서만 읽는다.
import { dayStart, fmt, fmtDur, hourOf } from '../lib/time.js'
import { GROUPS, rowsFor } from '../lib/mailGroups.js'

const MARK = /\[\[(표|간트):(\w+)\]\]/g
const rowsOf = (plan, gid) => rowsFor(plan, GROUPS.find((x) => x.id === gid))
const tons = (n) => (n === null || n === undefined ? '-' : `${Math.round(n).toLocaleString()}t`)

export function plainBody(text, plan) {
  return text.replace(MARK, (m, kind, gid) => {
    const rows = rowsOf(plan, gid)
    if (kind === '간트') return '(선석별 간트는 메일 본문 그림으로 들어갑니다)'
    return rows.map((p, i) => `${i + 1}. ${p.name}  ${p.berth}  접안 ${fmt(p.etb)} → 이안 ${fmt(p.etu)} (${fmtDur(p.etu - p.etb)})${p.night ? '  야간' : ''}`).join('\n')
  })
}

function Table({ rows }) {
  if (!rows.length) return <p className="mlb-empty">이번 계획에 배정된 선박이 없습니다.</p>
  return (
    <table className="mlb-table">
      <thead><tr><th>순서</th><th>선박</th><th>화물</th><th>선석</th><th>도착</th><th>접안</th><th>이안</th><th>접안 시간</th></tr></thead>
      <tbody>{rows.map((p, i) => (
        <tr key={p.vid}>
          <td className="num">{i + 1}</td>
          <td><b>{p.name}</b>{p.night && <span className="mlb-night">야간</span>}</td>
          <td>{p.product}, {p.dir}<br /><span className="num muted">{tons(p.ton)}</span></td>
          <td>{p.berth}</td>
          <td className="num">{fmt(p.eta)}</td><td className="num">{fmt(p.etb)}</td><td className="num">{fmt(p.etu)}</td><td className="num">{fmtDur(p.etu - p.etb)}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

/** 선석마다 한 줄. 막대 = 접안부터 이안까지, 주황 = 야간 접안. */
function Gantt({ rows }) {
  if (!rows.length) return <p className="mlb-empty">이번 계획에 배정된 선박이 없습니다.</p>
  const H12 = 720
  const start = dayStart(Math.min(...rows.map((p) => p.etb)))
  const end = Math.ceil((Math.max(...rows.map((p) => p.etu)) - start) / H12) * H12 + start
  const lanes = [...new Map(rows.map((p) => [p.bid, p.berthCode ?? p.berth])).entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
    .map(([id, name]) => ({ id, name, items: rows.filter((p) => p.bid === id) }))
  const W = 680, L = 64, R = 12, top = 24, rowH = 22
  const x = (m) => L + ((m - start) / (end - start)) * (W - L - R)
  const H = top + lanes.length * rowH + 22
  const ticks = []; for (let m = start; m <= end; m += H12) ticks.push(m)
  const nights = []
  for (let d = start - 1440; d < end; d += 1440) { const a = Math.max(start, d + 1200), b = Math.min(end, d + 1800); if (b > a) nights.push([a, b]) }
  return (
    <svg className="mlb-gantt" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="선석별 작업 간트">
      {nights.map(([a, b]) => <rect key={a} x={x(a)} y={top - 4} width={x(b) - x(a)} height={H - top - 14} className="mlb-g-night" />)}
      {ticks.map((m) => <g key={m}><line x1={x(m)} x2={x(m)} y1={top - 6} y2={H - 18} className="mlb-g-grid" /><text x={x(m)} y={14} textAnchor="middle" className="mlb-g-tick">{hourOf(m) === 0 ? fmt(m).slice(0, 5) : `${String(hourOf(m)).padStart(2, '0')}시`}</text></g>)}
      {lanes.map((ln, i) => (
        <g key={ln.id}>
          <text x={4} y={top + i * rowH + 14} className="mlb-g-label">{ln.name}</text>
          {ln.items.map((p) => {
            const w = Math.max(3, x(p.etu) - x(p.etb))
            return (
              <g key={p.vid}>
                <rect x={x(p.etb)} y={top + i * rowH + 2} width={w} height={rowH - 6} rx="2" className={`mlb-g-bar ${p.night ? 'night' : ''}`}><title>{`${p.name} ${fmt(p.etb)} ~ ${fmt(p.etu)}`}</title></rect>
                {w > 44 && <text x={x(p.etb) + 3} y={top + i * rowH + 14} className="mlb-g-bar-t">{p.callSign ?? p.name.split(' ')[0]}</text>}
              </g>
            )
          })}
        </g>
      ))}
      <text x={L} y={H - 4} className="mlb-g-legend">회색 띠 = 야간(20시~06시), 주황 막대 = 야간 접안, 막대 글자 = 호출부호</text>
    </svg>
  )
}

export default function MailBody({ text, plan }) {
  const out = []
  let last = 0
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) out.push(<pre key={`t${last}`} className="ml-preview">{text.slice(last, m.index).replace(/^\n/, '').replace(/\n$/, '')}</pre>)
    const rows = rowsOf(plan, m[2])
    out.push(m[1] === '표' ? <Table key={`b${m.index}`} rows={rows} /> : <Gantt key={`b${m.index}`} rows={rows} />)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(<pre key={`t${last}`} className="ml-preview">{text.slice(last).replace(/^\n/, '')}</pre>)
  return <div className="mlb">{out}</div>
}
