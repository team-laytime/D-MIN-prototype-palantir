// 보고서 차트 두 개. 색은 뜻대로: 선택한 안 = 시안, 나머지는 중립 단계로만 구분한다.
import { money, moneyShort } from '../lib/time.js'

const tone = (id, selId) => (id === selId ? 'var(--accent)' : id === 'FCFS' ? 'var(--line-3)' : 'var(--fg-3)')

/** 안별 총 예상 체선료 가로 막대. rows = [{id, label, total}] */
export function TotalChart({ rows, selId }) {
  const max = Math.max(...rows.map((r) => r.total), 1)
  const W = 640, rowH = 30, labelW = 92, valueW = 104
  const barW = W - labelW - valueW
  return (
    <svg className="rpt-chart" viewBox={`0 0 ${W} ${rows.length * rowH + 6}`} role="img" aria-label="안별 총 예상 체선료">
      {rows.map((r, i) => {
        const y = i * rowH + 4
        const w = Math.max(2, (r.total / max) * barW)
        return (
          <g key={r.id}>
            <text x={0} y={y + 16} className="rpt-chart-label" fontWeight={r.id === selId ? 600 : 400}>{r.label}</text>
            <rect x={labelW} y={y + 4} width={barW} height={16} fill="var(--bg-3)" />
            <rect x={labelW} y={y + 4} width={w} height={16} fill={tone(r.id, selId)} />
            <text x={labelW + barW + 8} y={y + 16} className="rpt-chart-value" fill={r.id === selId ? 'var(--accent)' : 'currentColor'}>{money(r.total)}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** 선박별 예상 체선료 묶음 막대. rows = [{name, values:[{id, cents}]}], series = [{id, label}] */
export function VesselChart({ rows, series, selId }) {
  const max = Math.max(...rows.flatMap((r) => r.values.map((v) => v.cents)), 1)
  const W = 640, H = 180, top = 22, bottom = 34, left = 8
  const plotH = H - top - bottom
  const groupW = (W - left) / rows.length
  const barW = Math.min(18, (groupW - 16) / series.length)
  return (
    <figure className="rpt-figure">
      <svg className="rpt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="선박별 예상 체선료">
        <line x1={left} x2={W} y1={top + plotH} y2={top + plotH} stroke="var(--line-2)" />
        {rows.map((r, gi) => {
          const gx = left + gi * groupW + (groupW - barW * series.length) / 2
          return (
            <g key={r.name}>
              {r.values.map((v, si) => {
                const h = v.cents ? Math.max(2, (v.cents / max) * plotH) : 0
                const x = gx + si * barW
                return (
                  <g key={v.id}>
                    {h > 0 && <rect x={x + 1} y={top + plotH - h} width={barW - 2} height={h} fill={tone(v.id, selId)} />}
                    {h > 0 && v.id === selId && <text x={x + barW / 2} y={top + plotH - h - 5} textAnchor="middle" className="rpt-chart-tick" fill="var(--accent)">{moneyShort(v.cents)}</text>}
                  </g>
                )
              })}
              <text x={left + gi * groupW + groupW / 2} y={H - 14} textAnchor="middle" className="rpt-chart-label small">{r.name}</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="rpt-legend">
        {series.map((s) => (
          <span key={s.id}><i style={{ background: tone(s.id, selId) }} />{s.label}</span>
        ))}
        <span className="faint">체선료가 없는 선박은 막대를 그리지 않습니다</span>
      </figcaption>
    </figure>
  )
}
