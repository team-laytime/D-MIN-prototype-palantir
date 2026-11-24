// 부두별 배정 비교 (11-24 실데이터: 6척 순서 그림 대신, 88척을 부두 묶음으로 세어 본다)
// 줄 = 부두, 칸 = 실제 계획과 후보들. 칸마다 배정 척수와 그 부두 배들의 예상 체선료 합(엔진 값을 더한 것).
import { money } from '../lib/time.js'
import { demCents } from './Timeline.jsx'

export default function OrderCompare({ sims, scen, baseline, focusId, onPick }) {
  const piers = [...new Map(scen.berths.map((b) => [b.pier, b.pierName])).entries()]
  const pierOf = Object.fromEntries(scen.berths.map((b) => [b.id, b.pier]))
  const cols = [...(baseline ? [{ id: 'BASE', label: '실제 계획', placements: baseline.placements }] : []), ...sims]
  const cell = (col, pier) => {
    const ps = col.placements.filter((p) => pierOf[p.bid] === pier)
    return { n: ps.length, cents: ps.reduce((s, p) => s + demCents(p), 0) }
  }
  return (
    <table className="dt cmp-pier">
      <thead><tr><th>부두</th>{cols.map((c) => <th key={c.id} className={`r ${c.id === focusId ? 'on' : ''}`}>
        {onPick && c.id !== 'BASE' ? <button type="button" className="cmp-name" onClick={() => onPick(c.id)}>{c.label}</button> : c.label}
      </th>)}</tr></thead>
      <tbody>{piers.map(([pier, name]) => (
        <tr key={pier}><td>{name}</td>{cols.map((c) => {
          const x = cell(c, pier)
          return <td key={c.id} className={`r num ${c.id === focusId ? 'on' : ''}`}>{x.n}척 <span className={x.cents ? 'c-red' : 'faint'}>{x.cents ? money(x.cents) : '-'}</span></td>
        })}</tr>
      ))}</tbody>
    </table>
  )
}
