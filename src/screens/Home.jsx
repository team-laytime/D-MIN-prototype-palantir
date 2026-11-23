import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon } from '@blueprintjs/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useApp } from '../state/app.jsx'
import { Panel, St } from '../ui/kit.jsx'
import { stateAt } from '../lib/engine.js'
import { MAP_CONTEXT } from '../lib/scenarios.js'
import { NAV, anchorageFor, positionOf } from '../lib/vesselState.js'
import { NOW, fmt, fmtDur } from '../lib/time.js'
import SchedulePanel from './SchedulePanel.jsx'
import './home.css'

// 11-20 피드백: 현재 시각을 시간축 맨 왼쪽에 두고, 72시간 안의 ETA로 세운 계획을 120시간까지 돌려 본다.
const START = NOW
const END = NOW + 120 * 60
const PLAN_END = NOW + 72 * 60
const MAP_BOUNDS = [[35.398, 129.359], [35.509, 129.484]]
const PHASE = {
  coming: { text: '입항 예정', tone: 'idle' },
  waiting: { text: '정박지 대기', tone: 'warn' },
  berthed: { text: '작업 중', tone: 'live' },
  left: { text: '출항', tone: 'idle' },
}
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
  const { all: plans, result, scen, current, version, openVessel, go } = useApp()
  // 운영 현황은 운영만 보여 준다: 확정안이 있으면 확정안, 없으면 최저 후보를 '확정 전 예상'으로.
  const fixed = current && current.version === version
  const plan = (fixed && plans.find((p) => p.id === current.candId)) || result.candidates[0] || result.fcfs
  const [t, setT] = useState(NOW)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState(null)
  const [berthSel, setBerthSelRaw] = useState(null)
  // 11-23 사이드 픽(OFFLIGHT 방식): 기본은 전체 지도. 머리의 패널 버튼(또는 ] 키)으로 오른쪽 패널이 지도를 밀어내며 열리고,
  // 지도에서 부두를 누르면 패널이 그 부두 탭으로 열린다.
  const [sideOpen, setSideOpen] = useState(false)
  const [sideTab, setSideTab] = useState('all')
  const setBerthSel = (id) => { setBerthSelRaw(id); if (id) { setSideTab(id); setSideOpen(true) } }
  useEffect(() => {
    const onKey = (e) => { if (e.key === ']' && !e.metaKey && !e.ctrlKey && !/input|textarea|select/i.test(e.target.tagName)) setSideOpen((o) => !o) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markerLayer = useRef(null)
  const routeLayer = useRef(null)
  const markers = useRef(new Map())
  const end = END
  const states = useMemo(() => stateAt(plan, scen, t).sort((a, b) => a.v.eta - b.v.eta), [plan, scen, t])
  const weather = scen.env.weather
  const weatherNow = !!weather && t >= weather.start && t < weather.end
  const isNight = !scen.env.days.some((day) => t >= day.sunrise && t < day.sunset)
  const coming = states.filter((state) => state.phase === 'coming')
  const count = (phase) => states.filter((s) => s.phase === phase).length
  const maintOf = (berth) => berth.facility.maintenance && t >= berth.facility.maintenance.start && t < berth.facility.maintenance.end ? berth.facility.maintenance : null
  const berthStatus = (berth) => {
    const occupant = states.find((s) => s.phase === 'berthed' && s.p.bid === berth.id)
    const legacy = berth.occupiedUntil !== null && t < berth.occupiedUntil
    if (weatherNow) return { key: 'blocked', text: '접안 금지 (기상)', occupant }
    if (maintOf(berth)) return { key: 'maint', text: '설비 점검', occupant }
    if (occupant || legacy) return { key: 'busy', text: '작업 중', occupant }
    return { key: 'idle', text: '비어 있음', occupant }
  }
  const occupied = scen.berths.filter((b) => berthStatus(b).key === 'busy').length
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
  const hourTicks = [0, 24, 48, 72, 96, 120].map((h) => ({ h, at: START + h * 60, text: h === 0 ? '지금' : `+${h}h` }))
  const notes = [
    ...(weather ? [{ key: 'weather', tag: '기상', tone: weatherNow ? 'red' : 'amber', text: `${weather.label} · ${fmt(weather.start)}~${fmt(weather.end).slice(6)} 접안 금지`, at: weatherNow ? '발효 중' : '예보' }] : []),
    ...scen.incidents.map((inc) => ({ key: inc.id, tag: inc.kind, tone: 'amber', text: inc.title, at: fmt(inc.at).slice(6), go: 'inbox' })),
    { key: 'fixed', tag: '계획', tone: fixed ? 'accent' : '', text: fixed ? `접안 계획 ${current.status} · ${current.label}` : '접안 계획 확정 전 · 지도는 최저 후보 기준 예상', at: fixed ? '적용 중' : '대기', go: 'compare' },
  ]
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
    routeLayer.current = L.layerGroup().addTo(map)
    markerLayer.current = L.layerGroup().addTo(map)
    const resize = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    resize.observe(mapElement.current)
    return () => {
      resize.disconnect()
      markers.current.clear()
      markerLayer.current = null
      routeLayer.current = null
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
      const legacy = berth.occupiedUntil !== null && t < berth.occupiedUntil
      const st = berthStatus(berth)
      const tooltip = `<b>${escapeHtml(berth.name)}</b> · ${escapeHtml(st.text)}<br>${st.occupant ? `${escapeHtml(st.occupant.v.name)} 작업 ${Math.round(st.occupant.progress * 100)}%` : legacy ? `${escapeHtml(berth.occupiedBy)} 작업` : '접안선 없음'}<br>눌러서 부두 상세 보기`
      update(`berth-${berth.id}`, berth.pos, L.divIcon({
        className: 'home-map-label-wrap',
        html: `<span class="home-map-berth st-${st.key}${berthSel === berth.id ? ' sel' : ''}">${escapeHtml(berth.code)}</span>`,
        iconSize: [0, 0],
      }), berth.name, tooltip, () => setBerthSel(berth.id), 500)
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
        name: state.v.name, phase: state.phase, cog: NAV[state.phase].cog, selected: isSelected, ticking: false,
      }), `${state.v.name} 선박 카드`, `<b>${escapeHtml(state.v.name)}</b> · ${escapeHtml(state.v.type)}<br>${escapeHtml(state.v.flag)} · DWT ${state.v.dwt.toLocaleString()} · ${escapeHtml(state.v.product)} ${escapeHtml(state.v.dir)}<br>도착(ETA) ${fmt(state.v.eta)} · 접안(ETB) ${fmt(state.p.etb)}<br>눌러서 전체 제원 보기`, () => open(state.v.id), isSelected ? 1200 : 800)
    }
    for (const [key, marker] of markers.current) {
      if (!wanted.has(key)) { markerLayer.current.removeLayer(marker); markers.current.delete(key) }
    }
    // 예상 경로: 정박지 대기·입항 예정 선박이 배정된 부두로 가는 길(점선).
    routeLayer.current.clearLayers()
    // 11-23 3차 피드백: 경로는 확정된 스케줄이 있을 때만, 그 스케줄대로 어디로 언제 가는지 보인다.
    if (!fixed) return
    const spots = {}
    const labelRow = {}
    for (const state of states) {
      if (state.phase !== 'waiting' && state.phase !== 'coming') continue
      let spot = 0
      if (state.phase === 'waiting') { const a = anchorageFor(state.v); spot = spots[a.id] = (spots[a.id] ?? -1) + 1 }
      const berth = scen.berths.find((b) => b.id === state.p.bid)
      const from = positionOf(state, scen, spot)
      L.polyline([from, [35.452, 129.418], berth.moor], { color: state.phase === 'waiting' ? '#c98a1f' : '#0b7489', weight: 2, dashArray: '6 5', opacity: selected && selected !== state.v.id ? 0.25 : 0.95, interactive: false }).addTo(routeLayer.current)
      // 같은 정박지에서 출발하는 선박이 많아 이름표는 정박지 옆에 한 줄씩 쌓는다.
      const k = (labelRow[state.phase] = (labelRow[state.phase] ?? -1) + 1)
      L.marker(state.phase === 'waiting' ? [35.4185, 129.428] : [35.3985, 129.428], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'home-map-label-wrap', html: `<span class="home-route-label" style="top:${k * 20}px">${state.phase === 'waiting' ? '대기' : '입항'} ${escapeHtml(state.v.name)} → ${escapeHtml(berth.code)} <b>${fmt(state.p.etb)}</b> 접안</span>`, iconSize: [0, 0] }) }).addTo(routeLayer.current)
    }
  }, [plan, scen, states, selected, t, openVessel, berthSel, fixed]) // eslint-disable-line react-hooks/exhaustive-deps

  // 사이드 패널을 여닫으면 지도 폭이 바뀌므로 다시 맞춘다(경로 이름표가 잘리지 않게).
  useEffect(() => {
    const id = window.setTimeout(() => { mapRef.current?.invalidateSize({ pan: false }); mapRef.current?.fitBounds(MAP_BOUNDS, { padding: [24, 24] }) }, 320)
    return () => window.clearTimeout(id)
  }, [sideOpen])

  const openCard = (vid) => { setSelected(vid); openVessel(plan.id, vid, { at: t }) }
  const step = (minutes) => { setPlaying(false); setT((now) => Math.max(START, Math.min(end, now + minutes))) }
  const pick = (state) => {
    setSelected(state.v.id)
    if (state.phase === 'berthed') { setBerthSel(state.p.bid); mapRef.current?.flyTo(positionOf(state, scen), 15, { duration: 0.6 }) }
    if (state.phase === 'waiting') mapRef.current?.flyTo(anchorageFor(state.v).center, 14, { duration: 0.6 })
  }
  const stateText = (state) => {
    const berth = scen.berths.find((b) => b.id === state.p.bid)
    if (state.phase === 'coming') return `${fmt(state.v.eta)} 도착 예정`
    if (state.phase === 'waiting') return `${anchorageFor(state.v).label} ${fmtDur(t - state.v.eta)} · ${berth.name} ${fmt(state.p.etb).slice(6)} 접안 예정`
    if (state.phase === 'berthed') return `${berth.name} · 진행 ${Math.round(state.progress * 100)}%`
    return `${fmt(state.p.etu)} 작업 종료`
  }

  const vName = (vid) => scen.vessels.find((v) => v.id === vid).name

  return (
    <div className="home-console">
      <div className={`home-main v4 ${sideOpen ? 'side-open' : ''}`}>
        <Panel code="PORT-COP" title="접안 현황" desc={`울산항 · ${fixed ? `${current.status} 일정` : `확정 전 · ${plan.label} 기준 예상`}`} className="home-map-panel" bodyClass="home-map-body" actions={<><Button variant="minimal" size="small" icon="zoom-to-fit" aria-label="지도 전체 보기" title="지도 전체 보기" onClick={() => mapRef.current?.fitBounds(MAP_BOUNDS, { padding: [24, 24] })} /><Button className={`home-side-toggle ${sideOpen ? 'on' : ''}`} variant={sideOpen ? 'outlined' : 'minimal'} size="small" icon={sideOpen ? 'drawer-right-filled' : 'drawer-right'} text="스케줄 현황" title="스케줄 현황 패널 ( ] )" aria-expanded={sideOpen} onClick={() => setSideOpen(!sideOpen)} /></>}>
          <div className="home-map-stage">
            <div ref={mapElement} className="home-map" role="region" aria-label="울산항 선박 위치 지도" />
            <div className="home-map-context">{weather && <span className={`home-wx-chip ${weatherNow ? 'on' : ''}`}><Icon icon="warning-sign" size={12} />{weather.label} · <span className="num">{fmt(weather.start)}~{fmt(weather.end).slice(6)}</span> 접안 금지{weatherNow ? ' · 발효 중' : ''}</span>}<span className="home-plan-chip">{fixed ? `${current.status} 스케줄대로 이동 중 · 점선 = 예정 경로` : '확정된 스케줄 없음 · 경로는 확정 뒤 표시'}</span>{isNight && <span className="home-night"><Icon icon="moon" size={12} />야간 · 6만 DWT 이상 접안 불가</span>}</div>
            {coming.length > 0 && <div className="home-coming">
              <header>입항 예정 <span>항해 중 · 제원 보기</span></header>
              {coming.map(({ v }) => <button type="button" key={v.id} onClick={() => openCard(v.id)}>
                <strong>{v.name}</strong><span className="num">ETA {fmt(v.eta)}</span>
                <small>{fmtDur(v.eta - t)} 후 · 약 <span className="num">{Math.round((v.eta - t) / 60 * NAV.coming.sog)}nm</span> · {v.prevPort.split(',')[0]}발</small>
              </button>)}
            </div>}
          </div>
          <div className="home-map-legend">
            <span className="home-legend-berth"><span className="home-map-berth st-busy">SK</span>작업 중</span>
            <span className="home-legend-berth"><span className="home-map-berth st-idle">SK</span>비어 있음</span>
            <span className="home-legend-berth"><span className="home-map-berth st-maint">SK</span>설비 점검</span>
            <span className="home-legend-berth"><span className="home-map-berth st-blocked">SK</span>접안 금지</span>
            <span className="home-legend-route"><i />예상 경로</span>
            <St tone="live">부두 계류</St><St tone="warn">정박지 대기</St>
          </div>
          <div className="home-time-dock" data-tour="time-dock">
            <div className="home-time-controls">
              <Button variant="minimal" size="small" icon="step-backward" aria-label="지금으로" title="지금으로" onClick={() => { setPlaying(false); setT(START) }} />
              <Button variant="minimal" size="small" icon="chevron-left" aria-label="1시간 전" title="1시간 전" disabled={t <= START} onClick={() => step(-60)} />
              <Button intent="primary" size="small" icon={playing ? 'pause' : 'play'} aria-label={playing ? '멈춤' : '재생'} title={playing ? '멈춤' : '재생'} onClick={() => { if (!playing && t >= end) setT(START); setPlaying(!playing) }} />
              <Button variant="minimal" size="small" icon="chevron-right" aria-label="1시간 후" title="1시간 후" disabled={t >= end} onClick={() => step(60)} />
            </div>
            <div className="home-clock"><time className="num">{t === NOW ? '지금' : `+${Math.round((t - NOW) / 60)}h`}</time><span><span className="num">{fmt(t)}</span> ({['일', '월', '화', '수', '목', '금', '토'][(6 + Math.floor(t / 1440)) % 7]})</span></div>
            <div className="home-time-slider">
              <div className="home-time-track">{bands.map((band) => <span key={band.key} className={`home-time-band ${band.kind}`} style={{ left: `${band.left}%`, width: `${band.width}%` }} />)}<span className="home-time-plan" style={{ left: `${pct(PLAN_END)}%` }} /></div>
              <input type="range" min={START} max={end} step={10} value={t} aria-label="시각" aria-valuetext={fmt(t)} onChange={(event) => { setPlaying(false); setT(Number(event.target.value)) }} />
              <div className="home-time-ticks">{hourTicks.map((tick) => <span key={tick.h} className="num" style={{ left: `${pct(tick.at)}%` }}>{tick.text}</span>)}</div>
            </div>
            <div className="home-band-key"><span><i className="night" />야간</span><span><i className="weather" />접안 금지</span><span><i className="plan" />72h 계획 범위</span></div>
          </div>
        </Panel>

        <SchedulePanel open={sideOpen} tab={sideTab} setTab={setSideTab} onClose={() => setSideOpen(false)} fixed={fixed} current={current} plan={plan} scen={scen} states={states} t={t}
          berthStatus={berthStatus} onOpenVessel={openCard} onPickBerth={(id) => { setBerthSelRaw(id); setSideTab(id) }} go={go} />
      </div>

    </div>
  )
}
