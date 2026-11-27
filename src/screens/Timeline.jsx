// 부두(선석)별 간트. 줄 = 선석(부두 묶음 머리줄 포함), 막대 = 접안부터 이안까지.
// 후보 비교와 확정 일정 모니터링에서 같이 쓴다. 시각과 금액은 엔진 결과(placements)를 그대로 그린다.
//   sim: { id, label, placements[] }. placements는 엔진 후보(dem = {cents})와 확정 스냅숏(dem = 센트 숫자) 둘 다 받는다.
import { Fragment, useMemo } from 'react'
import { NOW, dayStart, fmt, hourOf, money } from '../lib/time.js'
import './decide.css'

export const demCents = (p) => (typeof p.dem === 'number' ? p.dem : p.dem?.cents ?? 0)

/**
 * @param {object} props
 * @param {{ placements: object[], label?: string }} props.sim
 * @param {object} props.scen  시나리오(berths, vessels, blocks)
 * @param {{ start: number, end: number }} props.range  보통 spanOf(sims)
 * @param {boolean} [props.groupByPier]  부두 묶음 머리줄을 넣는다
 * @param {Set<string>|string[]} [props.highlight]  테두리로 표시할 선박
 * @param {string} [props.highlightLabel]  막대 설명에 붙일 말
 * @param {string[]} [props.berthIds]  이 선석만 그린다
 * @param {boolean} [props.now]  지금 시각 선
 */
