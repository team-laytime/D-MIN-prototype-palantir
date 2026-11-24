import { useMemo } from 'react'
import { fmt, moneyShort } from '../lib/time.js'
import './plan.css'

export default function Timeline({ sim, scen, range, changed = [], compact = false, axis = true, activeVid, onPick }) {
  const span = Math.max(1, range.end - range.start)
  const position = (time) => `${(time - range.start) / span * 100}%`
  const interval = (start, end) => {
    const left = Math.max(start, range.start)
    const right = Math.min(end, range.end)
    return right > left ? { left: position(left), width: `${(right - left) / span * 100}%` } : null
  }
  const { vessels, rows, nights, ticks } = useMemo(() => {
    const vessels = Object.fromEntries(scen.vessels.map((vessel) => [vessel.id, vessel]))
    const rows = scen.berths.map((berth) => ({ berth, bars: sim.placements.filter((placement) => placement.bid === berth.id) }))
    const nights = scen.env.days.slice(0, -1).map((day, index) => ({ start: day.sunset, end: scen.env.days[index + 1].sunrise }))
      .filter((night) => night.end > range.start && night.start < range.end)
    const ticks = []
    for (let time = Math.ceil(range.start / 360) * 360; time <= range.end; time += 360) {
      const hour = ((time % 1440) + 1440) % 1440 / 60
      ticks.push({ time, day: hour === 0, label: hour === 0 ? fmt(time).slice(0, 5) : `${String(hour).padStart(2, '0')}:00` })
    }
    return { vessels, rows, nights, ticks }
  }, [sim, scen, range])
  const weather = scen.env.weather
  const weatherStyle = weather && interval(weather.start, weather.end)

  return (
    <div className={`plan-timeline ${compact ? 'plan-timeline-compact' : ''}`} aria-label={`${sim.label} 부두별 타임라인`}>
      {axis && (
        <div className="plan-timeline-axis">
          <div className="plan-timeline-label"><span className="mono">KST</span></div>
          <div className="plan-timeline-track">
            {ticks.map((tick) => (
              <span
                key={tick.time}
                className={`plan-timeline-tick num ${tick.day ? 'plan-day-tick' : ''} ${tick.time === range.start ? 'plan-first-tick' : ''} ${tick.time === range.end ? 'plan-last-tick' : ''}`}
                style={{ left: position(tick.time) }}
              >{tick.label}</span>
            ))}
          </div>
        </div>
      )}
      {rows.map(({ berth, bars }) => {
        const maintenance = berth.facility.maintenance
        const maintenanceStyle = maintenance && interval(maintenance.start, maintenance.end)
        const occupiedStyle = berth.occupiedUntil !== null && interval(range.start, berth.occupiedUntil)
        return (
          <div className="plan-timeline-lane" key={berth.id}>
            <div className="plan-timeline-label">
              <span>{berth.name}</span>
              {!compact && <span className="faint tiny num">{(berth.maxDwt / 1000).toFixed(0)}k DWT</span>}
            </div>
            <div className="plan-timeline-track">
              {nights.map((night) => <div key={night.start} className="plan-timeline-band plan-timeline-night" style={interval(night.start, night.end)} aria-hidden="true" />)}
              {ticks.map((tick) => <span key={tick.time} className={`plan-timeline-gridline ${tick.day ? 'plan-day-line' : ''}`} style={{ left: position(tick.time) }} aria-hidden="true" />)}
              {weatherStyle && <div className="plan-timeline-band plan-timeline-weather" style={weatherStyle} title={`${weather.label} · ${fmt(weather.start)} ~ ${fmt(weather.end)} · 접안 금지`} />}
              {maintenanceStyle && <div className="plan-timeline-band plan-timeline-maintenance" style={maintenanceStyle} title={`${maintenance.label} · ${fmt(maintenance.start)} ~ ${fmt(maintenance.end)}`} />}
              {occupiedStyle && (
                <div className="plan-timeline-bar plan-timeline-occupied" style={occupiedStyle} title={`${berth.occupiedBy} 현재 접안 · ${fmt(berth.occupiedUntil)}까지`}>
                  <span className="plan-timeline-bar-name mono">{berth.occupiedBy}</span>
                </div>
              )}
              {bars.map((placement) => {
                const vessel = vessels[placement.vid]
                const waitStyle = interval(vessel.eta, placement.etb)
                const barStyle = interval(placement.etb, placement.etu)
                const isChanged = changed.includes(placement.vid)
                return (
                  <div className="plan-timeline-placement" key={placement.vid}>
                    {waitStyle && <div className="plan-timeline-wait" style={waitStyle} title={`${vessel.name} 대기 ${fmt(vessel.eta)} → ${fmt(placement.etb)}`} />}
                    {barStyle && (
                      <button
                        type="button"
                        className={`plan-timeline-bar ${placement.dem.cents > 0 ? 'plan-timeline-dem' : ''} ${isChanged ? 'plan-timeline-changed' : ''} ${activeVid === placement.vid ? 'plan-timeline-active' : ''}`}
                        style={barStyle}
                        title={`${vessel.name} · ${fmt(placement.etb)} ~ ${fmt(placement.etu)}${isChanged ? ' · 최저안과 달라진 선박' : ''} · 산출 근거`}
                        aria-label={`${sim.label} ${vessel.name} 산출 근거, ${berth.name}, ${fmt(placement.etb)}부터 ${fmt(placement.etu)}까지`}
                        onClick={() => onPick?.(placement.vid)}
                      >
                        <span className="plan-timeline-bar-name mono">{vessel.name}</span>
                        {placement.dem.cents > 0 && <span className="plan-timeline-bar-dem num">{moneyShort(placement.dem.cents)}</span>}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
