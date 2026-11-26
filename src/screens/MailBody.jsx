// 메일 본문 렌더러. 본문 글 사이의 [[종류:그룹]] 표시 자리에 그림과 표를 그린다.
//   간트: 현재부터 24시간 선석별 간트 / 표, 입출항: 24시간 안에 주의할 선박 표
//   탱크: 그 제품(탱크 묶음)의 재고 흐름, 생산계획, 입고와 출하 / 체선: 체선 선박 요약 표
// 복사할 때는 plainBody()로 표시를 글로 바꾼다. 값은 확정 스냅숏(plan)에서만 읽는다.
import { NOW, dayStart, fmt, fmtDur, hourOf, money, toMin } from '../lib/time.js'
import { GROUPS, WINDOW_MIN, demLines, riskRows, rowsFor, tankLines } from '../lib/mailGroups.js'

const SHIP_MAX = 6
const MARK = /\[\[(표|간트|입출항|탱크|체선):(\w+)\]\]/g
const groupOf = (gid) => GROUPS.find((x) => x.id === gid)
const rowsOf = (plan, gid) => rowsFor(plan, groupOf(gid))
const tons = (n) => (n === null || n === undefined ? '-' : `${Math.round(n).toLocaleString()} t`)

export function plainBody(text, plan) {
  return text.replace(MARK, (m, kind, gid) => {
    const g = groupOf(gid)
    if (kind === '간트') return '(현재부터 24시간 선석별 작업 간트 그림)'
    if (kind === '탱크') return tankLines(plan, g?.tank).join('\n')
    if (kind === '체선') return demLines(plan).join('\n')
    const risk = riskRows(plan, g)
    if (!risk.length) return '- 앞으로 24시간 안에 주의할 선박 없음'
    return risk.map(({ p, why }) => `- ${p.name} (${p.berth}) 접안 ${fmt(p.etb)} → 이안 ${fmt(p.etu)}: ${why.join(', ')}`).join('\n')
  })
}

const Empty = () => <p className="mlb-empty">이번 계획에 배정된 선박이 없습니다.</p>

/** 현재부터 24시간 안에 주의할 선박만: 선박, 선석, (도착), 접안, 이안, 주의 내용 */
function RiskTable({ plan, g, port = false }) {
  const rows = riskRows(plan, g)
  if (!rows.length) return <p className="mlb-empty">앞으로 24시간 안에 주의할 선박이 없습니다.</p>
  return (
    <table className="mlb-table mlb-risk">
      <thead><tr><th>선박, 선석</th>{port && <th>도착</th>}<th>접안</th><th>이안</th><th>주의</th></tr></thead>
      <tbody>{rows.map(({ p, why }) => (
        <tr key={p.vid}>
          <td className="mlb-ship"><b>{p.name}</b><span>{p.berth}</span></td>
          {port && <td className="num">{fmt(p.eta)}</td>}
          <td className="num">{fmt(p.etb)}</td><td className="num">{fmt(p.etu)}</td>
          <td className="mlb-why">{why.join(', ')}</td>
        </tr>
      ))}</tbody>
    </table>
  )
}

/** 현재부터 24시간 선석별 간트. 막대 = 접안부터 이안까지(창 밖은 잘라서), 막대 글자 = 선박명, 빨간 막대 = 체선 */
function Gantt({ rows }) {
  const start = NOW, end = NOW + WINDOW_MIN
  const inWin = rows.filter((p) => p.etb < end && p.etu > start)
  if (!inWin.length) return <p className="mlb-empty">앞으로 24시간 안에 작업이 없습니다.</p>
  const lanes = [...new Map(inWin.map((p) => [p.bid, p.berth])).entries()]
    .sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))
    .map(([id, name]) => ({ id, name, items: inWin.filter((p) => p.bid === id) }))
  const W = 760, L = 96, R = 8, top = 26, rowH = 26
  const x = (m) => L + ((Math.min(end, Math.max(start, m)) - start) / (end - start)) * (W - L - R)
  const H = top + lanes.length * rowH + 6
  const ticks = []; for (let m = start; m <= end; m += 180) ticks.push(m)
  const nights = []
  for (let d = dayStart(start) - 1440; d < end; d += 1440) { const a = Math.max(start, d + 1200), b = Math.min(end, d + 1800); if (b > a) nights.push([a, b]) }
  return (
    <svg className="mlb-gantt" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="현재부터 24시간 선석별 작업 간트">
      {nights.map(([a, b]) => <rect key={a} x={x(a)} y={top - 4} width={x(b) - x(a)} height={H - top} className="mlb-g-night" />)}
      {ticks.map((m, i) => <g key={m}><line x1={x(m)} x2={x(m)} y1={top - 6} y2={H} className={`mlb-g-grid ${hourOf(m) === 0 ? 'day' : ''}`} /><text x={x(m) + (i === ticks.length - 1 ? -3 : 3)} y={15} textAnchor={i === ticks.length - 1 ? 'end' : 'start'} className={`mlb-g-tick ${hourOf(m) === 0 || i === 0 ? 'day' : ''}`}>{i === 0 ? `현재 ${fmt(m).slice(6)}` : hourOf(m) === 0 ? fmt(m).slice(0, 5) : `${String(hourOf(m)).padStart(2, '0')}시`}</text></g>)}
      {lanes.map((ln, i) => (
        <g key={ln.id}>
          {i > 0 && <line x1={0} x2={W} y1={top + i * rowH - 1} y2={top + i * rowH - 1} className="mlb-g-row" />}
          <text x={4} y={top + i * rowH + 16} className="mlb-g-label">{ln.name}</text>
          {ln.items.map((p) => {
            const w = Math.max(3, x(p.etu) - x(p.etb))
            const name = p.name.length * 7 < w - 6 ? p.name : p.name.slice(0, Math.max(0, Math.floor((w - 10) / 7))) + (w > 30 ? '…' : '')
            return (
              <g key={p.vid}>
                <rect x={x(p.etb)} y={top + i * rowH + 3} width={w} height={rowH - 8} rx="2" className={`mlb-g-bar ${p.dem > 0 ? 'dem' : ''}`}><title>{`${p.name} ${fmt(p.etb)} ~ ${fmt(p.etu)}`}</title></rect>
                {w > 24 && <text x={x(p.etb) + 4} y={top + i * rowH + 16} className="mlb-g-bar-t">{name}</text>}
              </g>
            )
          })}
        </g>
      ))}
    </svg>
  )
}

