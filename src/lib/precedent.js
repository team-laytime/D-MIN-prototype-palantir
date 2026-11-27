const withinFactorOfTwo = (a, b) => Math.max(a, b) <= 2 * Math.min(a, b)

const PROFILE = {
  tank: {
    label: '탱크와 재고 제약 방향',
    keys: ['tank', 'direction', 'limitPct', 'timing'],
    metrics: [['marginPct', '상하한까지 여유', '%p', 2]],
    valid: (c) => ['upper', 'lower'].includes(c.direction) && Number.isFinite(c.limitPct)
      && c.limitPct >= 0 && c.limitPct <= 100,
    compatible: (a, b) => (a.marginPct < 0) === (b.marginPct < 0) && Math.abs(a.marginPct - b.marginPct) <= 5,
  },
  turnaround: {
    label: '연속 접안의 교대 간격',
    keys: ['timing'],
    metrics: [['gapHours', '최소 추가 교대 여유', '시간', 0.25], ['operations', '연속 작업 수', '건', 2]],
    valid: (c) => Number.isInteger(c.operations) && c.operations >= 2 && c.gapHours >= 0,
    compatible: (a, b) => Math.abs(a.gapHours - b.gapHours) <= 0.25
      && Math.max(a.operations, b.operations) <= 2 * Math.min(a.operations, b.operations),
  },
  laytime: {
    label: '계약 정박시간 여유 상태',
    keys: ['state', 'timing'],
    metrics: [['slackHours', '계약 정박시간 여유', '시간', 1]],
    valid: (c) => (c.state === 'remaining' && c.slackHours > 0) || (c.state === 'accrued' && c.slackHours <= 0),
    compatible: (a, b) => Math.abs(a.slackHours - b.slackHours) <= 2,
  },
  windPolicy: {
    label: '비교할 하역 중단 풍속 기준',
    keys: ['scope'],
    metrics: [],
    valid: (c) => Array.isArray(c.stopLimitsMs) && c.stopLimitsMs.length === 2
      && c.stopLimitsMs.every(Number.isFinite) && c.stopLimitsMs[0] < c.stopLimitsMs[1],
    compatible: (a, b) => a.stopLimitsMs.every((value, i) => value === b.stopLimitsMs[i]),
  },
  solverFailure: {
    label: '기본안 반환 여부와 미산출 후보 수',
    keys: ['baselineAvailable', 'missingCount'],
    metrics: [],
    valid: (c) => typeof c.baselineAvailable === 'boolean' && [1, 2, 3].includes(c.missingCount),
  },
  equipment: {
    label: '설비에 따른 신규 접안 중단 범위와 상태',
    keys: ['berthCount', 'phase'],
    metrics: [['durationMin', '접안 중단 길이', '분', 60], ['leadMin', '기준 시각부터 중단 시작까지', '분', 180]],
    valid: (c) => Number.isInteger(c.berthCount) && c.berthCount > 0 && c.durationMin > 0
      && c.leadMin + c.durationMin > 0 && c.phase === (c.leadMin <= 0 ? 'active' : 'upcoming'),
    compatible: (a, b) => withinFactorOfTwo(a.durationMin, b.durationMin) && Math.abs(a.durationMin - b.durationMin) <= 120
      && Math.abs(a.leadMin - b.leadMin) <= 360,
  },
  urgentExport: {
    label: '같은 자재의 긴급 선적 마감',
    keys: ['material'],
    metrics: [['deadlineMin', '기준 시각부터 출하 마감까지', '분', 180], ['tonnes', '요청 물량', 't', 500]],
    valid: (c) => typeof c.material === 'string' && c.deadlineMin > 0 && c.tonnes > 0,
    compatible: (a, b) => Math.abs(a.deadlineMin - b.deadlineMin) <= 360 && withinFactorOfTwo(a.tonnes, b.tonnes),
  },
  fixedBerth: {
    label: '선석과 접안 시각을 유지하는 고정 접안',
    keys: ['lock'],
    metrics: [['leadMin', '기준 시각부터 고정 접안까지', '분', 180]],
    valid: (c) => c.lock === 'berth_and_etb' && typeof c.berth === 'string' && c.berth.length > 0 && c.leadMin >= 0,
    compatible: (a, b) => Math.abs(a.leadMin - b.leadMin) <= 360,
  },
}

