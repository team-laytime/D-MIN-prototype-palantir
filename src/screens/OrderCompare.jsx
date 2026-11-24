// 접안 순서 비교 (최종 피드백: 후보마다 접안 순서가 어떻게 다른지 한눈에)
// 선 하나 = 선박 한 척. 칸 = 후보 3개, 맨 왼쪽이 최저 체선료 후보(비교 기준). 선이 꺾이면 그 후보에서 순서가 바뀐 것.
// 점 안에는 부두와 접안 시각. 최저안보다 순서가 바뀐 구간은 굵게, 그대로인 구간은 흐리게.
import { fmt } from '../lib/time.js'

const COLORS = ['var(--accent)', 'var(--amber)', 'var(--violet)', 'var(--green)', 'var(--blue)', 'var(--red)']

export default function OrderCompare({ sims, scen, focusId, onPick, compact = false }) {
  const vessels = scen.vessels
  const color = Object.fromEntries(vessels.map((v, i) => [v.id, COLORS[i % COLORS.length]]))
  const name = Object.fromEntries(vessels.map((v) => [v.id, v.name]))
  const code = Object.fromEntries(scen.berths.map((b) => [b.id, b.code]))
  const orderOf = (sim) => {
    const ps = [...sim.placements].sort((a, b) => a.etb - b.etb || a.vid.localeCompare(b.vid))
    return Object.fromEntries(ps.map((p, i) => [p.vid, { rank: i + 1, p }]))
  }
  const orders = sims.map(orderOf)
  const base = orders[0]
  const n = vessels.length
  const W = 1200, left = 250, right = 240, top = compact ? 66 : 70, rowH = compact ? 44 : 52
  const colX = (i) => left + (sims.length === 1 ? 0 : i * (W - left - right) / (sims.length - 1))
  const rowY = (r) => top + (r - 1) * rowH
  const H = top + (n - 1) * rowH + 40
  const chipW = 128, chipH = 26
  const label = (sim, i) => (i === 0 ? `${sim.label} (최저)` : sim.label)
  const moved = (vid, i) => orders[i][vid].rank !== base[vid].rank

  return (
    <figure className="oc">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="후보별 접안 순서 비교">
        {sims.map((sim, i) => (
          <g key={sim.id} className={`oc-col ${sim.id === focusId ? 'on' : ''}`} onClick={() => onPick?.(sim.id)}>
            <rect x={colX(i) - chipW / 2 - 14} y={8} width={chipW + 28} height={H - 12} rx="6" className="oc-colbg" />
            <text x={colX(i)} y={28} textAnchor="middle" className="oc-head">{label(sim, i)}</text>
            <text x={colX(i)} y={46} textAnchor="middle" className="oc-sub">{i === 0 ? (compact ? '기본 선택' : '비교 기준, 기본 선택') : `${vessels.filter((v) => moved(v.id, i)).length}척 순서 바뀜`}</text>
          </g>
        ))}
        {Array.from({ length: n }, (_, k) => (
          <text key={k} x={8} y={rowY(k + 1) + 5} className="oc-rank">{k + 1}번째</text>
        ))}
        {vessels.map((v) => (
          <g key={v.id}>
            {sims.slice(1).map((sim, j) => {
              const i = j + 1
              const a = orders[i - 1][v.id].rank, b = orders[i][v.id].rank
              const changed = moved(v.id, i) || moved(v.id, i - 1)
              const x1 = colX(i - 1) + chipW / 2, x2 = colX(i) - chipW / 2
              return <path key={sim.id} d={`M${x1} ${rowY(a)} C${x1 + 40} ${rowY(a)} ${x2 - 40} ${rowY(b)} ${x2} ${rowY(b)}`}
                fill="none" stroke={color[v.id]} strokeWidth={changed ? 3.5 : 1.5} strokeOpacity={changed ? 0.95 : 0.35} />
            })}
            {sims.map((sim, i) => {
              const { rank, p } = orders[i][v.id]
              const ch = i > 0 && moved(v.id, i)
              const d = i > 0 ? base[v.id].rank - rank : 0
              return (
                <g key={sim.id}>
                  <rect x={colX(i) - chipW / 2} y={rowY(rank) - chipH / 2} width={chipW} height={chipH} rx="4"
                    className={`oc-chip ${ch ? 'ch' : ''}`} style={{ stroke: color[v.id] }} />
                  <text x={colX(i)} y={rowY(rank) + 4} textAnchor="middle" className="oc-chip-t">{code[p.bid]} {fmt(p.etb)}</text>
                  {ch && <text x={colX(i) + chipW / 2 + 4} y={rowY(rank) - chipH / 2 + 2} className={`oc-delta ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? `▲${d}` : `▼${-d}`}</text>}
                </g>
              )
            })}
            <text x={colX(0) - chipW / 2 - 22} y={rowY(base[v.id].rank) + 4} textAnchor="end" className="oc-name" style={{ fill: color[v.id] }}>{name[v.id]}</text>
            <text x={colX(sims.length - 1) + chipW / 2 + 24} y={rowY(orders[sims.length - 1][v.id].rank) + 4} className="oc-name" style={{ fill: color[v.id] }}>{name[v.id]}</text>
          </g>
        ))}
      </svg>
      <figcaption className="oc-cap">선 하나가 선박 한 척입니다. 선이 꺾이면 그 후보에서 접안 순서가 바뀐 것이고, 굵은 선과 ▲▼는 최저 체선료 후보보다 몇 번째 앞뒤로 갔는지입니다. 칸 안은 부두와 접안 시각. 칸을 누르면 그 후보를 고릅니다.</figcaption>
    </figure>
  )
}
