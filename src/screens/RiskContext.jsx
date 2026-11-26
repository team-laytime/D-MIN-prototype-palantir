// 11-25 리스크를 누르면 무엇이 문제인지 그림으로 보여 준다 (배치 그림 오른쪽 위 카드).
//   TANK      그 탱크 묶음의 재고 곡선 · 마지노선 20/80% · 계획 안전 범위 · 리스크 구간 · 관련 선박 작업
//   WORK_GAP  연속 접안: 줄 선 배들을 「계획」과 「첫 배가 1시간 늦으면」 두 줄로 — 사이 여유가 없으면 뒤 배가 줄줄이 밀린다
//   LAYTIME   도착 → 대기 → 작업 → 호스 분리 → 허용 정박시간 끝, 여유와 체선이 붙기 시작하는 곳
//   그 밖     리스크 모델 문장과 근거 숫자
// 숫자는 모두 엔진 응답 · 리스크 모델 evidence 그대로다.
import { dayStart, fmt, hourOf, money, toMin } from '../lib/time.js'
import { KIND, SEV, riskLabel } from '../lib/risk.js'
import { hm } from './PlanGantt.jsx'

const W = 420

/** 시간축 도우미: [t0, t1] → [l, W − r] */
function axis(t0, t1, l = 8, r = 8) {
  const x = (t) => l + ((Math.min(Math.max(t, t0), t1) - t0) / Math.max(1, t1 - t0)) * (W - l - r)
  const ticks = []
  const span = t1 - t0
  const step = span > 60 * 60 ? 1440 : span > 30 * 60 ? 720 : 360 // 길면 날짜만, 중간이면 12시간, 짧으면 6시간 눈금
  for (let t = dayStart(t0); t <= t1; t += step) if (t >= t0) ticks.push(t)
  return { x, ticks }
}
const Ticks = ({ ax, y1, y2 }) => ax.ticks.map((t) => (
  <g key={t}>
    <line x1={ax.x(t)} x2={ax.x(t)} y1={y1} y2={y2} className={hourOf(t) === 0 ? 'rc-day' : 'rc-grid'} />
    <text x={ax.x(t) + 2} y={y2 + 11} className="rc-tick">{hourOf(t) === 0 ? fmt(t).slice(0, 5) : String(hourOf(t)).padStart(2, '0')}</text>
  </g>
))

function TankChart({ risk, sim, scen, name }) {
  const t = sim.tanks?.find((x) => x.tank === risk.tank)
  if (!t?.levels_t?.length) return null
  const step = t.step_min ?? 60, s0 = toMin(t.start), s1 = s0 + step * (t.levels_t.length - 1)
  const H = 130, top = 8, bot = 104
  const ax = axis(s0, s1, 34)
  const y = (pct) => bot - (Math.max(0, Math.min(100, pct)) / 100) * (bot - top)
  const pct = t.levels_t.map((lv) => (lv / t.capacity_t) * 100)
  const line = pct.map((p, i) => `${i ? 'L' : 'M'}${ax.x(s0 + i * step).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  const r0 = toMin(risk.start), r1 = toMin(risk.end)
  const e = risk.evidence ?? {}
  const wi = pct.reduce((b, p, i) => { const tt = s0 + i * step; if (tt < r0 || tt > r1) return b; return b == null || (e.side === 'OVER' ? p > pct[b] : p < pct[b]) ? i : b }, null)
  const lo = (t.safe_min_t / t.capacity_t) * 100, hi = (t.safe_max_t / t.capacity_t) * 100
  const vById = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
  // 관련 선박은 리스크 구간에 작업이 가장 가까운 5척만 (나머지는 '외 n척')
  const near = (p) => (p.wf < r0 ? r0 - p.wf : p.ws > r1 ? p.ws - r1 : 0)
  const all = (risk.vessel_ids ?? []).map((vid) => ({ vid, p: sim.placements.find((p) => p.vid === vid), v: vById[vid] })).filter((x) => x.p)
  const ships = [...all].sort((x, y) => near(x.p) - near(y.p)).slice(0, 5).sort((x, y) => x.p.ws - y.p.ws)
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H + ships.length * 14}`} className="rc-svg" role="img" aria-label={`${t.tank} 재고 곡선`}>
        <rect x={ax.x(r0)} y={top} width={Math.max(2, ax.x(r1) - ax.x(r0))} height={bot - top} className="rc-zone" />
        <rect x={34} y={y(hi)} width={W - 42} height={y(lo) - y(hi)} className="rc-band" />
        <Ticks ax={ax} y1={top} y2={bot} />
        {[20, 80].map((p) => <g key={p}><line x1={34} x2={W - 8} y1={y(p)} y2={y(p)} className="rc-limit" /><text x={2} y={y(p) + 3} className="rc-lim-t">{p}%</text></g>)}
        <text x={2} y={y(50) + 3} className="rc-tick">50%</text>
        <path d={line} className="rc-line" />
        {wi != null && <g><circle cx={ax.x(s0 + wi * step)} cy={y(pct[wi])} r={3.5} className="rc-pt" />
          <text x={ax.x(s0 + wi * step) + 6} y={y(pct[wi]) + (e.side === 'OVER' ? -5 : 12)} className="rc-pt-t">{pct[wi].toFixed(1)}%</text></g>}
        {ships.map(({ vid, p, v }, i) => (
          <g key={vid}>
            <rect x={ax.x(p.ws)} y={H + i * 14} width={Math.max(2, ax.x(p.wf) - ax.x(p.ws))} height={9} className={v?.in ? 'rc-in' : 'rc-out'} />
            <text x={Math.min(ax.x(p.wf) + 4, W - 120)} y={H + i * 14 + 8} className="rc-tick">{name(vid)} {v?.in ? '반입' : '반출'}</text>
          </g>
        ))}
      </svg>
      <p className="rc-note">빨간 점선 = 마지노선 20/80% · 옅은 띠 = 계획 안전 범위 {Math.round(lo)}~{Math.round(hi)}% · 주황 = 리스크 구간{ships.length ? ` · 아래 막대 = 관련 선박 작업(파랑 반입, 주황 반출)${all.length > ships.length ? `, 외 ${all.length - ships.length}척` : ''}` : ''}</p>
    </>
  )
}