const CONSTRAINT_CHECK = {
  tank: '이번 탱크의 승인 운영 한계와 최신 입출고 및 재고를 확인한다.',
  turnaround: '이번 선행 작업의 종료예정과 후속 선박의 확정 마감을 확인한다.',
  laytime: '이번 항차의 계약 허용시간과 작업 종료예정을 확인한다.',
  windPolicy: '기준 시각에 받은 예보와 이번 작업에 적용되는 부두별 중단 기준을 확인한다.',
  solverFailure: '이번 미산출 후보의 계산 한도와 호환 선석 제약을 확인한다.',
  equipment: '중단 선석과 재개 예정 시각, 이번 대체 선석의 작업 가능 여부와 재고 영향을 확인한다.',
  urgentExport: '현재 자재와 물량, 확정 출하 마감, 작업 진행과 지연 시 대체 물량을 확인한다.',
  fixedBerth: '고정 선석과 접안 시각을 유지하고, 선행선의 도착·작업 종료예정과 변경 권한을 확인한다.',
}

export function checksForConstraint(constraint) {
  return Object.hasOwn(CONSTRAINT_CHECK, constraint?.kind) ? [CONSTRAINT_CHECK[constraint.kind]] : []
}

const timeOf = (value) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN
const empty = (status) => ({ status, matches: [] })

function validConstraint(constraint, profile) {
  return profile.keys.every((key) => constraint[key] != null && constraint[key] !== '')
    && profile.metrics.every(([key]) => Number.isFinite(constraint[key]))
    && (!profile.valid || profile.valid(constraint))
}

function compare(query, source, profile) {
  if (query.kind !== source?.kind || !validConstraint(source, profile) || profile.keys.some((key) => query[key] !== source[key])
      || (profile.compatible && !profile.compatible(query, source))) return null

  const sameBerth = Boolean(query.berth && query.berth === source.berth)
  const differences = profile.metrics.map(([key, label, unit]) => ({
    key, label, unit, current: query[key], precedent: source[key],
    delta: Math.round((query[key] - source[key]) * 1000) / 1000,
  }))
  if (query.berth && source.berth && !sameBerth) {
    differences.push({ key: 'berth', label: '선석', current: query.berth, precedent: source.berth })
  }
  const similarity = profile.metrics.reduce((sum, [key, , , scale]) => (
    sum + 1 / (1 + Math.abs(query[key] - source[key]) / scale)
  ), 0)
  return {
    score: (profile.metrics.length ? similarity / profile.metrics.length : 1) + (sameBerth ? 0.2 : 0),
    common: [profile.label, ...(sameBerth ? ['같은 선석'] : [])],
    differences: differences.filter((difference) => difference.delta !== 0),
  }
}

export function searchPrecedents(index, query) {
  if (query?.mode !== 'simulation') return empty('simulation_only')
  const asOf = timeOf(query.asOf)
  const constraint = query.constraint
  const profile = Object.hasOwn(PROFILE, constraint?.kind ?? '') ? PROFILE[constraint.kind] : null
  if (!Number.isFinite(asOf) || !['selection', 'diagnosis'].includes(query.intent) || !profile
      || !validConstraint(constraint, profile)) return empty('missing_query_context')

  const cases = index?.formatVersion === 1 && Array.isArray(index.cases) ? index.cases : []
  const currentGroup = cases.find((card) => card.caseId === query.caseId)?.caseGroupId ?? query.caseGroupId
  const ranked = []
  let needsAction = false
  for (const card of cases) {
    if (card.partition !== 'development' || card.provenance !== 'ai_simulated_scheduler_review'
        || card.operationalEligible !== false || card.intent !== query.intent
        || card.caseId === query.caseId || card.caseGroupId === currentGroup
        || !(timeOf(card.asOf) < asOf && timeOf(card.observableBy) <= asOf)) continue

    const comparison = compare(constraint, card.constraint, profile)
    if (!comparison) continue
    if (card.requires.some((capability) => query.capabilities?.[capability] !== true)) {
      needsAction = true
      continue
    }
    ranked.push({
      ...card, ...comparison,
      currentChecks: [...checksForConstraint(constraint), ...(card.action === 'resequence_with_berth_changes'
        ? ['이번 대체 선석의 가용 시간과 배치 변경 권한을 확인한다.'] : [])],
    })
  }

  ranked.sort((a, b) => b.score - a.score || timeOf(b.asOf) - timeOf(a.asOf) || a.caseId.localeCompare(b.caseId))
  const groups = new Set()
  const matches = ranked.filter((card) => {
    if (groups.has(card.caseGroupId)) return false
    groups.add(card.caseGroupId)
    return true
  }).slice(0, 3)
  if (!matches.length) return empty(needsAction ? 'action_unconfirmed' : 'no_match')
  return { status: 'matched', matches }
}
