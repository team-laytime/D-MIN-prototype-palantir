import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon } from '@blueprintjs/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useInbox } from '../state/useInbox.js'
import { useApp } from '../state/app.jsx'
import { Panel, St } from '../ui/kit.jsx'
import { berthStatus as berthStatusOf, isNight as isNightAt, spanOf, stateAt } from '../lib/plan.js'
import { MAP_CONTEXT, NAV, anchorageFor, positionOf } from '../lib/vesselState.js'
import { NOW, dayStart, fmt, fmtDur, fmtFull } from '../lib/time.js'
import SchedulePanel from './SchedulePanel.jsx'
import './home.css'

// 11-24 실데이터: 시간축은 지금(NOW = 데이터셋 기준 시각 T)부터 계획 기간 끝(후보 전체의 마지막 이안)까지.
const MAP_BOUNDS = [[35.398, 129.359], [35.509, 129.484]]
// 이 배율보다 멀리 보면 부두(묶음) 표식만, 가까이 보면 선석 표식을 하나씩 보인다(24개 선석이 겹치지 않게).
const BERTH_ZOOM = 14.5
// 지도 칩: 앞으로 24시간 안에 풍속이 이 값 이상이면 강풍 칩을 띄운다(기준 값, 팀 확인 전).
const WIND_ALERT_MS = 14
const ARRIVALS_SHOWN = 6
const ROUTE_LABELS = 6
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const weekdayOf = (min) => WEEK[new Date(`${fmtFull(min).replace(' ', 'T')}:00Z`).getUTCDay()]

