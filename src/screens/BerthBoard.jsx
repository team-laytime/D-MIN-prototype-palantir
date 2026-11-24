import { useMemo } from 'react'
import { tankerSVG } from '../lib/tanker.js'
import { fmt, fmtFull } from '../lib/time.js'
import { activePlan } from '../lib/workspace.js'
import { useTheme } from '../state/theme.js'

const DARK_PALETTE = {
  '#3a8edb': '#0c1a25', '#2f80cc': '#0c1a25', '#7cc0f2': '#283e50',
  '#c4cad2': '#263240', '#8e96a1': '#3a4b5e', '#8b929c': '#536477',
  '#77808b': '#627385', '#5f6670': '#627385', '#b8392d': '#36495b',
  '#d6b24a': '#7f95a6', '#f4f5f7': '#a1b1bf', '#2e4a6e': '#263646',
  '#d6202f': '#536477', '#222': '#263646', '#e5ad00': '#7f95a6', '#dcecff': '#627385',
}
const darkTanker = (empty, hull) => tankerSVG({ empty, hull }).replace(/#[\da-f]{3,6}\b/gi, (hex) => DARK_PALETTE[hex] ?? hex)
// 라이트에서는 원본 그림 색을 그대로 쓰고, 선체 색만 상태 색으로 칠한다(SVG 속성이라 CSS 변수 대신 값).
const HULL = { dark: { bad: '#f2555d', on: '#35c2d9', idle: '#627385' }, light: { bad: '#c42b36', on: '#0b7489', idle: '#687788' } }
const tanker = (dark, empty, tone) => (dark ? darkTanker(empty, HULL.dark[tone]) : tankerSVG({ empty, hull: HULL.light[tone] }))

/**
 * 선석별 작업 현황판.
 *  - plan: 엔진 후보(sim)나 확정 스냅숏(activePlan()). 둘 다 placements[{vid, bid, etb, etu}]를 가진다. 없으면 확정본을 쓴다.
 *  - pier: 부두(묶음) id를 주면 그 부두 선석만(선석 24개를 한 줄에 다 놓으면 너무 좁다). 없으면 전체를 부두 순서대로.
 */
export function BerthBoard({ plan: planProp, scen, t, onOpen, selected, onSelect, pier }) {
  const dark = useTheme() === 'dark'
  const plan = planProp ?? activePlan()
  const columns = useMemo(() => {
    if (!plan) return []
    const byId = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
    // 확정 스냅숏에는 선박 이름, 화물, 톤, ETA가 같이 있어 데이터셋에 없더라도 보인다.
    const vesselOf = (p) => byId[p.vid] ?? { id: p.vid, name: p.name ?? p.vid, product: p.product, ton: p.ton, eta: p.eta }
    return scen.berths.filter((b) => !pier || b.pier === pier).map((berth) => {
      const queue = plan.placements.filter((p) => p.bid === berth.id).sort((a, b) => a.etb - b.etb)
      const current = queue.find((p) => p.etb <= t && t < p.etu)
      const upcoming = queue.filter((p) => p.etb > t)
      const show = current ?? upcoming[0]
      const vessel = show ? vesselOf(show) : null
      const next = current ? upcoming[0] : upcoming[1]
      return {
        berth, current, show, vessel,
        progress: current ? Math.round(Math.max(0, Math.min(1, (t - current.etb) / (current.etu - current.etb))) * 100) : null,
        status: current ? 'ok' : 'idle',
        picture: tanker(dark, !current, current ? 'on' : 'idle'),
        code: current ? (vessel.callSign ? `${vessel.callSign}-${vessel.voyage}` : vessel.id) : show ? `다음 ${fmt(show.etb)}` : '배정 없음',
        next: next ? { at: fmt(next.etb), name: vesselOf(next).name } : null,
      }
    })
  }, [plan, scen, t, dark, pier])

  if (!plan) return <p className="small muted">확정된 접안 계획이 없습니다.</p>

  return (
    <div className="home-berth-board" style={{ gridTemplateColumns: `62px repeat(${columns.length}, minmax(0, 1fr))` }}>
      <div className="home-berth-labels" aria-hidden="true">
        <div>선석</div><div>선박명</div><div>입항일시</div><div>접안일시</div><div>이안예정</div><div>화물</div><div>다음 접안</div>
      </div>
      {columns.map((column) => <div key={column.berth.id} className={`home-berth-column ${column.show ? 'click' : ''} ${selected === column.berth.id ? 'sel' : ''}`} role={column.show ? 'button' : undefined} tabIndex={column.show ? 0 : undefined} aria-label={`${column.berth.name} ${column.vessel?.name ?? '배정 없음'}${column.show ? ' 선박 카드' : ''}`} onClick={() => { onSelect?.(column.berth.id); if (column.show) onOpen?.(column.show.vid) }} onKeyDown={(event) => { if (column.show && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen?.(column.show.vid) } }}>
        <div className="home-berth-heading"><strong title={column.berth.name}>{column.berth.code}</strong><span className={`home-berth-progress ${column.status}`} title={column.current ? '작업 진행률' : undefined}>{column.progress !== null ? <span className="num">{column.progress}%</span> : column.show ? '예정' : '-'}</span></div>
        <div className="home-berth-ship"><span className="home-berth-picture" dangerouslySetInnerHTML={{ __html: column.picture }} /><span className="home-berth-identity"><strong title={column.vessel?.name}>{column.vessel?.name ?? '-'}</strong><small className={column.current ? 'mono' : ''} title={column.code}>{column.code}</small></span></div>
        <div className="num" aria-label="입항일시" title={column.vessel?.eta != null ? fmtFull(column.vessel.eta) : undefined}>{column.vessel?.eta != null ? fmt(column.vessel.eta) : '-'}</div>
        <div className={`num ${!column.current && column.show ? 'c-blue' : ''}`} aria-label="접안일시" title={column.show ? fmtFull(column.show.etb) : undefined}>{column.show ? fmt(column.show.etb) : '-'}</div>
        <div className="num" aria-label="이안예정" title={column.show ? fmtFull(column.show.etu) : undefined}>{column.show ? fmt(column.show.etu) : '-'}</div>
        <div className="home-berth-cargo" aria-label="화물">{column.vessel ? <>{column.vessel.product ?? '-'}<span className="num">{column.vessel.ton != null ? `${column.vessel.ton.toLocaleString()}t` : ''}</span></> : '-'}</div>
        <div className="home-berth-next" aria-label="다음 접안" title={column.next ? `${column.next.at} ${column.next.name}` : undefined}>{column.next ? <><span className="num">{column.next.at}</span> {column.next.name}</> : '-'}</div>
      </div>)}
    </div>
  )
}
