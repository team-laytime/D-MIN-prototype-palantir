// 보고서 차트 두 개. 88척이어도 읽히도록 합계 막대와 상위 선박만 그린다.
// 색은 뜻대로: 선택한 안 = 시안, 다른 후보 = 중립, 실제 계획 = 테두리만.
import { money, moneyShort } from '../lib/time.js'

const fill = (id, selId) => (id === selId ? 'var(--accent)' : id === 'BASE' ? 'none' : 'var(--fg-3)')

/** 안별 총 예상 체선료 가로 막대. rows = [{id, label, total, baseline?}] */
export function TotalChart({ rows, selId }) {
  const max = Math.max(...rows.map((r) => r.total), 1)
  const W = 640, rowH = 28, labelW = 92, valueW = 110
  const barW = W - labelW - valueW
  return (
    <svg className="rpt-chart" viewBox={`0 0 ${W} ${rows.length * rowH + 6}`} role="img" aria-label="안별 총 예상 체선료">
      {rows.map((r, i) => {
        const y = i * rowH + 4
        const w = Math.max(2, (r.total / max) * barW)
        return (
          <g key={r.id}>
            <text x={0} y={y + 15} className="rpt-chart-label" fontWeight={r.id === selId ? 600 : 400}>{r.label}</text>
            <rect x={labelW} y={y + 3} width={barW} height={16} fill="var(--bg-3)" />
            <rect x={labelW} y={y + 3} width={w} height={16} fill={fill(r.id, selId)} stroke={r.baseline ? 'var(--fg-2)' : 'none'} strokeDasharray={r.baseline ? '3 2' : undefined} />
            <text x={labelW + barW + 8} y={y + 15} className="rpt-chart-value" fill={r.id === selId ? 'var(--accent)' : 'currentColor'}>{money(r.total)}</text>
          </g>
        )
      })}
    </svg>
  )
}

/** 선박별 예상 체선료 상위 N척, 가로 묶음 막대. rows = [{vid, name, values:[{id, cents}]}], series = [{id, label}] */
export function VesselChart({ rows, series, selId }) {
  if (!rows.length) return <p className="small muted">체선이 생기는 선박이 없습니다.</p>
  const max = Math.max(...rows.flatMap((r) => r.values.map((v) => v.cents)), 1)
  const W = 640, labelW = 120, valueW = 64, bar = 6, gap = 1, pad = 9
  const groupH = series.length * (bar + gap) + pad
  const barW = W - labelW - valueW
  const H = rows.length * groupH + 4
  return (
    <figure className="rpt-figure">
      <svg className="rpt-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="선박별 예상 체선료 상위">
        {rows.map((r, gi) => {
          const gy = gi * groupH + 2
          const selV = r.values.find((v) => v.id === selId)
          return (
            <g key={r.vid}>
              <text x={0} y={gy + (series.length * (bar + gap)) / 2 + 4} className="rpt-chart-label small">{r.name}</text>
              {r.values.map((v, si) => {
                const w = v.cents ? Math.max(2, (v.cents / max) * barW) : 0
                const y = gy + si * (bar + gap)
                return w > 0 && <rect key={v.id} x={labelW} y={y} width={w} height={bar} fill={fill(v.id, selId)} stroke={v.id === 'BASE' ? 'var(--fg-2)' : 'none'} strokeWidth="1" />
              })}
              <text x={W - valueW + 6} y={gy + (series.length * (bar + gap)) / 2 + 4} className="rpt-chart-tick" fill="var(--accent)">{selV?.cents ? moneyShort(selV.cents) : '-'}</text>
              <line x1={labelW} x2={W} y1={gy + groupH - pad / 2} y2={gy + groupH - pad / 2} stroke="var(--line)" />
            </g>
          )
        })}
      </svg>
      <figcaption className="rpt-legend">
        {series.map((s) => <span key={s.id}><i style={{ background: s.id === 'BASE' ? 'transparent' : fill(s.id, selId), border: s.id === 'BASE' ? '1px solid var(--fg-2)' : 0 }} />{s.label}</span>)}
        <span className="faint">오른쪽 숫자 = 선택한 안의 그 배 체선료</span>
      </figcaption>
    </figure>
  )
}