function shipIcon({ name, phase, cog, selected, ticking, extra = '' }) {
  return L.divIcon({
    className: 'home-map-vessel-wrap',
    html: `<div class="home-map-vessel ${phase}${selected ? ' selected' : ''}${ticking ? ' ticking' : ''}"><svg width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true">${ticking ? '<circle class="home-dem-ring" r="11" fill="none" stroke-dasharray="3 2"/>' : ''}<g transform="rotate(${cog})"><path d="M0 -9 L4.5 -3 L4.5 8 L-4.5 8 L-4.5 -3 Z"/><rect x="-2.5" y="2" width="5" height="3"/></g></svg><span class="home-map-vessel-label">${escapeHtml(name)}${extra ? ` <em>${escapeHtml(extra)}</em>` : ''}</span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

/** 정박지 대기 선박 자리: 자리 6개를 돌아가며 쓰고, 한 바퀴 돌 때마다 조금씩 비켜 놓는다(여러 척이 한 자리를 나눠 씀). */
function anchorPos(state, scen, k) {
  const a = anchorageFor(state.v)
  const [lat, lng] = positionOf(state, scen, k)
  const round = Math.floor(k / a.spots.length)
  return [lat - round * 0.0016, lng + round * 0.0022]
}

export default function Home() {
  const { scen, all, result } = useApp()
  if (!scen || !all.length) {
    return (
      <div className="home-console">
        <div className="home-loading small muted">{result.loading ? '데이터셋을 불러오는 중입니다' : result.error ?? '엔진 후보가 아직 없습니다'}</div>
      </div>
    )
  }
  return <HomeMap />
}

function HomeMap() {
  const { all: plans, result, scen, current, version, openVessel, go, setMailFilter, isScheduler } = useApp()
  // 11-24 고도화: 반영 여부를 정하지 않은 돌발 상황이 있을 때만 「입항 예정」 아래에 같은 모양의 창을 띄운다.
  const { incidents } = useInbox()
  // 운영 현황은 운영만 보여 준다: 확정안이 있으면 확정안, 없으면 최저 후보를 '확정 전 예상'으로.
  const fixed = current && current.version === version
  const plan = (fixed && plans.find((p) => p.id === current.candId)) || result.candidates[0]
  const span = useMemo(() => spanOf(fixed ? [plan] : plans), [fixed, plan, plans])
  const START = NOW
  const end = Math.max(START + 24 * 60, span.end)
  const [t, setT] = useState(NOW)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState(null)
  const [berthSel, setBerthSelRaw] = useState(null)
  const [zoom, setZoom] = useState(12)
  // 11-23 사이드 픽(OFFLIGHT 방식): 기본은 전체 지도. 머리의 패널 버튼(또는 ] 키)으로 오른쪽 패널이 지도를 밀어내며 열리고,
  // 지도에서 부두를 누르면 패널이 그 부두 탭으로 열린다. 탭은 부두(묶음) 단위다(선석 24개는 탭으로 너무 많음).
  const [sideOpen, setSideOpen] = useState(false)
  const [sideTab, setSideTab] = useState('all')
  const bById = useMemo(() => Object.fromEntries(scen.berths.map((b) => [b.id, b])), [scen])
  const setBerthSel = (id) => { setBerthSelRaw(id); if (id) { setSideTab(bById[id].pier); setSideOpen(true) } }
  const pickPier = (pier) => { setBerthSelRaw(null); setSideTab(pier); setSideOpen(true) }
  useEffect(() => {
    const onKey = (e) => { if (e.key === ']' && !e.metaKey && !e.ctrlKey && !/input|textarea|select/i.test(e.target.tagName)) setSideOpen((o) => !o) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { setT((now) => Math.min(now, end)) }, [end])
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markerLayer = useRef(null)
  const routeLayer = useRef(null)
  const markers = useRef(new Map())
  const states = useMemo(() => stateAt(plan, scen, t).sort((a, b) => a.v.eta - b.v.eta), [plan, scen, t])

  // 부두(묶음): 데이터셋의 선석 순서를 그대로 따른다.
  const piers = useMemo(() => {
    const out = new Map()
    for (const b of scen.berths) {
      if (!out.has(b.pier)) out.set(b.pier, { id: b.pier, name: b.pierName, berths: [] })
      out.get(b.pier).berths.push(b)
    }
    return [...out.values()].map((p) => ({ ...p, pos: [Math.max(...p.berths.map((b) => b.pos[0])) + 0.0013, p.berths[0].pos[1]] }))
  }, [scen])

  // 풍속: 지금 시각부터 24시간 안의 최댓값. 기준 이상일 때만 칩을 띄운다.
  const windAhead = useMemo(() => {
    const ahead = scen.wind.filter((w) => w.t >= t - 60 && w.t <= t + 24 * 60)
    if (!ahead.length) return null
    const top = ahead.reduce((a, b) => (b.ms > a.ms ? b : a))
    return top.ms >= WIND_ALERT_MS ? { ...top, now: ahead.some((w) => w.t <= t && t < w.t + 60 && w.ms >= WIND_ALERT_MS) } : null
  }, [scen.wind, t])
  const isNight = isNightAt(t)
  const coming = states.filter((state) => state.phase === 'coming')
  const berthStatus = (berth) => berthStatusOf(plan, scen, berth, t)
  const pct = (minute) => (minute - START) / (end - START) * 100
  const bands = useMemo(() => {
    const out = []
    const add = (key, kind, from, to) => {
      const left = Math.max(START, from)
      const right = Math.min(end, to)
      if (right > left) out.push({ key, kind, left: (left - START) / (end - START) * 100, width: (right - left) / (end - START) * 100 })
    }
    // 야간 20시~06시 (plan.js isNight와 같은 기준)
    for (let d = dayStart(START) - 1440; d < end; d += 1440) add(`night-${d}`, 'night', d + 20 * 60, d + 30 * 60)
    for (const w of scen.wind) if (w.ms >= WIND_ALERT_MS) add(`wind-${w.t}`, 'weather', w.t, w.t + 60)
    scen.blocks.forEach((b, i) => add(`block-${i}`, 'block', b.start, b.end))
    return out
  }, [START, end, scen.wind, scen.blocks])
  const dayTicks = useMemo(() => {
    const out = [{ key: 'now', at: START, text: '지금' }]
    for (let d = dayStart(START) + 1440; d < end; d += 1440) if (pct(d) > 6) out.push({ key: d, at: d, text: fmt(d).split(' ')[0] })
    return out
  }, [START, end]) // eslint-disable-line react-hooks/exhaustive-deps
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
    setZoom(map.getZoom())
    map.on('zoomend', () => setZoom(map.getZoom()))
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

  const near = zoom >= BERTH_ZOOM
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
      } else if (marker.getTooltip()) marker.unbindTooltip()
    }
    const open = (vid) => { setSelected(vid); openVessel(plan.id, vid, { at: t }) }
    // 부두(묶음) 표식: 멀리 볼 때. 작업 중 선석 수 / 전체 선석 수.
    for (const pier of piers) {
      const sts = pier.berths.map((b) => berthStatus(b))
      const busy = sts.filter((s) => s.key === 'busy').length
      const blocked = sts.some((s) => s.key === 'blocked')
      const key = blocked ? 'blocked' : busy ? 'busy' : 'idle'
      const sel = sideOpen && sideTab === pier.id
      if (near) {
        // 가까이 볼 때는 부두 이름만 작게
        update(`pier-${pier.id}`, pier.pos, L.divIcon({ className: 'home-map-label-wrap', html: `<span class="home-map-pier-name">${escapeHtml(pier.name)}</span>`, iconSize: [0, 0] }), pier.name, null, () => pickPier(pier.id), 400)
        continue
      }
      const tooltip = `<b>${escapeHtml(pier.name)}</b><br>선석 ${pier.berths.length}개, 작업 중 ${busy}${blocked ? ', 사용 불가 있음' : ''}<br>${pier.berths.map((b, i) => `${escapeHtml(b.code)} ${escapeHtml(sts[i].text)}`).join('<br>')}<br>눌러서 부두 스케줄 보기`
      update(`pier-${pier.id}`, pier.berths[0].pos, L.divIcon({
        className: 'home-map-label-wrap',
        html: `<span class="home-map-berth home-map-pier st-${key}${sel ? ' sel' : ''}">${escapeHtml(pier.id === 'BUOY' ? '부이' : pier.id === 'GAS' ? '가스' : `SK${pier.id}`)} <b class="num">${busy}/${pier.berths.length}</b></span>`,
        iconSize: [0, 0],
      }), pier.name, tooltip, () => pickPier(pier.id), 500)
    }
    // 선석 표식: 가까이 볼 때만
    if (near) {
      for (const berth of scen.berths) {
        const st = berthStatus(berth)
        const tooltip = `<b>${escapeHtml(berth.name)}</b>, ${escapeHtml(st.text)}<br>${st.occupant ? `${escapeHtml(st.occupant.v?.name ?? st.occupant.p.vid)} 작업 ${Math.round(st.occupant.progress * 100)}%` : st.next ? `다음 접안 ${fmt(st.next.etb)}` : '접안 예정 없음'}<br>DWT ${berth.maxDwt?.toLocaleString() ?? '-'} 이하, 흘수 ${berth.maxDraft ?? '-'}m 이하${berth.approxPos ? '<br>위치는 근사값' : ''}<br>눌러서 부두 상세 보기`
        update(`berth-${berth.id}`, berth.pos, L.divIcon({
          className: 'home-map-label-wrap',
          html: `<span class="home-map-berth st-${st.key}${berthSel === berth.id ? ' sel' : ''}">${escapeHtml(berth.code)}</span>`,
          iconSize: [0, 0],
        }), berth.name, tooltip, () => setBerthSel(berth.id), 500)
      }
    }
    const anchorUse = {}
    const placeOf = {}
    for (const state of states) {
      if (state.phase === 'coming' || state.phase === 'left') continue
      let pos
      if (state.phase === 'waiting') {
        const anchorage = anchorageFor(state.v)
        const k = anchorUse[anchorage.id] = (anchorUse[anchorage.id] ?? -1) + 1
        pos = anchorPos(state, scen, k)
      } else pos = bById[state.p.bid].moor
      placeOf[state.v.id] = pos
      const isSelected = selected === state.v.id
      const v = state.v
      update(`vessel-${v.id}`, pos, shipIcon({
        name: v.name, phase: state.phase, cog: NAV[state.phase].cog, selected: isSelected, ticking: false,
      }), `${v.name} 선박 카드`, `<b>${escapeHtml(v.name)}</b>, ${escapeHtml(v.cls ?? '')}<br>DWT ${v.dwt?.toLocaleString() ?? '-'}, ${escapeHtml(v.product)} ${escapeHtml(v.dir)} ${v.ton?.toLocaleString() ?? '-'}t<br>도착(ETA) ${fmt(v.eta)}, 접안(ETB) ${fmt(state.p.etb)} ${escapeHtml(bById[state.p.bid]?.code ?? state.p.bid)}<br>눌러서 선박 카드 보기`, () => open(v.id), isSelected ? 1200 : 800)
    }
    for (const [key, marker] of markers.current) {
      if (!wanted.has(key)) { markerLayer.current.removeLayer(marker); markers.current.delete(key) }
    }
    // 이동 가이드선 (11-24 화면 리뷰 결정): 스케줄된 배 전부가 아니라 「선택한 배」의 예상 이동 경로만 그린다.
    //   배를 누르면 선박 카드(제원 등)는 그대로 열리고, 그 배가 배정된 선석으로 가는 길만 지도에 나타난다.
    //   확정 전에는 최저 후보 기준 「예상」 경로(옅은 점선), 확정 뒤에는 그 스케줄 경로를 진하게.
    //   색 지도 위에서도 보이게 흰 테두리를 깔고, 구간마다 진행 방향 화살표를 둔다.
    //   이름표는 접안이 빠른 순서로 몇 척만 쌓고 나머지는 「외 N척」으로 줄인다.
    routeLayer.current.clearLayers()
    const CHANNEL = [35.452, 129.418] // 항로 안쪽 분기점
    const FAIRWAY = [35.424, 129.446] // 항로 입구 쪽 중간점
    const arrow = (a, b, color, opacity) => {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const deg = (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI
      L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'home-route-arrow-wrap', html: `<span class="home-route-arrow" style="transform:translate(-50%,-50%) rotate(${deg}deg);color:${color};opacity:${opacity}">▲</span>`, iconSize: [0, 0] }) }).addTo(routeLayer.current)
    }
    const routed = states.filter((s) => s.v.id === selected && (s.phase === 'waiting' || s.phase === 'coming'))
    const labelRow = {}
    const hidden = { waiting: 0, coming: 0 }
    for (const state of routed) {
      const berth = bById[state.p.bid]
      if (!berth) continue
      const from = placeOf[state.v.id] ?? positionOf(state, scen, 0)
      const path = state.phase === 'coming' ? [from, FAIRWAY, CHANNEL, berth.moor] : [from, CHANNEL, berth.moor]
      const color = state.phase === 'waiting' ? '#c98a1f' : '#0b7489'
      const dim = false
      const op = dim ? 0.25 : fixed ? 0.95 : 0.75
      L.polyline(path, { color: '#ffffff', weight: fixed ? 6 : 5, opacity: dim ? 0.2 : 0.85, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer.current)
      L.polyline(path, { color, weight: fixed ? 3 : 2.5, dashArray: fixed ? '8 5' : '3 6', opacity: op, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer.current)
      for (let i = 0; i < path.length - 1; i++) arrow(path[i], path[i + 1], color, op)
      // 같은 정박지에서 출발하는 선박이 많아 이름표는 정박지 옆에 한 줄씩 쌓는다.
      const k = (labelRow[state.phase] ?? 0)
      if (k >= ROUTE_LABELS && state.v.id !== selected) { hidden[state.phase]++; continue }
      labelRow[state.phase] = k + 1
      L.marker(state.phase === 'waiting' ? [35.4185, 129.428] : [35.3985, 129.428], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'home-map-label-wrap', html: `<span class="home-route-label ${fixed ? '' : 'plan'} ${state.phase}" style="top:${k * 20}px">${fixed ? '' : '예상 '}${state.phase === 'waiting' ? '대기' : '입항'} ${escapeHtml(state.v.name)} → ${escapeHtml(berth.code)} <b>${fmt(state.p.etb)}</b> 접안</span>`, iconSize: [0, 0] }) }).addTo(routeLayer.current)
    }
    for (const phase of ['waiting', 'coming']) {
      if (!hidden[phase]) continue
      const k = labelRow[phase] ?? 0
      L.marker(phase === 'waiting' ? [35.4185, 129.428] : [35.3985, 129.428], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'home-map-label-wrap', html: `<span class="home-route-label ${fixed ? '' : 'plan'} ${phase}" style="top:${k * 20}px">외 ${hidden[phase]}척</span>`, iconSize: [0, 0] }) }).addTo(routeLayer.current)
    }
  }, [plan, scen, states, selected, t, openVessel, berthSel, fixed, near, piers, sideOpen, sideTab, bById]) // eslint-disable-line react-hooks/exhaustive-deps

  // 확대 정도에 따라 선박 이름표를 숨긴다(멀리 볼 때 수십 개 이름표가 겹치지 않게, 선택한 선박은 그대로).
  useEffect(() => { mapElement.current?.classList.toggle('zoom-far', zoom < 13.5) }, [zoom])

  // 사이드 패널을 여닫으면 지도 폭이 바뀌므로 다시 맞춘다(경로 이름표가 잘리지 않게).
  useEffect(() => {
    const id = window.setTimeout(() => { mapRef.current?.invalidateSize({ pan: false }); mapRef.current?.fitBounds(MAP_BOUNDS, { padding: [24, 24] }) }, 320)
    return () => window.clearTimeout(id)
  }, [sideOpen])

  const openCard = (vid) => { setSelected(vid); openVessel(plan.id, vid, { at: t }) }
  const step = (minutes) => { setPlaying(false); setT((now) => Math.max(START, Math.min(end, now + minutes))) }
  const nextArrivals = coming.slice(0, ARRIVALS_SHOWN)

  return (
    <div className="home-console">
      <div className={`home-main v4 ${sideOpen ? 'side-open' : ''}`}>
        <Panel code="PORT-COP" title="접안 현황" desc={`울산항 SK 부두, 선석 ${scen.berths.length}개, 선박 ${plan.placements.length}척, ${fixed ? `${current.status} 일정` : `확정 전, ${plan.label} 기준 예상`}`} className="home-map-panel" bodyClass="home-map-body" actions={<><Button variant="minimal" size="small" icon="zoom-to-fit" aria-label="지도 전체 보기" title="지도 전체 보기" onClick={() => mapRef.current?.fitBounds(MAP_BOUNDS, { padding: [24, 24] })} /><Button className={`home-side-toggle ${sideOpen ? 'on' : ''}`} variant={sideOpen ? 'outlined' : 'minimal'} size="small" icon={sideOpen ? 'drawer-right-filled' : 'drawer-right'} text="스케줄 현황" title="스케줄 현황 패널 ( ] )" aria-expanded={sideOpen} onClick={() => setSideOpen(!sideOpen)} /></>}>
          <div className="home-map-stage">
            <div ref={mapElement} className="home-map" role="region" aria-label="울산항 선박 위치 지도" />
            <div className="home-map-context">
              {windAhead && <span className={`home-wx-chip ${windAhead.now ? 'on' : ''}`}><Icon icon="warning-sign" size={12} />강풍 {windAhead.now ? '관측' : '예보'}, 최대 <span className="num">{windAhead.ms}m/s</span> (<span className="num">{fmt(windAhead.t)}</span>)</span>}
              <span className="home-plan-chip">{fixed ? `${current.status} 스케줄대로 이동 중, 점선 = 예정 경로` : `확정 전, 옅은 점선 = ${plan.label} 기준 예상 경로`}</span>
              {isNight && <span className="home-night"><Icon icon="moon" size={12} />야간 시간대 (20시~06시)</span>}
              {!near && <span className="home-night"><Icon icon="zoom-in" size={12} />확대하면 선석별로 보입니다</span>}
            </div>
            <div className="home-float">
            {coming.length > 0 && <div className="home-coming">
              <header>입항 예정 <span>ETA 순, 눌러서 선박 카드</span></header>
              {nextArrivals.map(({ v, p }) => <button type="button" key={v.id} onClick={() => openCard(v.id)}>
                <strong>{v.name}</strong><span className="num">ETA {fmt(v.eta)}</span>
                <small>{fmtDur(v.eta - t)} 후, {v.product} {v.dir}, {bById[p.bid]?.code ?? p.bid} 접안 <span className="num">{fmt(p.etb)}</span></small>
              </button>)}
              {coming.length > ARRIVALS_SHOWN && <div className="home-coming-more small muted">외 <span className="num">{coming.length - ARRIVALS_SHOWN}</span>척 (스케줄 현황 패널에서 전체 보기)</div>}
            </div>}
            {isScheduler && incidents.length > 0 && <div className="home-coming home-incidents" role="region" aria-label="돌발 상황">
              <header><span className="home-inc-title"><Icon icon="warning-sign" size={11} />돌발 상황 <b className="num">{incidents.length}</b></span><span>반영 전, 메일에서 정하기</span></header>
              {incidents.map((a) => <button type="button" key={a.id} onClick={() => { setMailFilter('incident'); go('inbox') }}>
                <strong>{a.title.match(/^\[(.+?)\]/)?.[1] ?? '돌발 상황'}</strong><span className="num">{a.at}</span>
                <small>{a.title.replace(/^\[.+?\]\s*/, '')}</small>
                <small className="home-inc-from">{a.from}</small>
              </button>)}
            </div>}
            </div>
          </div>
          <div className="home-map-legend">
            <span className="home-legend-berth"><span className="home-map-berth st-busy">SK</span>작업 중</span>
            <span className="home-legend-berth"><span className="home-map-berth st-idle">SK</span>비어 있음</span>
            <span className="home-legend-berth"><span className="home-map-berth st-blocked">SK</span>사용 불가</span>
            <span className="home-legend-berth"><span className="home-map-berth home-map-pier st-busy">SK2 <b>3/6</b></span>부두: 작업 중 선석/전체</span>
            <span className="home-legend-route"><i />이동 경로: 선택한 배만 (▲ 가는 방향)</span>
            <St tone="live">부두 계류</St><St tone="warn">정박지 대기</St>
          </div>
          <div className="home-time-dock" data-tour="time-dock">
            <div className="home-time-controls">
              <Button variant="minimal" size="small" icon="step-backward" aria-label="지금으로" title="지금으로" onClick={() => { setPlaying(false); setT(START) }} />
              <Button variant="minimal" size="small" icon="chevron-left" aria-label="1시간 전" title="1시간 전" disabled={t <= START} onClick={() => step(-60)} />
              <Button intent="primary" size="small" icon={playing ? 'pause' : 'play'} aria-label={playing ? '멈춤' : '재생'} title={playing ? '멈춤' : '재생'} onClick={() => { if (!playing && t >= end) setT(START); setPlaying(!playing) }} />
              <Button variant="minimal" size="small" icon="chevron-right" aria-label="1시간 후" title="1시간 후" disabled={t >= end} onClick={() => step(60)} />
            </div>
            <div className="home-clock"><time className="num">{t === NOW ? '지금' : `+${Math.round((t - NOW) / 60)}h`}</time><span><span className="num">{fmt(t)}</span> ({weekdayOf(t)})</span></div>
            <div className="home-time-slider">
              <div className="home-time-track">{bands.map((band) => <span key={band.key} className={`home-time-band ${band.kind}`} style={{ left: `${band.left}%`, width: `${band.width}%` }} />)}</div>
              <input type="range" min={START} max={end} step={10} value={t} aria-label="시각" aria-valuetext={fmt(t)} onChange={(event) => { setPlaying(false); setT(Number(event.target.value)) }} />
              <div className="home-time-ticks">{dayTicks.map((tick) => <span key={tick.key} className="num" style={{ left: `${pct(tick.at)}%` }}>{tick.text}</span>)}</div>
            </div>
            <div className="home-band-key"><span><i className="night" />야간</span><span><i className="weather" />강풍 {WIND_ALERT_MS}m/s 이상</span>{scen.blocks.length > 0 && <span><i className="block" />사용 불가</span>}</div>
          </div>
        </Panel>

        <SchedulePanel open={sideOpen} tab={sideTab} setTab={setSideTab} onClose={() => setSideOpen(false)} fixed={fixed} current={current} plan={plan} scen={scen} states={states} t={t}
          berthSel={berthSel} berthStatus={berthStatus} onOpenVessel={openCard} onPickBerth={(id) => setBerthSelRaw(id)} onPickPier={pickPier} go={go} />
      </div>

    </div>
  )
}
