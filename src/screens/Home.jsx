import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon } from '@blueprintjs/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useInbox } from '../state/useInbox.js'
import { useApp } from '../state/app.jsx'
import { activePlan } from '../lib/workspace.js'
import { Panel, St } from '../ui/kit.jsx'
import { berthStatus as berthStatusOf, isNight as isNightAt, spanOf, stateAt } from '../lib/plan.js'
import { MAP_CONTEXT, anchorageFor } from '../lib/vesselState.js'
import { arriveRoute, seaRoute } from '../lib/seaRoutes.js'
import { STEP_MIN, poseAt } from '../lib/vesselMotion.js'
import { NOW, dayStart, fmt, fmtDur, fmtFull, money } from '../lib/time.js'
import { demCents } from './Timeline.jsx'
import PlanGantt from './PlanGantt.jsx'
import './home.css'

// 11-24 실데이터: 시간축은 지금(NOW = 데이터셋 기준 시각 T)부터 계획 기간 끝(후보 전체의 마지막 이안)까지.
const MAP_BOUNDS = [[35.398, 129.359], [35.509, 129.484]]
const MAP_FIT = { padding: [24, 24] }
// 11-25 지도 보기 프리셋 3개. 기본은 부두 근방.
const MAP_VIEWS = [
  { id: 'piers', label: '부두', bounds: [[35.4735, 129.356], [35.5055, 129.3995]] },
  { id: 'sea', label: '부이, 정박지', bounds: [[35.394, 129.412], [35.456, 129.477]] },
  { id: 'all', label: '전체', bounds: MAP_BOUNDS },
]
// 이 배율보다 멀리 보면 부두(묶음) 표식만, 가까이 보면 선석 표식을 하나씩 보인다(24개 선석이 겹치지 않게).
const BERTH_ZOOM = 14.5
// 지도 칩: 앞으로 24시간 안에 풍속이 이 값 이상이면 강풍 칩을 띄운다(기준 값, 팀 확인 전).
const WIND_ALERT_MS = 14
// 11-25 지도 말풍선: 제목 + 상태 칩 + 이름/값 줄 + 맨 아래 안내 한 줄
const tipHtml = ({ title, sub, chip, tone = 'idle', meter, big, rows = [], hint }) => `<div class="tip">
  <div class="tip-head"><b>${escapeHtml(title)}</b>${chip ? `<span class="tip-chip ${tone}">${escapeHtml(chip)}</span>` : ''}</div>
  ${sub ? `<div class="tip-sub">${escapeHtml(sub)}</div>` : ''}
  ${meter ? `<div class="tip-meter">${meter.map((m) => `<span class="${m}"></span>`).join('')}</div>` : ''}
  ${big ? `<div class="tip-big"><b>${escapeHtml(big.value)}</b><span>${escapeHtml(big.label)}</span></div>` : ''}
  ${rows.length ? `<dl class="tip-rows">${rows.map(([k, v, cls, pct]) => `<dt>${escapeHtml(k)}</dt><dd class="${cls ?? ''}">${escapeHtml(v)}</dd>${pct != null ? `<span class="tip-pct"><span class="tip-bar"><i style="width:${Math.round(pct * 100)}%"></i></span>${Math.round(pct * 100)}%</span>` : '<span></span>'}`).join('')}</dl>` : ''}
  ${hint ? `<div class="tip-hint">${escapeHtml(hint)}</div>` : ''}
</div>`
let measureCanvas = null
const measureCtx = () => (measureCanvas ??= document.createElement('canvas')).getContext('2d')
const WEEK = ['일', '월', '화', '수', '목', '금', '토']
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const weekdayOf = (min) => WEEK[new Date(`${fmtFull(min).replace(' ', 'T')}:00Z`).getUTCDay()]

