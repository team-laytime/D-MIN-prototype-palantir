// 11-25 부두별 배치 그림 (D-MIN-optimization-front 배치 그림 방식)
//  - 시간 폭 고정(PX_PER_H) + 가로 스크롤, 왼쪽 선석 이름은 붙어 있음. 막대 = 접안 ~ 이안, 막대 안 이름이 잘리지 않을 만큼 넓게.
//  - 체선 구간(허용 정박시간 끝 ~ 호스 분리)만 빨간 빗금, 막대 아래에 체선 시간과 금액. 정박지에서 기다리는 동안 체선이 시작됐으면 막대 앞에 ├ 표시.
//  - 고정한 배는 점선 테두리와 자물쇠. 후보를 바꾸거나 다시 계산하면 막대가 새 자리로 미끄러져 간다(FLIP).
//  - 막대를 누르면 오른쪽 위에 산출 근거가 뜬다(화면을 내려도 따라옴). 시각과 금액은 엔진 값 그대로다.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon } from '@blueprintjs/core'
import { NOW, dayStart, fmt, hourOf, money } from '../lib/time.js'
import { SEV, riskLabel } from '../lib/risk.js'
import RiskContext from './RiskContext.jsx'
import './plan-gantt.css'

const PX_PER_H = 16
const WAIT_PX = 16
const LABEL_W = 132

export const demCentsOf = (p) => (typeof p.dem === 'number' ? p.dem : p.dem?.cents ?? 0)
const demMinOf = (p) => (typeof p.dem === 'number' ? p.demMin ?? 0 : p.dem?.excessMin ?? 0)
/** 분 → '4h 54m' (0인 단위는 뺀다) */
export const hm = (min) => {
  const m = Math.round(min), h = Math.floor(m / 60), r = m % 60
  return [h && `${h}h`, r && `${r}m`].filter(Boolean).join(' ') || '0m'
}

/**
 * @param sim       보여 줄 계획 {id, label, placements[]}
 * @param sims      산출 근거의 후보별 비교에 쓸 후보들(없으면 비교 표 없음)
 * @param focus     {vid, seq, scroll} 짚은 배. scroll이면 그 막대로 화면을 옮긴다
 * @param onFocus   (vid | null) => void
 * @param changed   후보 A와 부두나 접안이 다른 배(Set) — 테두리로 표시
 * @param risks     이 계획의 리스크(팀 리스크 모델) — 산출 근거에 그 배 것만 보인다
 * 운영 현황에서 쓸 때(11-26):
 * @param onPick    있으면 막대를 눌러도 상세 팝업 대신 이 함수를 부른다(선박 카드). 짚은 배는 activeVid
 * @param berthIds  이 선석만 그린다
 * @param cursor    재생 중인 시각 세로선
 * @param showWait  도착 ~ 접안 정박지 대기를 막대 앞에 점선으로
 * @param hlPier · hlBerth  강조할 부두 · 선석 줄
 * @param fit       true면 구간 전체를 영역 폭에 맞춘다(가로 스크롤 없음, 막대에 안 들어가는 이름은 마우스를 올리면). 운영 현황
 */
