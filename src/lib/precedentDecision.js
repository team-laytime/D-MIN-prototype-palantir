import { hashText } from './cache.js'

const CANDIDATE_KEYS = new WeakMap()
const JOURNAL_PREFIX = 'dmin-precedent-decision:'
const CANCEL_PREFIX = 'dmin-precedent-cancel:'

export function newDecisionId() {
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function candidateIdentity(candidate) {
  if (CANDIDATE_KEYS.has(candidate)) return CANDIDATE_KEYS.get(candidate)
  const placements = candidate.placements.map((p) => [p.vid, p.bid, p.etb, p.ws, p.wf, p.hose, p.etu, p.dem?.cents])
    .sort((a, b) => a[0].localeCompare(b[0]))
  const identity = {
    slot: candidate.id,
    displayPreset: candidate.preset?.id ?? null,
    appliedPreset: candidate.req?.request_id ?? candidate.resp?.request_id ?? null,
    engineVersion: candidate.resp?.engine?.version ?? null,
    paramsFingerprint: candidate.resp?.engine?.params_sha256 ?? null,
    requestKey: candidate.req ? hashText(JSON.stringify(candidate.req)) : null,
    placementKey: hashText(JSON.stringify(placements)),
  }
  CANDIDATE_KEYS.set(candidate, identity)
  return identity
}

export function snapshotCandidate(candidate, risk) {
  const data = risk?.state === 'done' ? risk.data : null
  const plan = candidate.resp?.plan
  return {
    ...candidateIdentity(candidate),
    parameters: plan ? candidate.resp.params ?? candidate.req?.params ?? null : null,
    expectedDemurrageCents: candidate.total ?? null,
    status: candidate.status ?? null,
    placementCount: candidate.placements.length,
    placements: candidate.placements,
    dropped: candidate.dropped ?? [],
    tankViolation: candidate.tankViolation ?? [],
    requirements: candidate.requirements ?? [],
    riskState: risk?.state ?? 'unavailable',
    riskModel: data?.model ?? null,
    risks: data?.risks ?? [],
  }
}

export function decisionScope(scen, version, selected, candidates) {
  return JSON.stringify([scen.id ?? scen.name, scen.request.start, version, selected.id, candidates.map(candidateIdentity)])
}

export function saveDecision(storage, decision) {
  const key = JOURNAL_PREFIX + decision.id
  const raw = storage.getItem(key)
  if (raw !== null) {
    const existing = JSON.parse(raw)
    if (existing.id !== decision.id || existing.scope !== decision.scope) {
      throw new Error('같은 저장 ID의 후보 버전이 다릅니다.')
    }
    return false
  }
  storage.setItem(key, JSON.stringify(decision))
  return true
}

export function saveCancellation(storage, cancellation) {
  const key = CANCEL_PREFIX + cancellation.id
  if (storage.getItem(key) === null) storage.setItem(key, JSON.stringify(cancellation))
}

export function decisionsFor(storage, scenarioId) {
  if (!storage) return []
  const decisions = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key?.startsWith(JOURNAL_PREFIX)) continue
    try {
      const decision = JSON.parse(storage.getItem(key))
      if (decision?.scenarioId !== scenarioId) continue
      const cancelled = storage.getItem(CANCEL_PREFIX + decision.id) !== null
      decisions.push({ ...decision, cancelled })
    } catch { /* A broken entry does not hide intact decisions. */ }
  }
  return decisions.sort((a, b) => b.at.localeCompare(a.at))
}
