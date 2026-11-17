import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Icon } from '@blueprintjs/core'
import { useApp } from '../state/app.jsx'
import './drawer.css'

const PAD = 6
const EDGE = 16
const sameRect = (a, b) => a === b || (a && b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height)
const clamp = (n, low, high) => Math.max(low, Math.min(n, high))

function cardPosition(spot, viewport, size) {
  const width = Math.min(size.width, viewport.width - EDGE * 2)
  const height = Math.min(size.height, viewport.height - EDGE * 2)
  const midTop = spot ? clamp(spot.top + (spot.height - height) / 2, EDGE, viewport.height - height - EDGE) : (viewport.height - height) / 2
  if (!spot) return { left: (viewport.width - width) / 2, top: midTop }
  const after = spot.left + spot.width + EDGE
  if (spot.height > viewport.height * 0.5) {
    if (viewport.width - after >= width + EDGE) return { left: after, top: midTop }
    if (spot.left >= width + EDGE * 2) return { left: spot.left - width - EDGE, top: midTop }
    return { left: EDGE, bottom: EDGE }
  }
  const left = clamp(spot.left, EDGE, viewport.width - width - EDGE)
  if (spot.top + spot.height + height + EDGE * 2 <= viewport.height) return { left, top: spot.top + spot.height + EDGE }
  if (spot.top >= height + EDGE * 2) return { left, top: spot.top - height - EDGE }
  if (viewport.width - after >= width + EDGE) return { left: after, top: midTop }
  if (spot.left >= width + EDGE * 2) return { left: spot.left - width - EDGE, top: midTop }
  return { right: EDGE, bottom: EDGE }
}

/** DOM 앵커는 지연 렌더링될 수 있다. 없는 동안 중앙에 두고 삽입·크기·스크롤 변화를 관찰한다. */
export default function Tour() {
  const { tour } = useApp()
  const step = tour.steps[tour.index]
  const cardRef = useRef(null)
  const returnFocus = useRef(document.activeElement)
  const [size, setSize] = useState({ width: 360, height: 300 })
  const [layout, setLayout] = useState({ spot: null, width: window.innerWidth, height: window.innerHeight, index: null })

  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const measure = () => {
      const r = card.getBoundingClientRect()
      setSize((old) => old.width === r.width && old.height === r.height ? old : { width: r.width, height: r.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    return () => observer.disconnect()
  }, [step])

  useEffect(() => {
    if (!step) return
    let target = null
    let frame = 0
    let settleUntil = 0
    let disposed = false
    const resizeObserver = new ResizeObserver(() => schedule())
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null
      if (target !== el) {
        if (target) resizeObserver.unobserve(target)
        target = el
        if (target) {
          target.scrollIntoView({ block: target.getBoundingClientRect().height > window.innerHeight * 0.7 ? 'start' : 'nearest', inline: 'nearest' })
          resizeObserver.observe(target)
          // Blueprint 드로어가 들어오는 동안의 수평 이동도 끝까지 따라간다.
          settleUntil = performance.now() + 400
        }
      }
      const width = window.innerWidth
      const height = window.innerHeight
      const r = target?.getBoundingClientRect()
      let spot = null
      if (r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < height && r.left < width) {
        const left = Math.max(r.left - PAD, 4)
        const top = Math.max(r.top - PAD, 4)
        spot = { left, top, width: Math.max(0, Math.min(r.right + PAD, width - 4) - left), height: Math.max(0, Math.min(r.bottom + PAD, height - 4) - top) }
      }
      setLayout((old) => old.index === tour.index && old.width === width && old.height === height && sameRect(old.spot, spot) ? old : { spot, width, height, index: tour.index })
    }
    function tick(now) {
      frame = 0
      if (disposed) return
      measure()
      if (now < settleUntil) schedule()
    }
    function schedule() {
      if (!disposed && !frame) frame = requestAnimationFrame(tick)
    }
    const mutations = new MutationObserver((records) => {
      if (records.some((r) => !r.target.closest?.('.tour-root'))) schedule()
    })
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-tour'] })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('transitionend', schedule, true)
    const afterRender = window.setTimeout(schedule, 120)
    schedule()
    cardRef.current?.focus({ preventScroll: true })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      clearTimeout(afterRender)
      mutations.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('transitionend', schedule, true)
    }
  }, [tour.index, step])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        tour.end()
        return
      }
      if (event.target.closest?.('input, textarea, select, [contenteditable="true"], [role="slider"]')) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        if (event.key === 'ArrowRight') tour.next()
        else tour.prev()
      }
    }
    // 캡처 단계에서 처리해 지도·드로어의 키 동작과 중복되지 않도록 한다. Enter는 버튼이 맡는다.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [tour])

  useEffect(() => {
    const previous = returnFocus.current
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  if (!step) return null
  const last = tour.index === tour.steps.length - 1
  const spot = layout.index === tour.index ? layout.spot : null
  const ready = layout.index === tour.index
  return createPortal(
    <div className="tour-root bp6-dark">
      {spot ? <>
        <div className="tour-shade" style={{ left: 0, top: 0, width: '100%', height: spot.top }} />
        <div className="tour-shade" style={{ left: 0, top: spot.top, width: spot.left, height: spot.height }} />
        <div className="tour-shade" style={{ left: spot.left + spot.width, top: spot.top, right: 0, height: spot.height }} />
        <div className="tour-shade" style={{ left: 0, top: spot.top + spot.height, width: '100%', bottom: 0 }} />
        <div className="tour-spot" style={spot} />
      </> : <div className="tour-shade tour-dim" />}
      <section
        ref={cardRef} className={`tour-card ${ready ? '' : 'tour-hidden'}`}
        style={cardPosition(spot, layout, size)} tabIndex={-1}
        role="dialog" aria-labelledby="tour-title" aria-describedby="tour-body"
      >
        <div className="tour-progress" role="progressbar" aria-label="사용법 안내 진행" aria-valuemin={0} aria-valuemax={tour.steps.length} aria-valuenow={tour.index + 1}>
          <span style={{ width: `${(tour.index + 1) / tour.steps.length * 100}%` }} />
        </div>
        <div className="tour-heading"><h3 id="tour-title">{step.title}</h3><span className="num">{tour.index + 1} / {tour.steps.length}</span></div>
        <p className="tour-section">{step.section}</p>
        <p id="tour-body" className="tour-body" aria-live="polite">{step.body}</p>
        {step.try && <p className="tour-try"><b>직접 해 보기</b> {step.try}</p>}
        <div className="tour-actions">
          <Button size="small" variant="minimal" text={last ? '닫기' : '건너뛰기'} onClick={tour.end} />
          <span />
          <Button size="small" variant="outlined" text="이전" icon="arrow-left" disabled={tour.index === 0} onClick={tour.prev} />
          <Button size="small" intent="primary" text={last ? '완료' : '다음'} endIcon={last ? 'tick' : 'arrow-right'} onClick={last ? tour.end : tour.next} />
        </div>
        <p className="tour-keys"><Icon icon="arrow-left" size={10} /><Icon icon="arrow-right" size={10} /> 이동 · <kbd>Esc</kbd> 닫기</p>
      </section>
    </div>,
    document.body,
  )
}