function WorkGapChart({ risk, sim, scen, name }) {
  const e = risk.evidence ?? {}
  const ids = risk.vessel_ids ?? []
  // 줄 선 배: 계획한 배는 엔진 배치, 기준 시각에 작업 중인 배는 선석 점유(occupied)
  const occ = (scen.occupied ?? []).filter((o) => o.bid === risk.berth)
  const ships = ids.map((vid) => {
    const p = sim.placements.find((x) => x.vid === vid)
    if (p) return { vid, etb: p.etb, etu: p.etu, working: false }
    const o = occ[0] // 작업 중인 배는 줄 맨 앞 한 척뿐 (선석 점유 기록엔 선박 ID가 없다)
    return o ? { vid, etb: o.etb, etu: o.etu, working: true } : null
  })
  if (ships.some((s) => !s)) return null
  const sw = (e.switching_h ?? 0) * 60
  const gaps = (e.gaps_h ?? []).map((g) => g * 60)
  const LATE = 60 // 첫 배가 1시간 늦으면: 사이 여유만큼 흡수하고 남는 만큼 다음 배가 밀린다
  const shifts = [LATE]
  gaps.forEach((g, i) => shifts.push(Math.max(0, shifts[i] - g)))
  const t0 = ships[0].etb - 60, t1 = ships.at(-1).etu + LATE + 60
  const ax = axis(t0, t1, 64)
  const row = (y, label, late) => (
    <g>
      <text x={2} y={y + 13} className="rc-row-t">{label}</text>
      {ships.map((s, i) => {
        const d = late ? shifts[i] : 0
        return (
          <g key={s.vid}>
            <rect x={ax.x(s.etb + d)} y={y + 2} width={Math.max(2, ax.x(s.etu + d) - ax.x(s.etb + d) - 1)} height={16} className={`rc-bar ${d > 0 && i > 0 ? 'rc-pushed' : ''}`} />
            {i < ships.length - 1 && <rect x={ax.x(s.etu + d)} y={y + 6} width={Math.max(1, ax.x(s.etu + d + sw) - ax.x(s.etu + d))} height={8} className="rc-sw" />}
          </g>
        )
      })}
    </g>
  )
  const pushed = shifts.slice(1).filter((d) => d > 0).length
  return (
    <>
      <svg viewBox={`0 0 ${W} 92`} className="rc-svg" role="img" aria-label="연속 접안">
        <Ticks ax={ax} y1={4} y2={70} />
        {row(8, '계획', false)}
        {row(38, '첫 배 1h 늦으면', true)}
      </svg>
      <p className="rc-note">{ships.map((s) => `${name(s.vid)}${s.working ? '(작업 중)' : ''}`).join(' → ')} · 사이 여유 {(e.gaps_h ?? []).join(' · ')}h
        (부두 전환 {e.switching_h}h 뺀 값, 회색 = 부두 전환) · 첫 배가 1시간 늦으면 뒤 {pushed}척이 밀림{risk.cost_per_hour ? ` · 밀리면 체선료 시간당 ${money(Math.round(risk.cost_per_hour.amount * 100))}` : ''}</p>
    </>
  )
}