export default function PlanGantt({ sim, sims, scen, range, focus, onFocus, changed, loading = false, risks = [], onOpenCard, refId, onPick, activeVid, berthIds, cursor, showWait = false, hlPier = null, hlBerth = null, fit = false }) {
  // 11-26 fit: 영역 폭에 맞춰 1시간 폭을 정한다 (창 크기가 바뀌면 다시)
  const areaRef = useRef(null)
  const [areaW, setAreaW] = useState(0)
  useLayoutEffect(() => {
    if (!fit || !areaRef.current) return
    const ro = new ResizeObserver(([e]) => setAreaW(e.contentRect.width))
    ro.observe(areaRef.current)
    return () => ro.disconnect()
  }, [fit])
  const hours = (range.end - range.start) / 60
  const pxh = fit && areaW ? Math.max(2, (areaW - LABEL_W - 2) / hours) : PX_PER_H
  const W = Math.round(hours * pxh)
  const x = (t) => ((Math.min(Math.max(t, range.start), range.end) - range.start) / 60) * pxh
  const vById = useMemo(() => Object.fromEntries(scen.vessels.map((v) => [v.id, v])), [scen])
  const bById = useMemo(() => Object.fromEntries(scen.berths.map((b) => [b.id, b])), [scen])
  const name = (vid) => vById[vid]?.name ?? sim.placements.find((p) => p.vid === vid)?.name ?? scen.nameByCall?.[vid.split('-')[0]] ?? vid.split('-')[0]

  const groups = useMemo(() => {
    const byBerth = {}
    for (const p of sim.placements) (byBerth[p.bid] ??= []).push(p)
    const gs = []
    for (const b of scen.berths) {
      if (berthIds && !berthIds.includes(b.id)) continue
      const row = { berth: b, bars: (byBerth[b.id] ?? []).filter((p) => p.etu > range.start && p.etb < range.end).sort((p, q) => p.etb - q.etb) }
      if (gs.at(-1)?.pier === b.pier) gs.at(-1).rows.push(row)
      else gs.push({ pier: b.pier, name: b.pierName, rows: [row] })
    }
    return gs
  }, [sim, scen, range, berthIds])

  // 눈금 6시간, 0시에 날짜. 야간 20~06시 띠
  const { ticks, nights } = useMemo(() => {
    const ticks = [], nights = []
    for (let t = dayStart(range.start); t <= range.end; t += 360) if (t >= range.start) ticks.push({ t, day: hourOf(t) === 0 })
    for (let d = dayStart(range.start) - 1440; d < range.end; d += 1440) {
      const s = Math.max(d + 20 * 60, range.start), e = Math.min(d + 30 * 60, range.end)
      if (e > s) nights.push({ key: d, s, e })
    }
    return { ticks, nights }
  }, [range])

  // FLIP: 다시 그리기 전 자리에서 새 자리로 미끄러지듯 이동
  const boxRef = useRef(null)
  const last = useRef(new Map())
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const c = box.getBoundingClientRect()
    const next = new Map()
    for (const el of box.querySelectorAll('.pg-bar')) {
      const r = el.getBoundingClientRect()
      const pos = { x: r.left - c.left, y: r.top - c.top }
      const prev = last.current.get(el.dataset.vid)
      if (prev && (Math.abs(prev.x - pos.x) > 1 || Math.abs(prev.y - pos.y) > 1)) {
        el.animate([{ transform: `translate(${prev.x - pos.x}px, ${prev.y - pos.y}px)` }, { transform: 'none' }], { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)' })
      }
      next.set(el.dataset.vid, pos)
    }
    last.current = next
  }, [sim])

  // 밖(표 · 리스크)에서 배를 짚으면 그 막대로 화면을 옮긴다
  useEffect(() => {
    if (!focus?.scroll || !focus.vid) return
    boxRef.current?.querySelector(`.pg-bar[data-vid="${CSS.escape(focus.vid)}"]`)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
  }, [focus?.seq]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && focus?.vid) onFocus(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focus?.vid, onFocus])

  const showCursor = cursor != null && cursor > range.start && cursor <= range.end
  const focusVid = onPick ? activeVid : focus?.vid
  const bg = (
    <>
      {nights.map((n) => <i key={n.key} className="pg-night" style={{ left: x(n.s), width: x(n.e) - x(n.s) }} />)}
      {ticks.map((k) => <i key={k.t} className={`pg-vline ${k.day ? 'day' : ''}`} style={{ left: x(k.t) }} />)}
      {NOW >= range.start && NOW <= range.end && <i className="pg-now" style={{ left: x(NOW) }} />}
      {showCursor && <i className="pg-cursor" style={{ left: x(cursor) }} />}
    </>
  )

  const row = ({ berth, bars }) => {
    let prevEnd = 0
    const waits = [], labels = []
    const els = bars.map((p) => {
      const left = x(p.etb), width = Math.max(x(p.etu) - left - 2, 4)
      const cents = demCentsOf(p), dmin = demMinOf(p)
      let hatch = null
      if (cents > 0 && p.le != null && p.hose != null) {
        const s = Math.max(p.le, p.etb), e = Math.min(p.hose, p.etu)
        if (e > s) hatch = <i className="pg-dem" style={{ left: x(s) - left - 1.5, width: x(e) - x(s) }} />
        if (p.le < p.etb && p.etb > range.start) {
          const len = Math.min(WAIT_PX, left - prevEnd)
          if (len >= 3) waits.push(<i key={`w-${p.vid}`} className="pg-dem-wait" style={{ left: left - len, width: len }} title={`${name(p.vid)} 정박지 대기 중 체선 시작 ${fmt(p.le)}`} />)
        }
      }
      if (cents > 0) labels.push(<span key={`l-${p.vid}`} className="pg-dem-label" style={{ width: left + width }}><span>{dmin ? `${hm(dmin)} · ` : ''}{money(cents)}</span></span>)
      if (showWait) {
        const eta = p.eta ?? vById[p.vid]?.eta
        if (eta != null && eta < p.etb && p.etb > range.start) {
          const a = x(eta), len = left - a
          if (len >= 4) waits.push(<span key={`q-${p.vid}`} className="pg-wait" style={{ left: a, width: len - 1 }} title={`${name(p.vid)} 정박지 대기 ${fmt(eta)} ~ ${fmt(p.etb)}`}>{len >= 60 && <em>대기 {hm(p.etb - eta)}</em>}</span>)
        }
      }
      prevEnd = Math.max(prevEnd, left + width + 2)
      const on = focusVid === p.vid
      const cls = ['pg-bar', p.fixed && 'pinned', cents > 0 && !hatch && 'dem', changed?.has(p.vid) && 'chg', on ? 'focus' : !onPick && focusVid ? 'dim' : ''].filter(Boolean).join(' ')
      const tip = `${vById[p.vid]?.fullName ?? name(p.vid)} · ${berth.label ?? berth.code} · ${fmt(p.etb)} ~ ${fmt(p.etu)}${cents ? ` · 체선 ${hm(dmin)} ${money(cents)}` : ''}${changed?.has(p.vid) ? ` · 후보 ${refId}와 부두가 다름` : ''}`
      return (
        <button type="button" key={p.vid} data-vid={p.vid} className={cls} style={{ left, width }} title={tip}
          onClick={(e) => { e.stopPropagation(); if (onPick) onPick(p.vid); else onFocus(on ? null : p.vid) }} aria-label={tip} aria-pressed={on}>
          {hatch}
          <span className="pg-bar-t">{p.fixed && <Icon icon="lock" size={11} />}{name(p.vid)}</span>
        </button>
      )
    })
    return (
      <div className={`pg-row ${labels.length ? 'has-dem' : ''} ${hlPier === berth.pier || hlBerth === berth.id ? 'hl' : ''}`} key={berth.id}>
        <div className="pg-label"><span className="pg-berth" title={`${berth.name}, 최대 ${berth.maxDwt?.toLocaleString() ?? '-'} DWT`}>{berth.label ?? berth.code}</span><span className="pg-cnt">{bars.length || ''}</span></div>
        <div className="pg-track" style={{ width: W }}>{bg}{waits}{els}{labels}</div>
      </div>
    )
  }

  const fp = !onPick && focus?.vid && sim.placements.find((p) => p.vid === focus.vid)
  const rk = !onPick && focus?.risk && focus.riskSim === sim.id ? focus.risk : null // 다른 후보로 바꾸면 그 리스크 카드는 닫는다
  return (
    <div className="pg-area" ref={areaRef}>
      <div className="pg-wrap">
        <div className={`pg ${loading ? 'loading' : ''}`} ref={boxRef} style={{ width: W + LABEL_W }} onClick={() => !onPick && focus?.vid && onFocus(null)}>
          <div className="pg-row pg-axis">
            <div className="pg-label"><span className="faint">KST</span></div>
            <div className="pg-track" style={{ width: W }}>
              {ticks.map((k) => <span key={k.t} className={`pg-tick ${k.day ? 'day' : ''}`} style={{ left: x(k.t) }}>{k.day ? fmt(k.t).slice(0, 5) : String(hourOf(k.t)).padStart(2, '0')}</span>)}
              {NOW >= range.start && NOW <= range.end && <span className="pg-now-label" style={{ left: x(NOW) }}>지금</span>}
              {showCursor && <span className="pg-cursor-label" style={{ left: x(cursor) }}>{fmt(cursor)}</span>}
            </div>
          </div>
          {groups.map((g) => (
            <Fragment key={g.rows[0].berth.id}>
              <div className="pg-row pg-pier">
                <div className="pg-label"><b>{g.name}</b><small>{g.rows.reduce((s, r) => s + r.bars.length, 0)}척</small></div>
                <div className="pg-track" style={{ width: W }} />
              </div>
              {g.rows.map(row)}
            </Fragment>
          ))}
        </div>
      </div>
      <aside className={`pg-detail ${fp || rk ? 'open' : ''}`} aria-hidden={!(fp || rk)}>
        {(fp || rk) && (
          <div className="pg-detail-in" key={`${focus.seq}`} onClick={(e) => e.stopPropagation()}>
            {/* 11-25 리스크를 눌러 왔으면 그 리스크를 그림으로 먼저 보이고, 그 배의 산출 근거를 아래에 */}
            {rk && <RiskContext risk={rk} sim={sim} scen={scen} name={name} onClose={() => onFocus(null)} />}
            {fp && <Detail p={fp} v={vById[fp.vid]} bById={bById} name={name} risks={risks.filter((r) => r.vessel_ids?.includes(fp.vid) && r.id !== rk?.id)}
              onClose={() => onFocus(null)} onOpenCard={onOpenCard} />}
          </div>
        )}
      </aside>
    </div>
  )
}

