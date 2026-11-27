import { KIND, sortRisks } from './risk.js'
import { fmt, toMin } from './time.js'

const windScope = '#3~7'
const comparable = (candidate) => Boolean(candidate?.resp?.plan) && !candidate.dropped?.length
  && !candidate.tankViolation?.length && !candidate.resp.plan.waits
  && !(candidate.requirements ?? []).some((r) => r.met !== true)

function canChangeBerth(first, second, fixes) {
  if (first === second || !comparable(first) || !comparable(second)) return false
  const byVessel = new Map(second.placements.map((p) => [p.vid, p]))
  if (byVessel.size !== first.placements.length) return false
  let change = false
  for (const p of first.placements) {
    const other = byVessel.get(p.vid)
    if (!other) return false
    if (p.bid === other.bid) continue
    if (p.fixed || other.fixed || fixes.has(p.vid)) return false
    change = true
  }
  return change
}

function constraintOf(risk, candidate, end) {
  const evidence = risk.evidence ?? {}
  const start = Date.parse(risk.start)
  if (!Number.isFinite(start)) return null
  const timing = start >= end ? 'extension' : 'planning'
  if (risk.kind === 'TANK') {
    const direction = ({ SHORT: 'lower', OVER: 'upper' })[evidence.side]
    const tank = candidate.resp?.params?.tank
    const limitPct = direction === 'lower' ? tank?.safe_min_pct : tank?.safe_max_pct
    if (!direction || !risk.tank || !Number.isFinite(limitPct) || !Number.isFinite(evidence.worst_pct)) return null
    const marginPct = direction === 'lower' ? evidence.worst_pct - limitPct : limitPct - evidence.worst_pct
    return { kind: 'tank', timing, direction, tank: risk.tank, limitPct, marginPct: Math.round(marginPct * 10) / 10 }
  }
  if (risk.kind === 'WORK_GAP' && evidence.gaps_h?.length && evidence.gaps_h.every(Number.isFinite)) {
    return { kind: 'turnaround', timing, berth: risk.berth, operations: evidence.ships, gapHours: Math.min(...evidence.gaps_h) }
  }
  if (risk.kind === 'LAYTIME' && evidence.slack_h > 0) {
    return { kind: 'laytime', timing, berth: risk.berth, state: 'remaining', slackHours: evidence.slack_h }
  }
  return null
}

function searchContext(scen) {
  const asOf = scen.request.start
  const date = new Date(Date.parse(asOf) + 9 * 36e5).toISOString().slice(0, 10)
  return { asOf, caseId: `${date}-ulsan-72h` }
}

function predecessor(placements, fix) {
  return placements.reduce((last, p) => (
    p.bid === fix.bid && p.etb < fix.etb && (!last || p.etb > last.etb) ? p : last
  ), null)?.vid
}

function canChangePredecessor(selected, candidate, fix, fixes) {
  if (selected === candidate || !comparable(selected) || !comparable(candidate)) return false
  const before = new Map(selected.placements.map((placement) => [placement.vid, placement]))
  const after = new Map(candidate.placements.map((placement) => [placement.vid, placement]))
  if (before.size !== after.size || [...before.keys()].some((id) => !after.has(id))) return false
  const preserves = (byVessel, { vid, bid, etb }) => {
    const placement = byVessel.get(vid)
    return placement?.fixed === true && placement.bid === bid && placement.etb === etb
  }
  if (!fixes.every((entry) => preserves(before, entry) && preserves(after, entry))) return false
  const oldPredecessor = predecessor(selected.placements, fix)
  const newPredecessor = predecessor(candidate.placements, fix)
  return oldPredecessor !== newPredecessor
}

function planningOptions(scen, selected, candidates) {
  const options = []
  for (const [index, block] of (scen.blocks ?? []).entries()) {
    if (block.kind !== 'EQUIPMENT' || !Number.isFinite(block.start) || !Number.isFinite(block.end)
        || block.end <= Math.max(block.start, 0)) continue
    const berths = [...new Set(block.berths ?? scen.berths?.map((berth) => berth.id) ?? [])].sort()
    if (!berths.length) continue
    const berth = berths.join(', ')
    options.push({
      id: `equipment:${index}`, intent: 'diagnosis',
      label: `설비 중단 ${berth} (${fmt(block.start)} ~ ${fmt(block.end)})`,
      constraint: { kind: 'equipment', berth, berthCount: berths.length,
        phase: block.start <= 0 ? 'active' : 'upcoming', leadMin: block.start, durationMin: block.end - block.start },
    })
  }

  const requirements = (selected?.req ?? scen.request).requirements ?? []
  for (const [index, requirement] of requirements.entries()) {
    const deadlineMin = toMin(requirement.at)
    const [material] = requirement.material_codes ?? []
    const tonnes = requirement.min_qty
    if (requirement.kind !== 'LOAD_BY' || (requirement.unit ?? 'TON') !== 'TON' || !material
        || requirement.material_codes.length !== 1 || requirement.cargo_groups?.length
        || !Number.isFinite(deadlineMin) || deadlineMin <= 0 || !Number.isFinite(tonnes) || tonnes <= 0) continue
    const result = selected?.requirements?.[index]
    const canApply = comparable(selected) && result?.kind === 'LOAD_BY' && result.met === true
      && toMin(result.at) === deadlineMin && result.required_t === Math.ceil(tonnes)
    options.push({
      id: `urgentExport:${index}`, intent: selected ? 'selection' : 'diagnosis', canApply,
      label: `긴급 출하 ${material} ${tonnes.toLocaleString('ko-KR')}t (${fmt(deadlineMin)} 마감)`,
      constraint: { kind: 'urgentExport', material, tonnes, deadlineMin },
    })
  }

  const fixes = scen.fixes ?? []
  for (const fix of fixes) {
    if (!fix.vid || !fix.bid || !Number.isFinite(fix.etb) || fix.etb < 0) continue
    const vessel = scen.vessels?.find((entry) => entry.id === fix.vid)?.name ?? fix.vid
    options.push({
      id: `fixedBerth:${fix.vid}`, intent: selected ? 'selection' : 'diagnosis',
      label: `고정 접안 ${fix.bid} ${vessel} (${fmt(fix.etb)})`,
      canApply: candidates.some((candidate) => canChangePredecessor(selected, candidate, fix, fixes)),
      constraint: { kind: 'fixedBerth', berth: fix.bid, leadMin: fix.etb, lock: 'berth_and_etb' },
    })
  }
  return options
}

