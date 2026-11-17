import { useMemo } from 'react'
import { tankerSVG } from '../lib/tanker.js'
import { fmt, money } from '../lib/time.js'
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
const full = (minute) => `2026/${fmt(minute)}`

/** 지도와 같은 선택안·시각을 쓰는 선석별 작업 현황판입니다. */
export function BerthBoard({ plan, scen, t, onOpen }) {
  const dark = useTheme() === 'dark'
  const columns = useMemo(() => {
    const byId = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
    return [...scen.berths].sort((a, b) => a.name.localeCompare(b.name)).map((berth) => {
      const queue = plan.placements.filter((p) => p.bid === berth.id).sort((a, b) => a.etb - b.etb)
      const current = queue.find((p) => p.etb <= t && t < p.etu)
      const upcoming = queue.filter((p) => p.etb > t)
      const legacy = !current && berth.occupiedUntil !== null && t < berth.occupiedUntil
      const show = current ?? upcoming[0]
      const vessel = show ? byId[show.vid] : null
      const next = current ? upcoming[0] : upcoming[1]
      const demurrage = current && current.dem.cents > 0
      return {
        berth, current, legacy, show, vessel,
        progress: current ? Math.round(Math.max(0, Math.min(1, (t - current.etb) / (current.etu - current.etb))) * 100) : null,
        status: current ? (demurrage ? 'bad' : 'ok') : legacy ? 'busy' : 'idle',
        picture: tanker(dark, !current && !legacy, demurrage ? 'bad' : current ? 'on' : 'idle'),
        code: current ? `${vessel.callSign}-${vessel.voyage.slice(5)}` : legacy ? '기존 접안선' : show ? `다음 ${fmt(show.etb)}` : '배정 없음',
        next: next ? { at: fmt(next.etb).slice(0, 5), name: byId[next.vid].name } : null,
      }
    })
  }, [plan, scen, t, dark])

  return (
    <div className="home-berth-board" style={{ gridTemplateColumns: `62px repeat(${columns.length}, minmax(0, 1fr))` }}>
      <div className="home-berth-labels" aria-hidden="true">
        <div>선석</div><div>선박명</div><div>입항일시</div><div>접안일시</div><div>이안예정</div><div>화물</div><div>체선료(예상)</div><div>다음 접안</div>
      </div>
      {columns.map((column) => <div key={column.berth.id} className={`home-berth-column ${column.show ? 'click' : ''}`} role={column.show ? 'button' : undefined} tabIndex={column.show ? 0 : undefined} aria-label={`${column.berth.name} ${column.legacy ? column.berth.occupiedBy : column.vessel?.name ?? '배정 없음'}${column.show ? ' 선박 카드' : ''}`} onClick={() => column.show && onOpen(column.show.vid)} onKeyDown={(event) => { if (column.show && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(column.show.vid) } }}>
        <div className="home-berth-heading"><strong>{column.berth.name}</strong><span className={`home-berth-progress ${column.status}`} title={column.current ? (column.status === 'bad' ? '체선 예상' : '작업 진행률') : undefined}>{column.progress !== null ? <span className="num">{column.progress}%</span> : column.legacy ? '작업' : column.show ? '예정' : '—'}</span></div>
        <div className="home-berth-ship"><span className="home-berth-picture" dangerouslySetInnerHTML={{ __html: column.picture }} /><span className="home-berth-identity"><strong title={column.vessel?.name}>{column.legacy ? column.berth.occupiedBy : column.vessel?.name ?? '—'}</strong><small className={column.current ? 'mono' : ''} title={column.code}>{column.code}</small></span></div>
        <div className="num" aria-label="입항일시" title={column.vessel ? full(column.vessel.eta) : undefined}>{column.vessel ? fmt(column.vessel.eta) : '—'}</div>
        <div className={`num ${!column.current && column.show ? 'c-blue' : ''}`} aria-label="접안일시" title={column.show ? full(column.show.etb) : undefined}>{column.show ? fmt(column.show.etb) : '—'}</div>
        <div className="num" aria-label="이안예정" title={column.legacy ? full(column.berth.occupiedUntil) : column.show ? full(column.show.etu) : undefined}>{column.legacy ? fmt(column.berth.occupiedUntil) : column.show ? fmt(column.show.etu) : '—'}</div>
        <div className="home-berth-cargo" aria-label="화물">{column.vessel ? <>{column.vessel.product}<span className="num">{column.vessel.ton.toLocaleString()}t</span></> : '—'}</div>
        <div className={`num ${column.show?.dem.cents > 0 ? 'c-red' : ''}`} aria-label="체선료 예상">{column.show ? money(column.show.dem.cents) : '—'}</div>
        <div className="home-berth-next" aria-label="다음 접안" title={column.next ? `${column.next.at} ${column.next.name}` : undefined}>{column.next ? <><span className="num">{column.next.at}</span> {column.next.name}</> : '—'}</div>
      </div>)}
    </div>
  )
}