function shipIcon({ name, phase, cog, selected, ticking, extra = '', next = 0 }) {
  return L.divIcon({
    className: 'home-map-vessel-wrap',
    html: `<div class="home-map-vessel ${phase}${selected ? ' selected' : ''}${next ? ' next' : ''}${ticking ? ' ticking' : ''}"><svg width="24" height="24" viewBox="-12 -12 24 24" aria-hidden="true">${ticking ? '<circle class="home-dem-ring" r="11" fill="none" stroke-dasharray="3 2"/>' : ''}<g transform="rotate(${cog})"><path d="M0 -9 L4.5 -3 L4.5 8 L-4.5 8 L-4.5 -3 Z"/><rect x="-2.5" y="2" width="5" height="3"/></g></svg>${next ? `<span class="home-map-vessel-no">${next}</span>` : ''}<span class="home-map-vessel-label">${escapeHtml(name)}${extra ? ` <em>${escapeHtml(extra)}</em>` : ''}</span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}


export default function Home() {
  const { scen, result } = useApp()
  if (!scen) {
    return (
      <div className="home-console">
        <div className="home-loading small muted">{result.loading ? '데이터셋을 불러오는 중입니다' : result.error ?? '후보가 아직 없습니다'}</div>
      </div>
    )
  }
  return <HomeMap />
}

function HomeMap() {
  const { result, scen, current, openVessel, go, setMailFilter, isScheduler, drawer } = useApp()
  // 11-24 고도화: 반영 여부를 정하지 않은 돌발 상황이 있을 때만 「입항 예정」 아래에 같은 모양의 창을 띄운다.
  const { incidents } = useInbox()
  // 운영 현황 = 지금 운영 중인 상황 (11-26 사용자 결정). 후보(확정 전 안)는 보이지 않는다.
  //   확정 전: 이전 계획. 따로 없으므로 데이터에 든 예정 ETA · 접안 · 이안(실제 접안 기록)을 최적화 전 계획으로 본다(scen.existing).
  //            후보 A를 계산하면 같은 계획을 엔진 계산식으로 평가한 값(체선 · 정박시간)이 채워진다 — 계획 자체는 그대로.
  //   확정 뒤: 확정한 계획(확정 스냅숏, 이 데이터셋에서 확정한 것만). 확정 뒤 계획 조건을 고쳐도 그대로다.
  const confirmed = current ? activePlan() : null
  const plan = useMemo(() => (confirmed && confirmed.scenName === scen.name
    ? { id: confirmed.candId, label: `확정 계획 v${confirmed.no}`, placements: confirmed.placements }
    : scen.existing), [confirmed, scen])
  const span = useMemo(() => spanOf([plan]), [plan])
  const START = NOW
  // 11-26 운영 현황은 계속 바뀌므로 지금부터 72시간까지만 본다 (그래프 · 재생 막대)
  const end = Math.min(START + 72 * 60, Math.max(START + 24 * 60, span.end))
  const [t, setT] = useState(NOW)
  const [playing, setPlaying] = useState(false)
  const [selected, setSelected] = useState(null)
  const [berthSel, setBerthSelRaw] = useState(null)
  const [zoom, setZoom] = useState(12)
  const [viewId, setViewId] = useState('piers')
  // 11-25 마우스오버: 'pier:<부두>' 또는 'vessel:<선박>'. 올린 것과 이어진 것(부두 점, 이름표, 간트 줄, 경로)을 강조한다.
  const [hover, setHover] = useState(null)
  const showView = (id) => { setViewId(id); mapRef.current?.fitBounds(MAP_VIEWS.find((v) => v.id === id).bounds, MAP_FIT) }
  const [viewTick, setViewTick] = useState(0) // 지도를 끌어 옮기면 부두 표식 줄을 다시 맞춘다
  const [gView, setGView] = useState('graph')
  // 11-25 부두별 접안 일정: 한 번에 부두 하나만(전체 보기 없음). 처음은 첫 부두.
  const [gPier, setGPier] = useState(null)
  const [gTab, setGTab] = useState('all') // 'all' = 부두별 접안 일정(전체 선석), 'pier' = 부두별 작업 현황(부두 하나씩)
  // 11-25 스케줄 현황 패널은 아래 일정(그래프, 표)과 겹쳐 없앴다. 부두를 누르면 그 부두로 확대한다.
  const bById = useMemo(() => Object.fromEntries(scen.berths.map((b) => [b.id, b])), [scen])
  const zoomTo = (pos, z = 15.5) => mapRef.current?.setView(pos, z)
  const setBerthSel = (id) => { setBerthSelRaw(id); if (id) zoomTo(bById[id].pos, 16) }
  const pickPier = (pier) => { setBerthSelRaw(null); const pr = piers.find((x) => x.id === pier); if (pr) zoomTo(pr.berths[0].pos, 15.5) }
  // 선박 카드를 닫으면 선택(과 그 배의 이동 경로)도 지운다
  useEffect(() => { if (!drawer) setSelected(null) }, [drawer])
  useEffect(() => { setT((now) => Math.min(now, end)) }, [end])
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markerLayer = useRef(null)
  const routeLayer = useRef(null)
  const markers = useRef(new Map())
  const states = useMemo(() => stateAt(plan, scen, t).sort((a, b) => a.v.eta - b.v.eta), [plan, scen, t])
  // 정박지 자리: 시간이 흘러도 배마다 같은 자리(정박지별 도착 순 번호로 고정)
  const spotOf = useMemo(() => {
    const out = {}
    const vById = Object.fromEntries(scen.vessels.map((v) => [v.id, v]))
    for (const a of MAP_CONTEXT.anchorages) {
      const list = plan.placements.filter((p) => vById[p.vid] && anchorageFor(vById[p.vid]).id === a.id).sort((x, y) => (x.eta ?? vById[x.vid].eta) - (y.eta ?? vById[y.vid].eta))
      list.forEach((p, k) => {
        const [lat, lng] = a.spots[k % a.spots.length]
        const round = Math.floor(k / a.spots.length)
        out[p.vid] = [lat - (round % 4) * 0.0016, lng + (round % 4) * 0.0022 - Math.floor(round / 4) * 0.003]
      })
    }
    return out
  }, [plan, scen])

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
  const gBerths = useMemo(() => (piers.find((pr) => pr.id === (gPier ?? piers[0]?.id))?.berths ?? []).map((b) => b.id), [piers, gPier])
  const busyNow = states.filter((st) => st.phase === 'berthed').length
  const waitNow = states.filter((st) => st.phase === 'waiting').length
  const demCount = plan.placements.filter((p) => demCents(p) > 0).length
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
    // 5분씩(팀 엔진의 시간 칸) 나아간다. 속도는 예전과 비슷하게(약 1.4시간/초)
    const timer = window.setInterval(() => setT((now) => Math.min(end, now + STEP_MIN)), 60)
    return () => window.clearInterval(timer)
  }, [playing, end])
  useEffect(() => { if (t >= end) setPlaying(false) }, [t, end])

  // 지도 수명과 선박 표식 갱신을 분리합니다. StrictMode 재마운트도 같은 정리 경로를 씁니다.
  useEffect(() => {
    const map = L.map(mapElement.current, { zoomControl: false, minZoom: 11, maxZoom: 18, zoomSnap: 0.5 })
    // 11-25 「Leaflet」 글자와 국기는 뺀다(필수 아님). OpenStreetMap 저작권 표기는 타일 이용 조건이라 작게 남긴다.
    map.attributionControl.setPrefix(false)
    mapRef.current = map
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      className: 'home-base-tiles',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    map.fitBounds(MAP_VIEWS[0].bounds, MAP_FIT)
    setZoom(map.getZoom())
    map.on('zoomend', () => setZoom(map.getZoom()))
    map.on('moveend', () => setViewTick((x) => x + 1))
    // 11-25 배 움직임 애니메이션: 5분 칸 사이를 CSS 전환으로 채운다. 확대, 축소 중에는 끈다(배가 늦게 따라오는 것 방지).
    const el = mapElement.current
    el.classList.add('anim')
    let animTimer = 0
    map.on('zoomstart', () => { window.clearTimeout(animTimer); el.classList.remove('anim') })
    map.on('zoomend', () => { animTimer = window.setTimeout(() => el.classList.add('anim'), 80) })
    for (const anchorage of MAP_CONTEXT.anchorages) {
      L.circle(anchorage.center, { radius: 900, color: '#e9a83a', weight: 1, dashArray: '4 4', fillColor: '#e9a83a', fillOpacity: 0.035, interactive: false }).addTo(map)
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
    const update = (key, pos, icon, title, tooltip, onClick, zIndexOffset = 0, hoverKey = null) => {
      wanted.add(key)
      let marker = markers.current.get(key)
      if (!marker) {
        marker = L.marker(pos, { icon, title, zIndexOffset }).addTo(markerLayer.current)
        markers.current.set(key, marker)
      } else {
        marker.setLatLng(pos).setZIndexOffset(zIndexOffset)
        // 내용이 같으면 아이콘을 다시 만들지 않는다(마우스오버 중 깜빡임과 툴팁 닫힘 방지)
        if (marker.options.icon?.options?.html !== icon.options.html) marker.setIcon(icon)
      }
      marker.off('click')
      if (onClick) marker.on('click', onClick)
      // 우리 마우스오버 처리만 떼고 붙인다(Leaflet 툴팁이 쓰는 mouseover/mouseout은 건드리지 않는다)
      if (marker._hov) { marker.off('mouseover', marker._hov.on); marker.off('mouseout', marker._hov.off) }
      marker._hov = null
      if (hoverKey) {
        marker._hov = { on: () => setHover(hoverKey), off: () => setHover((h) => (h === hoverKey ? null : h)) }
        marker.on('mouseover', marker._hov.on)
        marker.on('mouseout', marker._hov.off)
      }
      if (tooltip) {
        if (marker.getTooltip()) marker.setTooltipContent(tooltip)
        else marker.bindTooltip(tooltip, { direction: 'auto', offset: [14, 0], className: 'home-map-tip', opacity: 1 })
      } else if (marker.getTooltip()) marker.unbindTooltip()
    }
    const open = (vid) => { setSelected(vid); openVessel(plan.id, vid, { at: t }) }
    const hoverVessel = hover?.startsWith('vessel:') ? states.find((st) => st.v.id === hover.slice(7)) : null
    const hotPier = hover?.startsWith('pier:') ? hover.slice(5) : hoverVessel ? bById[hoverVessel.p.bid]?.pier : null
    // 부두(묶음) 표식: 멀리 볼 때. 작업 중 선석 수 / 전체 선석 수.
    // 11-25 부두 표식은 확대와 상관없이 늘 제자리에 있다. 가까이 보면 육지 쪽(서쪽)에 전체 이름표,
    //   멀리 보면(확대 13.5 미만) 부두끼리 몇 px밖에 안 떨어져 겹치므로 짧은 이름표(SK3 + 상태 점)를
    //   남북으로 이웃한 부두끼리 왼쪽, 오른쪽에 번갈아 붙인다.
    const compact = zoom < 13.5
    // 이름표 자리 고르기(화면 픽셀 기준): 실제 글자 폭을 재고, 부두 점 둘레의 여러 후보(왼쪽, 위, 아래, 오른쪽과
    //   그 위아래로 조금씩 민 자리) 가운데 먼저 놓인 이름표와 겹침이 가장 적은 자리를 쓴다. 가까이 보면 육지 쪽(왼쪽)을 먼저.
    const fullText = (pr) => {
      const sts = pr.berths.map((b) => berthStatus(b))
      const busy = sts.filter((x) => x.key === 'busy').length
      const nm = pr.id === 'BUOY' ? '부이' : pr.id === 'GAS' ? '가스부두' : `${pr.id}부두`
      return `${nm}  ${sts.some((x) => x.key === 'blocked') ? '사용 불가' : busy ? `${busy}/${pr.berths.length} 작업` : '비어 있음'}`
    }
    const offsetOf = new Map()
    const pierMarks = []
    if (mapRef.current) {
      const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1
      const ctx = measureCtx()
      const placed = []
      // 11-25 축소했을 때(확대 13.5 미만): 부두가 몇 px 안에 몰리므로 이름표를 지도 왼쪽 위에 세로 목록으로 모은다.
      //   연결선은 긋지 않는다(사용자 결정). 실제 위치는 부두 점과 마우스오버 강조로 본다.
      const colIds = new Set()
      if (compact) {
        const h = 11 * fs * 1.25 + 10
        const step = h + 4
        piers.forEach((pr, i) => {
          const pt = mapRef.current.latLngToContainerPoint(pr.berths[0].pos)
          const x = 10, y = 10 + i * step
          offsetOf.set(pr.id, { x: x - pt.x, y: y - pt.y })
          colIds.add(pr.id)
          ctx.font = `700 ${11 * fs}px "IBM Plex Sans KR", sans-serif`
          placed.push({ x, y, w: ctx.measureText(fullText(pr)).width + 34, h })
          const sts = pr.berths.map((b) => berthStatus(b))
          const tone = sts.some((x2) => x2.key === 'blocked') ? 'blocked' : sts.some((x2) => x2.key === 'busy') ? 'busy' : 'idle'
          pierMarks.push({ id: pr.id, at: pr.berths[0].pos, tone, to: null })
        })
      }
      const area = (a) => placed.reduce((n, b) => n + Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)), 0)
      for (const pr of [...piers].sort((a, b) => b.berths[0].pos[0] - a.berths[0].pos[0])) {
        if (colIds.has(pr.id)) continue
        const pt = mapRef.current.latLngToContainerPoint(pr.berths[0].pos)
        const text = fullText(pr)
        ctx.font = `700 ${11 * fs}px "IBM Plex Sans KR", sans-serif`
        const w = ctx.measureText(text).width + 34
        const h = 11 * fs * 1.25 + 10
        const g = 6
        const L = { x: -g - w, y: -h / 2 }, R = { x: g + 8, y: -h / 2 }, T = { x: -w / 2, y: -g - 6 - h }, B = { x: -w / 2, y: g + 6 }
        const base = [L, T, B, R]
        const cand = [...base]
        for (const k of [1, 2]) for (const c of [L, R]) cand.push({ x: c.x, y: c.y - k * h }, { x: c.x, y: c.y + k * h })
        let best = cand[0]
        let bestA = Infinity
        for (const c of cand) {
          const a = area({ x: pt.x + c.x, y: pt.y + c.y, w, h })
          if (a < bestA) { best = c; bestA = a }
          if (a === 0) break
        }
        placed.push({ x: pt.x + best.x, y: pt.y + best.y, w, h })
        offsetOf.set(pr.id, best)
        // 이름표가 점에서 떨어져 있으면 점 → 이름표 가장 가까운 변까지 짧은 선
        const nx = Math.max(best.x, Math.min(0, best.x + w)), ny = Math.max(best.y, Math.min(0, best.y + h))
        const sts = pr.berths.map((b) => berthStatus(b))
        const tone = sts.some((x) => x.key === 'blocked') ? 'blocked' : sts.some((x) => x.key === 'busy') ? 'busy' : 'idle'
        pierMarks.push({ id: pr.id, at: pr.berths[0].pos, tone, to: Math.hypot(nx, ny) > 10 ? mapRef.current.containerPointToLatLng([pt.x + nx, pt.y + ny]) : null })
      }
    }
    const posStyle = (id) => { const o = offsetOf.get(id); return o ? `transform:translate(${o.x.toFixed(1)}px,${o.y.toFixed(1)}px)` : '' }
    // 11-25 선석 번호가 보일 만큼 확대하면(near) 부두 이름표와 부두 점은 숨기고 선석 표식만 남긴다
    for (const pier of piers) {
      if (near) continue
      const sts = pier.berths.map((b) => berthStatus(b))
      const busy = sts.filter((s) => s.key === 'busy').length
      const blocked = sts.some((s) => s.key === 'blocked')
      const key = blocked ? 'blocked' : busy ? 'busy' : 'idle'
      const at = pier.berths[0].pos
      const tooltip = tipHtml({
        title: pier.name, chip: blocked ? '사용 불가 있음' : `${busy}/${pier.berths.length} 작업`, tone: blocked ? 'bad' : busy ? 'ok' : 'idle',
        meter: sts.map((x) => (x.key === 'busy' ? 'on' : x.key === 'blocked' ? 'bad' : '')),
        rows: pier.berths.map((b, i) => {
          const o = sts[i].occupant
          return [b.label.replace(/^.*부두\s?/, '') || b.label, o ? `${o.v?.name ?? ''}` : sts[i].next ? `비어 있음, 다음 ${fmt(sts[i].next.etb).split(' ')[1]}` : sts[i].text, o ? 'busy' : 'idle', o ? o.progress : null]
        }),
      })
      update(`pier-${pier.id}`, at, L.divIcon({
        className: 'home-map-label-wrap',
        html: `<span class="hud-tag st-${key}" style="${posStyle(pier.id)}"><i></i><b>${escapeHtml(pier.id === 'BUOY' ? '부이' : pier.id === 'GAS' ? '가스부두' : `${pier.id}부두`)}</b><em>${blocked ? '사용 불가' : busy ? `${busy}/${pier.berths.length} 작업` : '비어 있음'}</em></span>`,
        iconSize: [0, 0],
      }), pier.name, tooltip, () => pickPier(pier.id), 500, `pier:${pier.id}`)
    }
    // 선석 표식: 가까이 볼 때만
    if (near) {
      for (const berth of scen.berths) {
        const st = berthStatus(berth)
        const tooltip = tipHtml({
          title: berth.label, chip: st.key === 'busy' ? '작업 중' : st.text, tone: st.key === 'busy' ? 'ok' : st.key === 'blocked' ? 'bad' : 'idle',
          rows: [
            st.occupant ? ['선박', `${st.occupant.v?.name ?? st.occupant.p.vid}, 진행 ${Math.round(st.occupant.progress * 100)}%`] : ['다음 접안', st.next ? fmt(st.next.etb) : '예정 없음'],
            ['받을 수 있는 배', `DWT ${berth.maxDwt?.toLocaleString() ?? '-'} 이하, 흘수 ${berth.maxDraft ?? '-'}m 이하`],
          ],
          hint: berth.approxPos ? '위치는 근사값' : null,
        })
        update(`berth-${berth.id}`, berth.pos, L.divIcon({
          className: 'home-map-label-wrap',
          html: `<span class="home-map-berth st-${st.key}${berthSel === berth.id ? ' sel' : ''}">${escapeHtml(berth.label)}</span>`,
          iconSize: [0, 0],
        }), berth.name, tooltip, () => setBerthSel(berth.id), 500)
      }
    }
    // 11-25 범례 없이 읽히게: 곧 접안할 배(6시간 안, 최대 4척)는 이름 옆에 「→ 선석 시각」과 바다 경로를 늘 보인다.
    for (const a of MAP_CONTEXT.anchorages) {
      const n = states.filter((st) => st.phase === 'waiting' && anchorageFor(st.v).id === a.id).length
      update(`anch-${a.id}`, [a.center[0] + 0.011, a.center[1]], L.divIcon({ className: 'home-map-label-wrap', html: `<span class="home-map-anchorage">${escapeHtml(a.label)} <b>${n ? `대기 ${n}척` : '대기 없음'}</b></span>`, iconSize: [0, 0] }), a.label, null, null, 300)
    }
    const placeOf = {}
    for (const state of states) {
      // 11-25 배 위치는 재생 시각에 맞춰 바다 경로 위를 이어서 움직인다(vesselMotion.js)
      const anch = anchorageFor(state.v)
      const berth = bById[state.p.bid]
      const pose = berth && spotOf[state.v.id] ? poseAt(state, t, spotOf[state.v.id], anch.id, berth) : null
      if (!pose) continue
      const pos = pose.pos
      placeOf[state.v.id] = pos
      const isSelected = selected === state.v.id
      const v = state.v
      update(`vessel-${v.id}`, pos, shipIcon({
        name: v.name, phase: pose.moving === 'out' ? 'left' : pose.moving ? 'coming' : state.phase, cog: Math.round(pose.cog), selected: isSelected, ticking: false,
        extra: isSelected && state.phase === 'waiting' ? `→ ${bById[state.p.bid]?.label ?? state.p.bid} ${fmt(state.p.etb).split(' ')[1]} 접안` : state.phase === 'berthed' && isSelected ? `작업 중, ${fmt(state.p.etu).split(' ')[1]} 이안` : '',
      }), `${v.name} 선박 카드`, tipHtml({
        title: v.name, sub: [v.nameEn, v.cls].filter(Boolean).join(', '),
        chip: state.phase === 'waiting' ? '정박지 대기' : state.phase === 'berthed' ? '작업 중' : '이동 중', tone: state.phase === 'waiting' ? 'warn' : state.phase === 'berthed' ? 'ok' : 'idle',
        big: state.phase === 'berthed' ? { value: fmtDur(Math.max(0, state.p.etu - t)), label: '뒤 이안' } : { value: fmtDur(Math.max(0, state.p.etb - t)), label: `뒤 ${bById[state.p.bid]?.label ?? state.p.bid} 접안` },
        rows: [
          ['화물', `${v.product} ${v.dir}, ${v.ton?.toLocaleString() ?? '-'}t`],
          ['도착', fmt(v.eta)],
          [state.phase === 'berthed' ? '접안' : '접안 예정', fmt(state.p.etb)],
          ['이안', fmt(state.p.etu)],
        ],
      }), () => open(v.id), isSelected ? 1200 : 800, `vessel:${v.id}`)
    }
    for (const [key, marker] of markers.current) {
      if (!wanted.has(key)) { markerLayer.current.removeLayer(marker); markers.current.delete(key) }
    }
    // 이동 가이드선 (11-24 화면 리뷰 결정): 스케줄된 배 전부가 아니라 「선택한 배」의 예상 이동 경로만 그린다.
    //   배를 누르면 선박 카드(제원 등)는 그대로 열리고, 그 배가 배정된 선석으로 가는 길만 지도에 나타난다.
    //   색 지도 위에서도 보이게 흰 테두리를 깔고, 구간마다 진행 방향 화살표를 둔다.
    //   이름표는 접안이 빠른 순서로 몇 척만 쌓고 나머지는 「외 N척」으로 줄인다.
    routeLayer.current.clearLayers()
    for (const m of near ? [] : pierMarks) {
      const color = m.tone === 'busy' ? '#3ccf91' : m.tone === 'blocked' ? '#f2555d' : '#93a3b4'
      if (m.to) {
        if (m.strong) L.polyline([m.at, m.to], { color: '#06090d', weight: 4, opacity: 0.55, interactive: false }).addTo(routeLayer.current)
        L.polyline([m.at, m.to], { color, weight: m.strong ? 2 : 1.2, opacity: 1, interactive: false }).addTo(routeLayer.current)
      }
      const hot = hotPier === m.id
      if (hot) L.circleMarker(m.at, { radius: 11, color, weight: 2, fill: false, opacity: 0.9, interactive: false }).addTo(routeLayer.current)
      L.circleMarker(m.at, { radius: hot ? 6 : 4, color: '#0a0f15', weight: 1.5, fillColor: color, fillOpacity: hotPier && !hot ? 0.45 : 1, interactive: false }).addTo(routeLayer.current)
    }
    const arrow = (a, b, color, opacity) => {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const deg = (Math.atan2((b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180), b[0] - a[0]) * 180) / Math.PI
      L.marker(mid, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'home-route-arrow-wrap', html: `<span class="home-route-arrow" style="transform:translate(-50%,-50%) rotate(${deg}deg);color:${color};opacity:${opacity}">▲</span>`, iconSize: [0, 0] }) }).addTo(routeLayer.current)
    }
    // 경로: 누른 배 하나만(기본은 안 그린다). 바다로만 간다(seaRoutes.js).
    for (const state of states) {
      if ((state.v.id !== selected && state.v.id !== hoverVessel?.v.id) || !(state.phase === 'waiting' || state.phase === 'coming')) continue
      const berth = bById[state.p.bid]
      if (!berth) continue
      // 11-25 정박지 자리에서 선석까지 물길. 아직 들어오는 중이면 입구 → 정박지 자리 물길을 앞에 붙인다
      const spot = spotOf[state.v.id]
      if (!spot) continue
      const toBerth = seaRoute(spot, anchorageFor(state.v).id, berth)
      const path = state.phase === 'coming' ? [...arriveRoute(spot), ...toBerth.slice(1)] : toBerth
      const sel = state.v.id === selected
      const color = sel ? '#ff7043' : '#ffab8f'
      const op = sel ? 0.95 : 0.6
      L.polyline(path, { color: '#ffffff', weight: sel ? 6 : 4, opacity: 0.6, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer.current)
      L.polyline(path, { color, weight: sel ? 3 : 2, dashArray: '8 5', opacity: op, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer.current)
      for (let i = 0; i < path.length - 1; i++) if (i % 2 === 0) arrow(path[i], path[i + 1], color, op)
    }
  }, [plan, scen, states, selected, t, openVessel, berthSel, near, piers, bById, zoom, viewTick, hover, spotOf]) // eslint-disable-line react-hooks/exhaustive-deps

  // 마우스오버 강조는 표식 내용을 바꾸지 않고 클래스만 붙였다 뗀다(요소가 바뀌면 마우스가 벗어나도 툴팁이 안 닫힘)
  useEffect(() => {
    const hv = hover?.startsWith('vessel:') ? states.find((st) => st.v.id === hover.slice(7)) : null
    const hot = hover?.startsWith('pier:') ? hover.slice(5) : hv ? bById[hv.p.bid]?.pier : null
    for (const pr of piers) {
      const m = markers.current.get(`pier-${pr.id}`)
      const el = m?.getElement()?.firstElementChild
      if (!el) continue
      el.classList.toggle('hl', hot === pr.id)
      el.classList.toggle('dim', !!hot && hot !== pr.id)
      m.setZIndexOffset(hot === pr.id ? 900 : 500)
    }
  }, [hover, piers, states, bById, zoom, viewTick])

  // 확대 정도에 따라 선박 이름표를 숨긴다(멀리 볼 때 수십 개 이름표가 겹치지 않게, 선택한 선박은 그대로).
  useEffect(() => { mapElement.current?.classList.toggle('zoom-far', zoom < 13.5) }, [zoom])

  const openCard = (vid) => { setSelected(vid); openVessel(plan.id, vid, { at: t }) }
  const step = (minutes) => { setPlaying(false); setT((now) => Math.max(START, Math.min(end, now + minutes))) }

  return (
    <div className="home-console">
      <div className="home-main v4">
        <Panel title="접안 현황" className="home-map-panel" bodyClass="home-map-body" actions={<>
<div className="home-gantt-switch home-view-presets" role="tablist" aria-label="지도 보기">
            {MAP_VIEWS.map((v) => <button key={v.id} type="button" role="tab" aria-selected={viewId === v.id} className={viewId === v.id ? 'on' : ''} onClick={() => showView(v.id)}>{v.label}</button>)}
          </div></>}>
          <div className="home-top">
          <div className="home-map-stage">
            <div ref={mapElement} className="home-map" role="region" aria-label="울산항 선박 위치 지도" />
            <div className="home-map-context">
              {windAhead && <span className={`home-wx-chip ${windAhead.now ? 'on' : ''}`}><Icon icon="warning-sign" size={12} />강풍 {windAhead.now ? '관측' : '예보'}, 최대 <span className="num">{windAhead.ms}m/s</span> (<span className="num">{fmt(windAhead.t)}</span>)</span>}
              {isNight && <span className="home-night"><Icon icon="moon" size={12} />야간 시간대 (20시~06시)</span>}
            </div>
          </div>
          <aside className="home-arrivals" aria-label="입항 예정">
            <header className="home-arr-head">
              <span className="home-arr-title">입항 예정</span>
              <b className="home-arr-count num">{coming.length}</b>
            </header>
            {isScheduler && incidents.length > 0 && <div className="home-arr-incidents" role="region" aria-label="조건 변경 요청">
              {incidents.map((a) => <button type="button" key={a.id} onClick={() => { setMailFilter('incident'); go('inbox') }}>
                <Icon icon="warning-sign" size={12} />
                <span><strong>{a.title.match(/^\[(.+?)\]/)?.[1] ?? '조건 변경'}</strong> {a.title.replace(/^\[.+?\]\s*/, '')}</span>
              </button>)}
            </div>}
            <div className="home-arr-list">
              {coming.length === 0 && <div className="home-arr-empty">이 시각 뒤로 들어올 배가 없습니다</div>}
              {coming.map(({ v, p }) => <button type="button" key={v.id} className={`home-arr ${selected === v.id ? 'on' : ''}`} onClick={() => openCard(v.id)}>
                <span className="home-arr-time num"><b>{fmt(v.eta).split(' ')[1]}</b> <small>{fmt(v.eta).split(' ')[0]}</small></span>
                <strong className="home-arr-name" title={v.name}>{v.name}</strong>
                <span className="home-arr-cargo" title={`${v.product} ${v.dir}${v.ton ? `, ${v.ton.toLocaleString()}t` : ''}`}>{v.product} {v.dir}{v.ton ? <span className="num">, {v.ton.toLocaleString()}t</span> : null}</span>
                <span className="home-arr-berth">→ {bById[p.bid]?.label ?? p.bid}</span>
                <span className="home-arr-left num">{fmtDur(v.eta - t)} 후</span>
              </button>)}
            </div>
          </aside>
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
              <div className="home-time-track">{bands.map((band) => <span key={band.key} className={`home-time-band ${band.kind}`} style={{ left: `${band.left}%`, width: `${band.width}%` }} title={band.kind === 'night' ? '밤 20시~06시' : band.kind === 'weather' ? `강풍 ${WIND_ALERT_MS}m/s 이상` : '사용 불가'}>{band.width > 3 && <em>{band.kind === 'night' ? '밤' : band.kind === 'weather' ? '강풍' : '사용 불가'}</em>}</span>)}</div>
              <input type="range" min={START} max={end} step={STEP_MIN} value={t} aria-label="시각" aria-valuetext={fmt(t)} onChange={(event) => { setPlaying(false); setT(Number(event.target.value)) }} />
              <div className="home-time-ticks">{dayTicks.map((tick) => <span key={tick.key} className="num" style={{ left: `${pct(tick.at)}%` }}>{tick.text}</span>)}</div>
            </div>
          </div>
          {/* 11-25 지도 아래: 부두별 접안 일정. 그래프(G) = 선석마다 누가 언제 붙고 그 전에 얼마나 기다렸는지, 표(T) = 같은 내용을 접안 순으로 */}
          <section className="home-gantt" aria-label="부두별 접안 일정">
            <header className="home-gantt-head">
              <div className="home-gantt-tabs" role="tablist" aria-label="일정 보기">
                <button type="button" role="tab" aria-selected={gTab === 'all'} className={gTab === 'all' ? 'on' : ''} onClick={() => setGTab('all')}>부두별 접안 일정</button>
                <button type="button" role="tab" aria-selected={gTab === 'pier'} className={gTab === 'pier' ? 'on' : ''} onClick={() => setGTab('pier')}>부두별 작업 현황</button>
              </div>
              <span className="home-gantt-stat busy"><b className="num">{busyNow}</b>척 작업 중</span>
              <span className="home-gantt-stat"><b className="num">{waitNow}</b>척 정박지 대기</span>
              {isScheduler && <span className="home-gantt-stat dem"><b className="num">{demCount}</b>척 체선</span>}
              <div className="home-gantt-switch" role="tablist" aria-label="보기">
                <button type="button" role="tab" aria-selected={gView === 'graph'} className={gView === 'graph' ? 'on' : ''} onClick={() => setGView('graph')} title="그래프 (G)"><Icon icon="timeline-bar-chart" size={13} />그래프 <kbd>G</kbd></button>
                <button type="button" role="tab" aria-selected={gView === 'table'} className={gView === 'table' ? 'on' : ''} onClick={() => setGView('table')} title="표 (T)"><Icon icon="th" size={13} />표 <kbd>T</kbd></button>
              </div>
            </header>
            {gTab === 'pier' && <div className="home-gantt-piers" role="tablist" aria-label="부두 고르기">
              {piers.map((pr) => {
                const on = (gPier ?? piers[0]?.id) === pr.id
                const busyN = pr.berths.filter((b) => berthStatus(b).key === 'busy').length
                return (
                  <button key={pr.id} type="button" role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => setGPier(pr.id)}
                    onMouseEnter={() => setHover(`pier:${pr.id}`)} onMouseLeave={() => setHover((h) => (h === `pier:${pr.id}` ? null : h))}>
                    {pr.id === 'BUOY' ? '부이' : pr.id === 'GAS' ? '가스부두' : `${pr.id}부두`}
                    <span className={busyN ? 'busy' : ''}>{busyN}/{pr.berths.length}</span>
                  </button>
                )
              })}
            </div>}
            <div className="home-gantt-body">
              {gView === 'graph'
                ? <PlanGantt sim={plan} scen={scen} range={{ start: START, end }} fit cursor={t} activeVid={selected} onPick={openCard} berthIds={gTab === 'pier' ? gBerths : undefined} hlPier={hover?.startsWith('pier:') ? hover.slice(5) : null} hlBerth={hover?.startsWith('vessel:') ? states.find((st) => st.v.id === hover.slice(7))?.p.bid : null} />
                : <ScheduleTable plan={plan} scen={scen} t={t} bById={bById} selected={selected} onPick={openCard} showDem={isScheduler} berthIds={gTab === 'pier' ? gBerths : undefined} />}
            </div>
          </section>
        </Panel>

      </div>

    </div>
  )
}

const PHASE_TEXT = { coming: '입항 전', waiting: '정박지 대기', berthed: '작업 중', left: '떠남' }

/** 부두별 접안 일정 표: 그래프와 같은 내용을 접안 순으로. 상태는 재생 중인 시각 기준. */
function ScheduleTable({ plan, scen, t, bById, selected, onPick, showDem, berthIds }) {
  const vById = useMemo(() => Object.fromEntries(scen.vessels.map((v) => [v.id, v])), [scen])
  const phase = useMemo(() => Object.fromEntries(stateAt(plan, scen, t).map((st) => [st.v.id, st.phase])), [plan, scen, t])
  const rows = useMemo(() => plan.placements.filter((p) => !berthIds || berthIds.includes(p.bid)).sort((a, b) => a.etb - b.etb), [plan, berthIds])
  return (
    <table className="dt home-sched-table">
      <thead><tr>
        <th>선박</th><th>부두</th><th className="r">도착</th><th className="r">대기</th><th className="r">접안</th><th className="r">이안</th><th>지금 상태</th>{showDem && <th className="r">체선료</th>}
      </tr></thead>
      <tbody>{rows.map((p) => {
        const v = vById[p.vid]
        const eta = p.eta ?? v?.eta
        const wait = eta != null ? Math.max(0, p.etb - eta) : 0
        const ph = phase[p.vid] ?? 'coming'
        const cents = demCents(p)
        return (
          <tr key={p.vid} className={`${selected === p.vid ? 'on' : ''} ph-${ph}`} onClick={() => onPick(p.vid)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onPick(p.vid) }}>
            <td><b>{v?.name ?? p.vid}</b> <span className="faint small">{v?.product} {v?.dir}</span></td>
            <td>{bById[p.bid]?.label ?? p.bid}</td>
            <td className="num r">{eta != null ? fmt(eta) : '-'}</td>
            <td className={`num r ${wait > 0 ? 'c-amber' : 'faint'}`}>{wait > 0 ? fmtDur(wait) : '없음'}</td>
            <td className="num r">{fmt(p.etb)}</td>
            <td className="num r">{fmt(p.etu)}</td>
            <td><span className={`home-ph ph-${ph}`}>{PHASE_TEXT[ph]}</span></td>
            {showDem && <td className={`num r ${cents > 0 ? 'c-red' : 'faint'}`}>{cents > 0 ? money(cents) : '-'}</td>}
          </tr>
        )
      })}</tbody>
    </table>
  )
}