export function precedentConfirmation(context, option, intent) {
  if (intent !== 'selection') return null
  if (option.constraint.kind === 'fixedBerth') return option.canApply
    ? '고정 선석·접안 시각을 유지하며 선행선 배치를 바꿀 권한 확인' : null
  if (option.constraint.kind === 'urgentExport') return option.canApply
    ? '현재 출하 자재·물량·마감 확정 확인' : null
  return context.canReassignBerth ? '대체 선석과 순서 변경 권한 확인' : null
}

export function precedentQuery(context, option, intent, confirmed) {
  const authorized = confirmed && Boolean(precedentConfirmation(context, option, intent))
  const kind = option.constraint.kind
  const canMove = authorized && kind !== 'fixedBerth' && kind !== 'urgentExport'
  return { mode: 'simulation', asOf: context.asOf, caseId: context.caseId, constraint: option.constraint, intent,
    capabilities: {
      keepCandidate: context.keepCandidate, resequence: canMove, reassignBerth: canMove,
      inspectSchedule: true, reviewTankBalance: true, verifyWindPolicy: true,
      rerunSolver: kind === 'solverFailure', reviewEquipment: kind === 'equipment',
      confirmedDispatch: kind === 'urgentExport' && authorized,
      resequenceAroundFixed: kind === 'fixedBerth' && authorized,
    },
  }
}

export function comparisonContext(scen, selected, candidates, risks) {
  const context = searchContext(scen)
  const end = Date.parse(context.asOf) + (scen.request.params?.horizon?.days ?? 3) * 864e5
  const options = planningOptions(scen, selected, candidates)
  for (const candidate of [selected, ...candidates.filter((c) => c !== selected)]) {
    const entry = risks[candidate.id]
    if (entry?.state !== 'done') continue
    for (const risk of sortRisks(entry.data?.risks ?? [])) {
      const constraint = constraintOf(risk, candidate, end)
      if (!constraint) continue
      const entity = risk.tank ?? risk.berth
      const direction = constraint.direction === 'upper' ? ' 상한' : constraint.direction === 'lower' ? ' 하한' : ''
      options.push({ id: `${candidate.id}:${risk.id}`, constraint, intent: 'selection',
        label: `${candidate.id} ${KIND[risk.kind]}${direction}${entity ? ` ${entity}` : ''} (${fmt(toMin(risk.start))})`, risk })
    }
  }

  const windLimits = [...new Set(candidates.map((candidate) => candidate.resp?.params?.weather?.thresholds_ms?.[windScope]?.[0])
    .filter(Number.isFinite))].sort((a, b) => a - b)
  if (windLimits.length === 2) options.push({ id: 'windPolicy', intent: 'diagnosis',
    label: `3~7번 하역 중단 기준 ${windLimits.join(' / ')} m/s`,
    constraint: { kind: 'windPolicy', scope: windScope, stopLimitsMs: windLimits } })

  const fixes = new Set((scen.fixes ?? []).map((p) => p.vid))
  return {
    ...context, options,
    keepCandidate: comparable(selected),
    canReassignBerth: candidates.some((candidate) => canChangeBerth(selected, candidate, fixes)),
  }
}

export function solverDiagnosticContext(scen, availability) {
  const missingCount = availability.filter((candidate) => !candidate.available).length
  return {
    ...searchContext(scen),
    keepCandidate: false,
    canReassignBerth: false,
    options: missingCount ? [{
      id: 'solverFailure', label: '후보 미산출', intent: 'diagnosis', constraint: {
        kind: 'solverFailure',
        baselineAvailable: availability.some((candidate) => candidate.slot === 'A' && candidate.available),
        missingCount,
      },
    }, ...planningOptions(scen, null, [])] : [],
  }
}
