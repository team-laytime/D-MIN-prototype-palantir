import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon } from '@blueprintjs/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useApp } from '../state/app.jsx'
import { Panel, Stats, St } from '../ui/kit.jsx'
import { risks, stateAt } from '../lib/engine.js'
import { MAP_CONTEXT } from '../lib/scenarios.js'
import { NAV, anchorageFor, positionOf } from '../lib/vesselState.js'
import { at, fmt, fmtDur, money } from '../lib/time.js'
import { BerthBoard } from './BerthBoard.jsx'
import './home.css'

const START = at(14, 0)
const MAP_BOUNDS = [[35.398, 129.359], [35.509, 129.484]]
const PHASE = {
  coming: { text: '입항 예정', tone: 'idle' },
  waiting: { text: '정박지 대기', tone: 'warn' },
  berthed: { text: '작업 중', tone: 'live' },
  left: { text: '출항', tone: 'idle' },
}
const SHORTCUTS = [
  { id: 'input', label: '시나리오 입력', icon: 'form' },
  { id: 'compare', label: '후보 비교', icon: 'comparison' },
  { id: 'risk', label: '리스크·확정', icon: 'shield' },
  { id: 'report', label: '접안계획 보고서', icon: 'document' },
  { id: 'verify', label: '계산 검증', icon: 'endorsed' },
]
const planLabel = (plan) => plan.id === 'FCFS' ? '도착순 기준안' : plan.label
const percentChange = (total, baseline) => baseline ? `${((total - baseline) / baseline * 100).toFixed(1)}%` : '—'
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