/** 배 상세: 시각 · 체선 · 이유 · 이 배의 리스크 */
function Detail({ p, v, bById, name, risks, onClose, onOpenCard }) {
  const berth = (bid) => bById[bid]?.label ?? bid
  const cents = demCentsOf(p), dmin = demMinOf(p)
  const c = v?.contract
  const reasons = []
  if (p.fixed) reasons.push('고정한 배 — 이 부두 · 접안 시각 그대로')
  if (cents > 0 && p.le != null) {
    reasons.push(p.le < p.etb
      ? `체선 — 허용 정박시간(${c?.laytimeH ?? '-'}h)이 ${fmt(p.le)}에 끝났는데 접안은 ${fmt(p.etb)} → 정박지 대기부터 호스 분리까지 체선`
      : `체선 — 작업 중 허용 정박시간(${c?.laytimeH ?? '-'}h)이 ${fmt(p.le)}에 끝나 호스 분리(${fmt(p.hose)})까지 체선`)
  } else if (cents > 0) reasons.push(`체선 ${money(cents)}`)
  if (p.dem?.weatherMin) reasons.push(`기상 공제 ${hm(p.dem.weatherMin)}`)
  if (!reasons.length) reasons.push('체선 없음 — 허용 정박시간 안에 호스 분리')

  const range = (a, b) => <dd className="pg-range"><span>{fmt(a)}</span><span>→ {fmt(b)}</span></dd>
  return (
    <div className="pg-ship">
      <h3><span className="pg-shipbox">{name(p.vid)}</span>
        <button type="button" className="pg-close" aria-label="닫기" onClick={onClose}><Icon icon="cross" size={14} /></button></h3>
      <p className="pg-sub">{p.vid}{v ? ` · ${v.product} ${v.dir} · ${v.cls ?? ''}` : ''}</p>
      <dl>
        <div><dt>배정 부두</dt><dd>{berth(p.bid)}</dd></div>
        <div><dt>도착 (ETA)</dt><dd>{fmt(p.eta ?? v?.eta)}</dd></div>
        <div><dt>접안 → 이안</dt>{range(p.etb, p.etu)}</div>
        <div><dt>작업 시작 → 완료</dt>{range(p.ws, p.wf)}</div>
        <div><dt>정박 개시 → 허용 끝</dt>{range(p.ls, p.le)}</div>
        <div><dt>호스 분리</dt><dd>{fmt(p.hose)}</dd></div>
        <div><dt>체선 시간 · 하루 단가</dt><dd>{hm(dmin)} · ${(c?.rateUsd ?? 0).toLocaleString()}</dd></div>
        <div><dt>예상 체선료</dt><dd className={cents ? 'c-red' : ''}>{money(cents)}</dd></div>
      </dl>
      <ul className="pg-reasons">{reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {risks.length > 0 && (
        <ul className="pg-risks">{risks.map((r) => <li key={r.id} title={r.title}><span className={`sev ${SEV[r.severity].tone}`}>{SEV[r.severity].text}</span>{riskLabel(r, name)}</li>)}</ul>
      )}
      {onOpenCard && (
        <div className="pg-actions">
          <Button size="small" variant="minimal" icon="document-open" onClick={() => onOpenCard(p.vid)}>선박 카드</Button>
        </div>
      )}
    </div>
  )
}