/** 제품(탱크 묶음)별: 재고 흐름 그래프 + 생산계획 + 입고, 출하 선박 */
function Tanks({ plan, tank }) {
  const tanks = (plan.tanks ?? []).filter((k) => !tank || k.tank === tank)
  if (!tanks.length) return <p className="mlb-empty">탱크 자료가 없습니다.</p>
  const prod = Object.fromEntries((plan.production ?? []).map((t) => [t.name, t.weeks]))
  const W = 520, H = 200, L = 46, R = 92, T = 24, B = 22
  return (
    <div className="mlb-tanks">
      {tanks.map((k) => {
        const lv = k.levels_t ?? []
        const t0 = toMin(k.start), step = k.step_min ?? 60
        const t1 = t0 + (lv.length - 1) * step
        const x = (m) => L + ((m - t0) / Math.max(1, t1 - t0)) * (W - L - R)
        const y = (pct) => T + (1 - pct / 100) * (H - T - B)
        const pct = (v) => (v / k.capacity_t) * 100
        const lo = pct(k.safe_min_t), hi = pct(k.safe_max_t)
        const line = lv.map((v, i) => `${i ? 'L' : 'M'}${x(t0 + i * step).toFixed(1)},${y(pct(v)).toFixed(1)}`).join(' ')
        const days = []; for (let m = dayStart(t0) + 1440; m < t1; m += 1440) days.push(m)
        const weeks = prod[k.tank] ?? []
        const rateText = (r) => (r >= 0 ? `생산 ${Math.round(r).toLocaleString()} t/h` : `공정 투입 ${Math.round(-r).toLocaleString()} t/h`)
        const ships = plan.placements.filter((p) => p.tank === k.tank)
        return (
          <section key={k.tank} className="mlb-tank">
            <header>
              <b>{k.tank}</b>
              <span>탱크 {k.tanks}기, 현재 {pct(k.initial_t).toFixed(0)}%, 기간 중 {pct(Math.min(...lv)).toFixed(0)}~{pct(Math.max(...lv)).toFixed(0)}%</span>
            </header>
            <div className="mlb-tank-body">
              <svg viewBox={`0 0 ${W} ${H}`} className="mlb-tank-chart" role="img" aria-label={`${k.tank} 재고 흐름`}>
                <rect x={L} y={y(hi)} width={W - L - R} height={y(lo) - y(hi)} className="mlb-t-band" />
                {[0, 50, 100].map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="mlb-g-grid" /><text x={L - 4} y={y(v) + 3} textAnchor="end" className="mlb-g-tick">{v}%</text></g>)}
                {days.map((m) => <g key={m}><line x1={x(m)} x2={x(m)} y1={T} y2={H - B} className="mlb-g-grid" /><text x={x(m)} y={H - 6} textAnchor="middle" className="mlb-g-tick">{fmt(m).slice(0, 5)}</text></g>)}
                {/* 안전 상한, 하한: 굵은 점선 + 오른쪽에 %와 톤 */}
                {[['상한', hi, k.safe_max_t], ['하한', lo, k.safe_min_t]].map(([nm, p, t]) => (
                  <g key={nm}>
                    <line x1={L} x2={W - R} y1={y(p)} y2={y(p)} className="mlb-t-limit" />
                    <text x={W - R + 6} y={y(p) - 2} className="mlb-t-limit-t">{nm} {Math.round(p)}%</text>
                    <text x={W - R + 6} y={y(p) + 11} className="mlb-t-limit-s">{tons(t)}</text>
                  </g>
                ))}
                <path d={line} className="mlb-t-line" />
                {/* 기간 중 최고, 최저 지점과 톤 */}
                {(() => {
                  if (!lv.length) return null
                  let iMax = 0, iMin = 0
                  lv.forEach((v, i) => { if (v > lv[iMax]) iMax = i; if (v < lv[iMin]) iMin = i })
                  const pt = (i, top) => {
                    const px = x(t0 + i * step), py = y(pct(lv[i]))
                    const tx = Math.min(W - R - 4, Math.max(L + 4, px))
                    const anchor = px > W - R - 70 ? 'end' : px < L + 70 ? 'start' : 'middle'
                    const ty = top ? Math.max(T - 6, py - 8) : Math.min(H - B + 0, py + 16)
                    return (
                      <g key={top ? 'max' : 'min'}>
                        <circle cx={px} cy={py} r={3.5} className={`mlb-t-pt ${top ? 'max' : 'min'}`} />
                        <text x={tx} y={ty} textAnchor={anchor} className="mlb-t-pt-t">{top ? '최고' : '최저'} {tons(lv[i])} <tspan className="mlb-t-pt-s">{fmt(t0 + i * step)}</tspan></text>
                      </g>
                    )
                  }
                  return <>{pt(iMax, true)}{iMin !== iMax && pt(iMin, false)}</>
                })()}
              </svg>
              <p className="mlb-rate">생산계획: {weeks.length ? weeks.map((w, i) => `${i === 0 ? '현재' : `${fmt(w.from).slice(0, 5)}부터`} ${rateText(w.rate)}`).join(', ') : '-'}</p>
              {ships.length ? (
                <table className="mlb-table mini">
                  <thead><tr><th>접안</th><th>구분</th><th>선박</th><th>화물</th><th className="r">물량</th></tr></thead>
                  <tbody>{ships.slice(0, SHIP_MAX).map((p) => (
                    <tr key={p.vid}><td className="num">{fmt(p.etb)}</td><td>{p.in ? '입고' : '출하'}</td><td>{p.name}</td><td>{p.product}</td><td className="r num">{tons(p.ton)}</td></tr>
                  ))}
                  {ships.length > SHIP_MAX && <tr><td colSpan={5} className="mlb-more">외 {ships.length - SHIP_MAX}척, 입고 {ships.filter((p) => p.in).length}척, 출하 {ships.filter((p) => !p.in).length}척 (전체 {tons(ships.reduce((a, p) => a + (p.ton ?? 0), 0))})</td></tr>}
                  </tbody>
                </table>
              ) : <p className="mlb-empty">이 기간 입고, 출하 선박 없음</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** 체선 선박 브리핑: 합계 한 줄 + 표 */
function Dem({ plan }) {
  const dem = plan.placements.filter((p) => p.dem > 0).sort((a, b) => b.dem - a.dem)
  return (
    <div className="mlb-dem">
      <p className="mlb-dem-sum">예상 체선료 합계 <b>{money(plan.total)}</b>, 체선 선박 <b>{dem.length}척</b></p>
      {dem.length > 0 && (
        <table className="mlb-table">
          <thead><tr><th>선박</th><th>선석</th><th>접안</th><th className="r">체선 시간</th><th className="r">예상 체선료</th></tr></thead>
          <tbody>{dem.map((p) => (
            <tr key={p.vid}><td><b>{p.name}</b></td><td>{p.berth}</td><td className="num">{fmt(p.etb)}</td><td className="r num">{p.demMin != null ? fmtDur(p.demMin) : '-'}</td><td className="r num">{money(p.dem)}</td></tr>
          ))}</tbody>
        </table>
      )}
    </div>
  )
}

export default function MailBody({ text, plan }) {
  const out = []
  let last = 0
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) {
      const t = text.slice(last, m.index).replace(/^\n+/, '').replace(/\n+$/, '')
      if (t) out.push(<pre key={`t${last}`} className="ml-preview">{t}</pre>)
    }
    const g = groupOf(m[2])
    const k = `b${m.index}`
    out.push(m[1] === '표' ? <RiskTable key={k} plan={plan} g={g} />
      : m[1] === '간트' ? <Gantt key={k} rows={rowsOf(plan, m[2])} />
        : m[1] === '입출항' ? <RiskTable key={k} plan={plan} g={g} port />
          : m[1] === '탱크' ? <Tanks key={k} plan={plan} tank={g?.tank} />
            : <Dem key={k} plan={plan} />)
    last = m.index + m[0].length
  }
  if (last < text.length) { const t = text.slice(last).replace(/^\n+/, ''); if (t) out.push(<pre key={`t${last}`} className="ml-preview">{t}</pre>) }
  return <div className="mlb">{out}</div>
}
