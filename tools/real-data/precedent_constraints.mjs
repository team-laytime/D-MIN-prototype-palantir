import { vesselIdOf } from '../../src/lib/dataset.js'
import { toMin } from '../../src/lib/time.js'

export const variants = ['equipment', 'urgent_export', 'fixed_berth']

const hour = 3_600_000
const iso = (time) => new Date(time).toISOString()

export function scenarioConstraint(variant, request, plan) {
  const start = Date.parse(request.start)
  const vessels = new Map(request.vessels.map((vessel) => [vesselIdOf(vessel), vessel]))
  const operations = plan.vessels.filter((operation) => {
    const etb = Date.parse(operation.etb)
    return !operation.fixed && etb >= start + 8 * hour && etb <= start + 48 * hour
  }).sort((a, b) => a.etb.localeCompare(b.etb) || a.vessel_id.localeCompare(b.vessel_id))
  let operation
  let condition
  if (variant === 'equipment') {
    // A scheduled call tests whether the planned berth can absorb a two-hour outage.
    operation = operations.find((entry) => Object.keys(vessels.get(entry.vessel_id)?.rate_t_per_h ?? {}).length > 1)
    if (operation) condition = { berths: [operation.berth], start: iso(Date.parse(operation.etb) - hour / 2),
      end: iso(Date.parse(operation.etb) + hour * 1.5), kind: 'EQUIPMENT' }
  } else if (variant === 'urgent_export') {
    operation = operations.find((entry) => {
      const vessel = vessels.get(entry.vessel_id)
      const finish = Date.parse(entry.work_end)
      return vessel && ['DO', 'EX'].includes(vessel.biz) && vessel.material_code && vessel.qty >= 100
        && finish >= start + 16 * hour && finish <= start + 60 * hour
        && Date.parse(entry.etb) - Date.parse(vessel.eta) >= 2 * hour
    })
    if (operation) {
      const vessel = vessels.get(operation.vessel_id)
      condition = { kind: 'LOAD_BY', at: iso(Date.parse(operation.work_end) - hour * 2),
        material_codes: [vessel.material_code], min_qty: Math.floor(vessel.qty), unit: 'TON', label: '모의 긴급 출하' }
    }
  } else if (variant === 'fixed_berth') {
    operation = operations.find((entry) => Object.keys(vessels.get(entry.vessel_id)?.rate_t_per_h ?? {}).length > 1)
    if (operation) condition = { vessel_id: operation.vessel_id, berth: operation.berth,
      etb: iso(Date.parse(operation.etb) + 2 * hour) }
  }
  if (!condition) throw new Error(`No eligible control operation for ${variant}`)
  return {
    type: variant, provenance: 'synthetic_constraint_on_historical_replay', condition,
    anchor: { vessel_id: operation.vessel_id, berth: operation.berth, etb: operation.etb, work_end: operation.work_end },
  }
}

export function withScenarioConstraint(scen, trial) {
  const rule = trial.condition
  if (trial.type === 'equipment') return { ...scen,
    blocks: [...scen.blocks, { ...rule, start: toMin(rule.start), end: toMin(rule.end) }] }
  if (trial.type === 'fixed_berth') return { ...scen,
    fixes: [...scen.fixes, { vid: rule.vessel_id, bid: rule.berth, etb: toMin(rule.etb) }] }
  return { ...scen, request: { ...scen.request, requirements: [...(scen.request.requirements ?? []), rule] } }
}