function shipIcon({ name, phase, cog, selected, ticking, extra = '' }) {
  return L.divIcon({
    className: 'home-map-vessel-wrap',
    html: `<div class="home-map-vessel ${phase}${selected ? ' selected' : ''}${ticking ? ' ticking' : ''}"><svg width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true">${ticking ? '<circle class="home-dem-ring" r="11" fill="none" stroke-dasharray="3 2"/>' : ''}<g transform="rotate(${cog})"><path d="M0 -9 L4.5 -3 L4.5 8 L-4.5 8 L-4.5 -3 Z"/><rect x="-2.5" y="2" width="5" height="3"/></g></svg><span class="home-map-vessel-label">${escapeHtml(name)}${extra ? ` <em>${escapeHtml(extra)}</em>` : ''}</span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

export default function Home() {
  const { all: plans, result, scen, current, version, focusId, setFocusId, openVessel, go } = useApp()
  const [planId, setPlanId] = useState(() => plans.find((p) => p.id === focusId)?.id ?? plans[1]?.id ?? plans[0]?.id)
  const [t, setT] = useState(at(14, 20))
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState(null)
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markerLayer = useRef(null)
  const markers = useRef(new Map())
  const plan = plans.find((p) => p.id === planId) ?? plans[1] ?? plans[0]
  const fcfs = result.fcfs
  const best = result.candidates[0] ?? fcfs
  const end = useMemo(() => {
    let last = START
    for (const candidate of plans) for (const p of candidate.placements) last = Math.max(last, p.etu)
    return Math.ceil(last / 60) * 60 + 60
  }, [plans])
  const statesByPlan = useMemo(() => Object.fromEntries(plans.map((candidate) => [
    candidate.id, stateAt(candidate, scen, t).sort((a, b) => a.v.eta - b.v.eta),
  ])), [plans, scen, t])
  const states = statesByPlan[plan.id]
  const accrued = useMemo(() => Object.fromEntries(plans.map((candidate) => [
    candidate.id, statesByPlan[candidate.id].reduce((sum, state) => sum + state.cents, 0),
  ])), [plans, statesByPlan])
  const risksByPlan = useMemo(() => Object.fromEntries(plans.map((candidate) => [candidate.id, risks(candidate, scen)])), [plans, scen])
  const openRisks = risksByPlan[plan.id].filter((risk) => risk.state !== '해당 없음')
  const weather = scen.env.weather
  const weatherNow = !!weather && t >= weather.start && t < weather.end
  const isNight = !scen.env.days.some((day) => t >= day.sunrise && t < day.sunset)
  const coming = states.filter((state) => state.phase === 'coming')
  const fixed = current && current.version === version
  const occupied = scen.berths.filter((b) => states.some((s) => s.phase === 'berthed' && s.p.bid === b.id) || (b.occupiedUntil !== null && t < b.occupiedUntil)).length
  const pct = (minute) => (minute - START) / (end - START) * 100
  const bands = useMemo(() => {
    const out = []
    const add = (key, kind, from, to) => {
      const left = Math.max(START, from)
      const right = Math.min(end, to)
      if (right > left) out.push({ key, kind, left: (left - START) / (end - START) * 100, width: (right - left) / (end - START) * 100 })
    }
    for (let i = 0; i < scen.env.days.length - 1; i++) add(`night-${i}`, 'night', scen.env.days[i].sunset, scen.env.days[i + 1].sunrise)
    if (weather) add('weather', 'weather', weather.start, weather.end)
    return out
  }, [end, scen.env.days, weather])
  const dayTicks = useMemo(() => {
    const ticks = []
    for (let minute = START; minute <= end; minute += 1440) ticks.push(minute)
    return ticks
  }, [end])
  const notes = [
    ...(weather ? [{ key: 'weather', tag: '기상', tone: weatherNow ? 'red' : 'amber', text: `${weather.label} · ${fmt(weather.start)}~${fmt(weather.end).slice(6)} 접안 금지`, at: weatherNow ? '발효 중' : '예보' }] : []),
    ...states.filter((s) => s.ticking).map((s) => ({ key: s.v.id, tag: '체선', tone: 'red', text: `${s.v.name} 체선 발생 · 누적 ${money(s.cents)}`, at: fmt(t).slice(6), vid: s.v.id })),
    ...openRisks.map((risk) => ({ key: `risk-${risk.key}`, tag: '리스크', tone: risk.state === '판단 불가' ? 'violet' : 'amber', text: `${risk.label} ${risk.state} · ${planLabel(plan)}`, at: '확인 필요', go: 'risk' })),
    { key: 'fixed', tag: '확정', tone: fixed ? 'accent' : '', text: fixed ? `${current.label} ${current.status}` : '접안 계획 확정 전', at: fixed ? '스케줄러' : '대기', go: 'risk' },
  ]

  useEffect(() => {
    if (!plans.some((p) => p.id === planId)) setPlanId(plans[1]?.id ?? plans[0]?.id)
  }, [plans, planId])

  useEffect(() => { setT((now) => Math.min(end, now)) }, [end])
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setT((now) => Math.min(end, now + 30)), 350)
    return () => window.clearInterval(timer)
  }, [playing, end])
  useEffect(() => { if (t >= end) setPlaying(false) }, [t, end])

  // 지도 수명과 선박 표식 갱신을 분리합니다. StrictMode 재마운트도 같은 정리 경로를 씁니다.
  useEffect(() => {
    const map = L.map(mapElement.current, { zoomControl: false, minZoom: 11, maxZoom: 18, zoomSnap: 0.5 })
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      className: 'home-base-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    map.fitBounds(MAP_BOUNDS, { padding: [24, 24] })
    for (const f of MAP_CONTEXT.facilities) {
      L.marker(f.pos, {
        icon: L.divIcon({ className: 'home-map-label-wrap', html: `<span class="home-map-berth context">${escapeHtml(f.code)}</span>`, iconSize: [0, 0] }),
        keyboard: false,
      }).bindTooltip('계산 대상 아님', { className: 'home-map-tip' }).addTo(map)
    }
    for (const anchorage of MAP_CONTEXT.anchorages) {
      L.circle(anchorage.center, { radius: 900, color: '#e9a83a', weight: 1, dashArray: '4 4', fillColor: '#e9a83a', fillOpacity: 0.035, interactive: false }).addTo(map)
      L.marker([anchorage.center[0] + 0.011, anchorage.center[1]], {
        icon: L.divIcon({ className: 'home-map-label-wrap', html: `<span class="home-map-anchorage">${escapeHtml(anchorage.label)}</span>`, iconSize: [0, 0] }),
        interactive: false,
        keyboard: false,
      }).addTo(map)
    }
    markerLayer.current = L.layerGroup().addTo(map)
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    resize.observe(mapElement.current)
    return () => {
      resize.disconnect()
      markers.current.clear()
      markerLayer.current = null
      mapRef.current = null
      map.remove()
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current || !markerLayer.current) return
    const wanted = new Set()
    const update = (key, pos, icon, title, tooltip, onClick, zIndexOffset = 0) => {
      wanted.add(key)
      let marker = markers.current.get(key)
      if (!marker) {
        marker = L.marker(pos, { icon, title, zIndexOffset }).addTo(markerLayer.current)
        markers.current.set(key, marker)
      } else marker.setLatLng(pos).setIcon(icon).setZIndexOffset(zIndexOffset)
      marker.off('click')
      if (onClick) marker.on('click', onClick)
      if (tooltip) {
        if (marker.getTooltip()) marker.setTooltipContent(tooltip)
        else marker.bindTooltip(tooltip, { direction: 'auto', offset: [12, 0], className: 'home-map-tip' })
      }
    }
    const open = (vid) => { setSelected(vid); openVessel(plan.id, vid, { at: t }) }
    for (const berth of scen.berths) {
      const occupant = states.find((s) => s.phase === 'berthed' && s.p.bid === berth.id)
      const legacy = berth.occupiedUntil !== null && t < berth.occupiedUntil
      const queue = plan.placements.filter((p) => p.bid === berth.id).sort((a, b) => a.etb - b.etb)
      const tooltip = `<b>${escapeHtml(berth.name)}</b> · ${berth.maxDwt.toLocaleString()} DWT · 흘수 ${berth.maxDraft}m<br>${escapeHtml(berth.products.join(', '))}<br><br><b>${escapeHtml(planLabel(plan))} 접안 순서</b><br>${queue.map((p) => `${fmt(p.etb)} ${escapeHtml(scen.vessels.find((v) => v.id === p.vid).name)}`).join('<br>')}`
      update(`berth-${berth.id}`, berth.pos, L.divIcon({
        className: 'home-map-label-wrap',
        html: `<span class="home-map-berth${occupant || legacy ? ' busy' : ''}">${escapeHtml(berth.code)}</span>`,
        iconSize: [0, 0],
      }), berth.name, tooltip, occupant ? () => open(occupant.v.id) : null, 500)
      if (legacy) update(`legacy-${berth.id}`, berth.moor, shipIcon({ name: berth.occupiedBy, phase: 'legacy', cog: NAV.berthed.cog }), berth.occupiedBy, `<b>${escapeHtml(berth.occupiedBy)}</b> · 기존 접안선<br>${fmt(berth.occupiedUntil)} 이안 예정`)
    }
    const anchorUse = {}
    for (const state of states) {
      if (state.phase === 'coming' || state.phase === 'left') continue
      let spot = 0
      if (state.phase === 'waiting') {
        const anchorage = anchorageFor(state.v)
        spot = anchorUse[anchorage.id] = (anchorUse[anchorage.id] ?? -1) + 1
      }
      const isSelected = selected === state.v.id
      update(`vessel-${state.v.id}`, positionOf(state, scen, spot), shipIcon({
        name: state.v.name, phase: state.phase, cog: NAV[state.phase].cog, selected: isSelected, ticking: state.ticking,
        extra: state.ticking ? money(state.cents) : '',
      }), `${state.v.name} 선박 카드`, `<b>${escapeHtml(state.v.name)}</b> · ${escapeHtml(state.v.type)}<br>${escapeHtml(state.v.flag)} · DWT ${state.v.dwt.toLocaleString()} · ${escapeHtml(state.v.product)} ${escapeHtml(state.v.dir)}<br>도착(ETA) ${fmt(state.v.eta)} · 접안(ETB) ${fmt(state.p.etb)}<br>눌러서 전체 제원 보기`, () => open(state.v.id), isSelected ? 1200 : 800)
    }
    for (const [key, marker] of markers.current) {
      if (!wanted.has(key)) { markerLayer.current.removeLayer(marker); markers.current.delete(key) }
    }
  }, [plan, scen, states, selected, t, openVessel])

  const choose = (id) => { setPlanId(id); setFocusId(id) }
  const openCard = (vid) => { setSelected(vid); openVessel(plan.id, vid, { at: t }) }
  const step = (minutes) => { setPlaying(false); setT((now) => Math.max(START, Math.min(end, now + minutes))) }
  const pick = (state) => {
    setSelected(state.v.id)
    if (state.phase === 'berthed') mapRef.current?.flyTo(positionOf(state, scen), 15, { duration: 0.6 })
    if (state.phase === 'waiting') mapRef.current?.flyTo(anchorageFor(state.v).center, 14, { duration: 0.6 })
  }
  const stateText = (state) => {
    const berth = scen.berths.find((b) => b.id === state.p.bid)
    if (state.phase === 'coming') return `${fmt(state.v.eta)} 도착 예정`
    if (state.phase === 'waiting') return `${anchorageFor(state.v).label} ${fmtDur(t - state.v.eta)} · ${berth.name} ${fmt(state.p.etb).slice(6)} 접안 예정`
    if (state.phase === 'berthed') return `${berth.name} · 진행 ${Math.round(state.progress * 100)}%`
    return `${fmt(state.p.etu)} 작업 종료`
  }

  return (
    <div className="home-console">
      <Stats className="home-stats" items={[
        { label: '대기 선박', value: <><span className="num">{scen.vessels.length}</span><span className="home-stat-unit">척</span></>, sub: `부두 ${scen.berths.length}곳 · 가상 시나리오` },
        { label: '도착순 기준안', value: money(fcfs.total), sub: '비교용 · 현행 실적 아님' },
        { label: `${best.label} (최저)`, value: money(best.total), sub: `기준안 대비 ${percentChange(best.total, fcfs.total)}`, tone: 'green' },
        { label: '확인할 리스크', value: <><span className="num">{risksByPlan[best.id].filter((r) => r.state !== '해당 없음').length}</span><span className="home-stat-unit">건</span></>, sub: best.label, tone: 'amber' },
        { label: '계획 확정', value: <span className="home-stat-prose">{fixed ? `${current.label} ${current.status}` : '확정 전'}</span>, sub: fixed ? `입력 v${version} 기준` : '리스크 확인 후 확정합니다', tone: fixed ? 'accent' : undefined },
      ]} />

      <div className={`home-weather ${weatherNow ? 'active' : ''}`}>
        <Icon icon={weather ? 'warning-sign' : 'tick-circle'} size={13} />
        <span>{weather ? <><strong>{weather.label}</strong><span className="home-weather-period num">{fmt(weather.start)} ~ {fmt(weather.end)}</span>전 부두 접안 금지{weatherNow ? ' · 현재 발효 중' : ''}<span className="home-weather-source"> · {weather.source}</span></> : '기상 악화 예보 없음 · 접안 조건은 조석·주간 제한을 함께 적용합니다.'}</span>
        <Button variant="minimal" size="small" endIcon="arrow-right" onClick={() => go('compare')}>후보 비교</Button>
      </div>

      <div className="home-main">
        <Panel code="PORT-COP" title="운영 현황" desc="울산항 · 선박 위치" className="home-map-panel" bodyClass="home-map-body" actions={<><span className="home-occupancy small">선석 점유 <b className="num">{Math.round(occupied / scen.berths.length * 100)}%</b></span><Button variant="minimal" size="small" icon="zoom-to-fit" aria-label="지도 전체 보기" title="지도 전체 보기" onClick={() => mapRef.current?.fitBounds(MAP_BOUNDS, { padding: [24, 24] })} /></>}>
          <div className="home-map-stage">
            <div ref={mapElement} className="home-map" role="region" aria-label="울산항 선박 위치 지도" />
            <div className="home-map-context"><span className="chip accent">{planLabel(plan)}</span>{isNight && <span className="home-night"><Icon icon="moon" size={12} />야간 · 6만 DWT 이상 접안 불가</span>}</div>
            {coming.length > 0 && <div className="home-coming">
              <header>입항 예정 <span>항해 중 · 제원 보기</span></header>
              {coming.map(({ v }) => <button type="button" key={v.id} onClick={() => openCard(v.id)}>
                <strong>{v.name}</strong><span className="num">ETA {fmt(v.eta)}</span>
                <small>{fmtDur(v.eta - t)} 후 · 약 <span className="num">{Math.round((v.eta - t) / 60 * NAV.coming.sog)}nm</span> · {v.prevPort.split(',')[0]}발</small>
              </button>)}
            </div>}
          </div>
          <div className="home-map-legend"><St tone="live">부두 계류</St><St tone="warn">입항 예정·정박지 대기</St><St tone="bad">체선 발생</St><span className="home-legend-berth"><span className="chip">SK6</span>SK 부두</span></div>
          <div className="home-time-dock" data-tour="time-dock">
            <div className="home-time-controls">
              <Button variant="minimal" size="small" icon="step-backward" aria-label="처음으로" title="처음으로" onClick={() => { setPlaying(false); setT(START) }} />
              <Button variant="minimal" size="small" icon="chevron-left" aria-label="1시간 전" title="1시간 전" disabled={t <= START} onClick={() => step(-60)} />
              <Button intent="primary" size="small" icon={playing ? 'pause' : 'play'} aria-label={playing ? '멈춤' : '재생'} title={playing ? '멈춤' : '재생'} onClick={() => { if (!playing && t >= end) setT(START); setPlaying(!playing) }} />
              <Button variant="minimal" size="small" icon="chevron-right" aria-label="1시간 후" title="1시간 후" disabled={t >= end} onClick={() => step(60)} />
            </div>
            <div className="home-clock"><time className="num">{fmt(t).slice(6)}</time><span><span className="num">{fmt(t).slice(0, 5)}</span> ({['일', '월', '화', '수', '목', '금', '토'][(6 + Math.floor(t / 1440)) % 7]})</span></div>
            <div className="home-time-slider">
              <div className="home-time-track">{bands.map((band) => <span key={band.key} className={`home-time-band ${band.kind}`} style={{ left: `${band.left}%`, width: `${band.width}%` }} />)}</div>
              <input type="range" min={START} max={end} step={10} value={t} aria-label="시각" aria-valuetext={fmt(t)} onChange={(event) => { setPlaying(false); setT(Number(event.target.value)) }} />
              <div className="home-time-ticks">{dayTicks.map((minute) => <span key={minute} className="num" style={{ left: `${pct(minute)}%` }}>{fmt(minute).slice(0, 5)}</span>)}</div>
            </div>
            <div className="home-band-key"><span><i className="night" />야간</span><span><i className="weather" />접안 금지</span></div>
          </div>
        </Panel>

        <aside className="home-sidebar">
          <Panel code="CAND-COST" title="안별 예상 체선료" className="home-plan-panel" data-tour="plan-table" actions={<span className="mono tiny muted">USD</span>}>
            <table className="dt home-plan-table" aria-label="안별 예상 체선료">
              <thead><tr><th>선택안</th><th className="r">총 예상</th><th className="r">기준안 대비</th><th className="r">현재 누적</th><th className="c">변경</th><th className="c">리스크</th></tr></thead>
              <tbody>{plans.map((candidate) => <tr key={candidate.id} className={`click ${candidate.id === plan.id ? 'on' : ''}`} onClick={() => choose(candidate.id)}>
                <td><label className="home-plan-choice"><input type="radio" name="home-plan" aria-label={planLabel(candidate)} checked={candidate.id === plan.id} onChange={() => choose(candidate.id)} /><span>{candidate.id === 'FCFS' ? <><span>도착순</span><small>기준안</small></> : candidate.label}</span></label></td>
                <td className="r num strong">{money(candidate.total)}</td>
                <td className={`r ${candidate.total < fcfs.total ? 'c-green' : ''}`}>{candidate.id === 'FCFS' ? <span className="muted">—</span> : <><span className="num">{money(candidate.total - fcfs.total)}</span><small className="num home-plan-delta">{percentChange(candidate.total, fcfs.total)}</small></>}</td>
                <td className={`r num ${accrued[candidate.id] > 0 ? 'c-red' : 'muted'}`}>{money(accrued[candidate.id])}</td>
                <td className="c num">{candidate.changed.length}</td>
                <td className="c"><span className="home-plan-risk"><span className="num c-amber">{risksByPlan[candidate.id].filter((risk) => risk.state === '해당').length}</span><span className="tiny muted">해당</span></span></td>
              </tr>)}</tbody>
            </table>
            <div className="home-plan-foot"><span>행 선택 시 지도·선박 현황 전환</span><span><time className="num">{fmt(t)}</time> 누적</span></div>
          </Panel>

          <Panel code="BERTH-OPS" title="선석 작업현황" className="home-berth-panel" actions={<span className="home-berth-key"><St tone="ok">정상</St><St tone="bad">체선 예상</St></span>}>
            <BerthBoard plan={plan} scen={scen} t={t} onOpen={openCard} />
          </Panel>

          <Panel code="EVENTS" title="알림" className="home-note-panel" bodyClass="home-note-body" actions={<time className="num tiny muted">{fmt(t)}</time>}>
            <ul className="home-notes">{notes.map((note) => <li key={note.key}>
              <button type="button" disabled={!note.vid && !note.go} onClick={() => note.vid ? openCard(note.vid) : note.go && go(note.go)}>
                <span className={`home-note-tag ${note.tone ? `c-${note.tone}` : ''}`}>{note.tag}</span><span className="home-note-text" title={note.text}>{note.text}</span><span className="home-note-at">{note.at}</span>
              </button>
            </li>)}</ul>
            <nav className="home-shortcuts" aria-label="운영 바로가기">{SHORTCUTS.map((shortcut) => <button type="button" key={shortcut.id} onClick={() => go(shortcut.id)} title={shortcut.label}><Icon icon={shortcut.icon} size={13} /><span>{shortcut.label}</span></button>)}</nav>
          </Panel>
        </aside>
      </div>

      <Panel code="VESSEL-STATE" title="선박 현황" desc={`${planLabel(plan)} · ${fmt(t)} 기준 · 행 선택 시 지도 이동`} className="home-vessel-panel" data-tour="vessel-list" actions={<span className="small muted">전체 조회 <b className="num">{states.length}</b>건</span>}>
        <table className="dt home-vessel-table" aria-label="선박 현황">
          <thead><tr><th>선박명</th><th>화물</th><th>상태</th><th>위치·예정</th><th>도착(NOR)</th><th>접안(ETB)</th><th>작업 종료</th><th className="r">누적 체선료(USD)</th><th className="c">산출 근거</th></tr></thead>
          <tbody>{states.map((state) => <tr key={state.v.id} className={`click home-vessel-${state.phase} ${selected === state.v.id ? 'on' : ''}`} onClick={() => pick(state)}>
            <td className="strong"><button type="button" className="home-vessel-name" onClick={(event) => { event.stopPropagation(); pick(state) }}>{state.v.name}</button></td>
            <td>{state.v.product} <span className="muted">{state.v.dir}</span></td>
            <td><St tone={state.ticking ? 'bad' : PHASE[state.phase].tone}>{state.ticking ? '체선 발생' : PHASE[state.phase].text}</St></td>
            <td className="home-vessel-location" title={stateText(state)}>{stateText(state)}</td>
            <td className="num">{fmt(state.v.eta)}</td><td className="num">{fmt(state.p.etb)}</td><td className="num">{fmt(state.p.etu)}</td>
            <td className={`r num ${state.ticking ? 'c-red' : ''}`}>{state.cents > 0 ? money(state.cents) : '0'}</td>
            <td className="c"><Button variant="minimal" size="small" endIcon="panel-stats" onClick={(event) => { event.stopPropagation(); openCard(state.v.id) }}>선박 카드</Button></td>
          </tr>)}</tbody>
        </table>
      </Panel>
    </div>
  )
}