export default function Timeline({ sim, scen, range, groupByPier = true, highlight, highlightLabel = '표시한 선박', berthIds, activeVid, onPick, compact = false, now = true, cursor, showWait = false, hlPier = null, hlBerth = null }) {
  const span = Math.max(1, range.end - range.start)
  const pos = (t) => `${((t - range.start) / span) * 100}%`
  const seg = (a, b) => {
    const l = Math.max(a, range.start), r = Math.min(b, range.end)
    return r > l ? { left: pos(l), width: `${((r - l) / span) * 100}%` } : null
  }
  const hl = useMemo(() => (highlight instanceof Set ? highlight : new Set(highlight ?? [])), [highlight])

  const { groups, ticks, nights, vById } = useMemo(() => {
    const vById = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
    const byBerth = {}
    for (const p of sim.placements) (byBerth[p.bid] ??= []).push(p)
    const berths = scen.berths.filter((b) => !berthIds || berthIds.includes(b.id))
    const groups = []
    for (const b of berths) {
      const last = groups.at(-1)
      const row = { berth: b, bars: byBerth[b.id] ?? [] }
      if (groupByPier && last?.pier === b.pier) last.rows.push(row)
      else groups.push({ pier: b.pier, name: b.pierName, rows: [row] })
    }
    // 눈금: 6시간마다, 0시에는 날짜
    const ticks = []
    for (let t = dayStart(range.start); t <= range.end; t += 360) if (t >= range.start) ticks.push({ t, day: hourOf(t) === 0 })
    // 야간(20시~다음 날 06시) 띠
    const nights = []
    for (let d = dayStart(range.start) - 1440; d < range.end; d += 1440) {
      const s = seg(d + 20 * 60, d + 30 * 60)
      if (s) nights.push({ key: d, style: s })
    }
    return { groups, ticks, nights, vById }
  }, [sim, scen, range, groupByPier, berthIds]) // eslint-disable-line react-hooks/exhaustive-deps

  const blocksOf = (bid) => (scen.blocks ?? []).filter((b) => !b.berths || b.berths.includes(bid))
  const nowStyle = now && NOW >= range.start && NOW <= range.end ? { left: pos(NOW) } : null
  // 11-25 운영 현황: 재생 중인 시각(시뮬레이션 시각)을 따라가는 세로선
  const cursorStyle = cursor != null && cursor > range.start && cursor <= range.end ? { left: pos(cursor) } : null

  const lane = ({ berth, bars }) => (
    <div className={`gt-lane ${hlPier === berth.pier || hlBerth === berth.id ? 'hl' : ''}`} key={berth.id}>
      <div className="gt-label" title={`${berth.name}, 최대 ${berth.maxDwt?.toLocaleString() ?? '-'} DWT`}>
        <span className="gt-code">{berth.label ?? berth.code}</span>
        <span className="gt-count tiny faint num">{bars.length || ''}</span>
      </div>
      <div className="gt-track">
        {nights.map((n) => <div key={n.key} className="gt-night" style={n.style} aria-hidden="true" />)}
        {ticks.map((k) => <span key={k.t} className={`gt-grid ${k.day ? 'day' : ''}`} style={{ left: pos(k.t) }} aria-hidden="true" />)}
        {blocksOf(berth.id).map((b, i) => {
          const s = seg(b.start, b.end)
          return s && <div key={i} className="gt-block" style={s} title={`${b.kind === 'WEATHER' ? '접안 금지' : '사용 불가'} ${fmt(b.start)} ~ ${fmt(b.end)}${b.source ? `, ${b.source}` : ''}`}><em>{b.kind === 'WEATHER' ? '접안 금지' : '사용 불가'}</em></div>
        })}
        {/* 11-25 운영 현황: 도착부터 접안까지 기다린 시간(정박지 대기)을 막대 앞에 점선으로 */}
        {showWait && bars.map((p) => {
          const eta = p.eta ?? vById[p.vid]?.eta
          const w = eta != null && eta < p.etb ? seg(eta, p.etb) : null
          return w && <span key={`w-${p.vid}`} className="gt-wait" style={w} title={`${vById[p.vid]?.name ?? p.vid} 정박지 대기 ${fmt(eta)} ~ ${fmt(p.etb)}`}>{parseFloat(w.width) >= 6 && <em>대기 {Math.round((p.etb - eta) / 60)}시간</em>}</span>
        })}
        {showWait && bars.map((p) => {
          const w = demCents(p) > 0 && p.le != null && p.le < p.etb ? seg(Math.max(p.le, p.eta ?? vById[p.vid]?.eta ?? p.le), Math.min(p.etb, p.hose ?? p.etb)) : null
          return w && <span key={`wd-${p.vid}`} className="gt-wait-dem" style={w} aria-hidden="true" />
        })}
        {bars.map((p) => {
          const s = seg(p.etb, p.etu)
          if (!s) return null
          const v = vById[p.vid]
          const name = p.name ?? v?.name ?? p.vid
          const cents = demCents(p)
          // 11-25 체선이 생기는 구간(정박시간 종료 ~ 호스 분리)만 칠하고 나머지는 칠하지 않는다
          const demA = cents > 0 && p.le != null && p.hose != null ? Math.max(p.le, p.etb) : null
          const demB = demA != null ? Math.min(p.hose, p.etu) : null
          const fill = demA != null && demB > demA
            ? (() => { const a = ((demA - p.etb) / (p.etu - p.etb)) * 100, b = ((demB - p.etb) / (p.etu - p.etb)) * 100
                return { background: `linear-gradient(to right, transparent ${a}%, var(--dem-fill) ${a}%, var(--dem-fill) ${b}%, transparent ${b}%), var(--gt-base)` } })()
            : null
          const cls = ['gt-bar', cents > 0 && !fill && p.le == null && 'dem', p.night && 'night', hl.has(p.vid) && 'hl', p.fixed && 'fixed', activeVid === p.vid && 'active'].filter(Boolean).join(' ')
          const tip = [
            `${name}${v ? ` (${v.product}, ${v.dir})` : ''}`,
            berth.name,
            `접안 ${fmt(p.etb)} ~ 이안 ${fmt(p.etu)}`,
            p.night ? '야간 접안' : null,
            cents > 0 ? `예상 체선료 ${money(cents)}` : '체선 없음',
            hl.has(p.vid) ? highlightLabel : null,
            p.fixed ? '고정한 선박' : null,
          ].filter(Boolean).join('\n')
          return (
            <button type="button" key={p.vid} className={cls} style={fill ? { ...s, ...fill } : s} title={tip} onClick={() => onPick?.(p.vid)}
              aria-label={`${name}, ${berth.name}, ${fmt(p.etb)}부터 ${fmt(p.etu)}까지`}>
              <span className="gt-bar-t">{name}{cents > 0 ? <em className="gt-tag dem">체선</em> : p.night ? <em className="gt-tag night">야간</em> : null}</span>
            </button>
          )
        })}
        {nowStyle && <span className="gt-now" style={nowStyle} aria-hidden="true" />}
        {cursorStyle && <span className="gt-cursor" style={cursorStyle} aria-hidden="true" />}
      </div>
    </div>
  )

  return (
    <div className={`gt ${compact ? 'compact' : ''}`} aria-label={`${sim.label ?? ''} 선석별 간트`}>
      <div className="gt-axis">
        <div className="gt-label"><span className="mono tiny faint">KST</span></div>
        <div className="gt-track">
          {ticks.map((k) => <span key={k.t} className={`gt-tick num ${k.day ? 'day' : ''}`} style={{ left: pos(k.t) }}>{k.day ? fmt(k.t).slice(0, 5) : String(hourOf(k.t)).padStart(2, '0')}</span>)}
          {nights.map((n) => <span key={`nl-${n.key}`} className="gt-night-label" style={n.style}>야간</span>)}
          {nowStyle && <span className="gt-now-label tiny" style={nowStyle}>현재</span>}
          {cursorStyle && <span className="gt-cursor-label tiny num" style={cursorStyle}>{fmt(cursor)}</span>}
        </div>
      </div>
      {groups.map((g) => (
        <Fragment key={g.rows[0].berth.id}>
          {groupByPier && <div className="gt-pier"><span>{g.name}</span><span className="tiny faint num">{g.rows.reduce((s, r) => s + r.bars.length, 0)}척</span></div>}
          {g.rows.map(lane)}
        </Fragment>
      ))}
    </div>
  )
}

/** 간트 범례. keys: work, dem, night, hl, fixed, block, nightBand */
export function TimelineLegend({ hlLabel = '표시한 배', keys = ['work', 'dem', 'night', 'hl', 'fixed', 'nightBand', 'block'], hint = '막대를 누르면 계획 일정' }) {
  const L = {
    work: ['gt-key', '작업(접안~이안)'], wait: ['gt-key wait', '도착 후 대기'], dem: ['gt-key dem', '체선 발생'], night: ['gt-key night', '야간 접안'],
    hl: ['gt-key hl', hlLabel], fixed: ['gt-key fixed', '고정한 배'], nightBand: ['gt-key band', '야간 20~06시'], block: ['gt-key block', '사용 불가'],
  }
  return <div className="gt-legend">{keys.map((k) => <span key={k}><i className={L[k][0]} />{L[k][1]}</span>)}{hint && <span className="faint">{hint}</span>}</div>
}