function LaytimeChart({ risk, sim, name }) {
  const p = sim.placements.find((x) => x.vid === risk.vessel_ids?.[0])
  if (!p || p.le == null) return null
  const eta = p.eta
  const t0 = Math.max(Math.min(eta, p.ls ?? eta), p.etb - 30 * 60) - 60, t1 = Math.max(p.le, p.etu) + 4 * 60
  const ax = axis(t0, t1, 8)
  const slack = p.le - p.hose
  return (
    <>
      <svg viewBox={`0 0 ${W} 78`} className="rc-svg" role="img" aria-label="정박시간">
        <Ticks ax={ax} y1={4} y2={56} />
        {eta < p.etb && <line x1={ax.x(eta)} x2={ax.x(p.etb)} y1={24} y2={24} className="rc-wait" />}
        <rect x={ax.x(p.etb)} y={16} width={ax.x(p.etu) - ax.x(p.etb)} height={16} className="rc-bar" />
        <rect x={ax.x(p.ws)} y={20} width={Math.max(1, ax.x(p.wf) - ax.x(p.ws))} height={8} className="rc-work" />
        {slack > 0 && <rect x={ax.x(p.hose)} y={12} width={ax.x(p.le) - ax.x(p.hose)} height={24} className="rc-slack" />}
        <rect x={ax.x(p.le)} y={12} width={Math.max(0, W - 8 - ax.x(p.le))} height={24} className="rc-zone" />
        <line x1={ax.x(p.le)} x2={ax.x(p.le)} y1={6} y2={42} className="rc-limit" />
        <text x={ax.x(p.le) + 3} y={10} className="rc-lim-t">허용 끝 {fmt(p.le).slice(-5)}</text>
        <line x1={ax.x(p.hose)} x2={ax.x(p.hose)} y1={12} y2={36} className="rc-hose" />
        <text x={Math.max(8, ax.x(eta))} y={48} className="rc-tick">{eta >= t0 ? `도착 ${fmt(eta).slice(-5)}` : ''}</text>
        <text x={ax.x(p.etb) + 3} y={28} className="rc-bar-t">{name(p.vid)}</text>
      </svg>
      <p className="rc-note">호스 분리 {fmt(p.hose)} → 허용 정박시간 끝 {fmt(p.le)}: 여유 {hm(Math.max(0, slack))}{slack <= 0 ? ' (이미 체선)' : ''} · 그 뒤(빨간 구간)부터 체선료{risk.cost_per_hour ? ` 시간당 ${money(Math.round(risk.cost_per_hour.amount * 100))}` : ''} · 점선 = 정박지 대기, 진한 막대 = 하역 작업</p>
    </>
  )
}

export default function RiskContext({ risk, sim, scen, name, onClose }) {
  const chart = risk.kind === 'TANK' ? <TankChart risk={risk} sim={sim} scen={scen} name={name} />
    : risk.kind === 'WORK_GAP' ? <WorkGapChart risk={risk} sim={sim} scen={scen} name={name} />
      : risk.kind === 'LAYTIME' ? <LaytimeChart risk={risk} sim={sim} name={name} /> : null
  return (
    <section className="rc">
      <header className="rc-head">
        <span className={`sev ${SEV[risk.severity].tone}`}>{SEV[risk.severity].text}</span>
        <b>{KIND[risk.kind] ?? risk.kind} 리스크 · {sim.label}</b>
        {onClose && <button type="button" className="pg-close" aria-label="닫기" onClick={onClose}>×</button>}
      </header>
      <p className="rc-title">{riskLabel(risk, name)}</p>
      <p className="rc-time">{fmt(toMin(risk.start))} ~ {fmt(toMin(risk.end))}</p>
      {chart ?? <p className="rc-note">{risk.title}</p>}
    </section>
  )
}
