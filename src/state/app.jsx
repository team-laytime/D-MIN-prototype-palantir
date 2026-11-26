// 화면 전체가 공유하는 상태 한 곳. 화면 컴포넌트는 props 대신 useApp()으로 읽는다.
// 11-24: 목 데이터(가상 6척·부두 3곳)와 브라우저 안 전수 탐색을 걷어내고, 실데이터셋 + 팀 엔진(CP-SAT) 결과로 바꿨다.
//   - 데이터셋을 불러오면 후보 3개(엔진 프리셋별 계획)가 바로 있다.
//   - 계획 조건(ETA·부두 사용 불가·고정·파라미터)을 고치면 「다시 계산」으로 엔진 API에 보낸다(약 1분).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { buildRequest, buildScen, engineFacts, fetchRisks, initialResults, loadDataset, loadIndex, rankSims, recalc as engineRecalc, scenarioIdOf } from '../lib/dataset.js'
import { setTimeBase } from '../lib/time.js'
import { applyChange } from '../lib/incidents.js'
import { chooseB, presetsFor } from '../lib/presets.js'
import { diffScen } from '../lib/scenDiff.js'
import { ROLES, activePlan, canUse, groupOf, logActivity, nowText, recordChange, resetWorkspace, restoreAlertStatus, setAlertStatus, setRole, useWorkspace, ws } from '../lib/workspace.js'
import { TOUR as TOUR_ALL } from '../tour.js'

const TOUR = TOUR_ALL.filter((s) => groupOf(s.tab === 'risk' ? 'compare' : s.tab)).map((s) => (s.tab === 'risk' ? { ...s, tab: 'compare' } : s))

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)
const EMPTY_DRAFT = { selId: null, judgment: null, mail: {} }

export function AppProvider({ children }) {
  const wsRev = useWorkspace()

  // ── 데이터셋 ───────────────────────────────────────────────────────
  const [datasets, setDatasets] = useState([])
  const [scenarioId, setScenarioIdRaw] = useState(null)
  const [dataset, setDataset] = useState(null)
  const [loadError, setLoadError] = useState(null)
  // 시나리오: 편집은 editScen(draft => { ... })로 복사본을 고쳐 통째로 바꾼다. 바뀔 때마다 version이 오른다.
  const [scenState, setScenState] = useState({ scen: null, version: 0 })
  const scenRef = useRef(scenState)
  const scenarioIdRef = useRef(scenarioId)
  const replaceScen = useCallback((next) => { scenRef.current = next; setScenState(next) }, [])
  // 후보: 엔진 결과. version = 이 후보들을 계산한 계획 조건 버전(지금 버전과 다르면 다시 계산 필요).
  const [calc, setCalc] = useState({ sims: [], version: 0, error: null, running: false, at: null })
  const calcRef = useRef(calc)
  calcRef.current = calc

  // 「단독 반영 시」 미리 계산 결과 (아래 '반영하면?' 부분 설명 참고)
  const [whatIf, setWhatIf] = useState({})
  const whatIfRef = useRef(whatIf)
  whatIfRef.current = whatIf
  // 11-26 처음 열 때 후보 계산 진행 {step: 'A' | 'BC', since} (데이터셋에 결과가 없고 브라우저 저장소에도 없을 때 몇 분)
  const [boot, setBoot] = useState(null)
  const bootRef = useRef(null)
  const bootCalcRef = useRef(null) // 처음 여는 후보 계산(A → B · C)이 도는 동안의 AbortController — 다시 계산하면 버린다
  const open = useCallback(async (id) => {
    setLoadError(null)
    bootRef.current?.abort()
    const ctl = new AbortController(); bootRef.current = ctl
    // 11-26 다른 기준 시각을 고르면 앞 화면을 비우고(불러오는 중) 그 시각의 하역 속도부터 받는다
    if (scenRef.current.scen && scenarioIdRef.current !== id) {
      replaceScen({ scen: null, version: scenRef.current.version + 1 })
      setCalc({ sims: [], version: 0, error: null, running: false, at: null })
    }
    setScenarioIdRaw(id) // 고른 기준 시각을 불러오는 동안에도 상단에 보인다
    if (id.includes('@')) setBoot({ step: 'rates', since: Date.now() })
    let ds
    try {
      ds = await loadDataset(id, ctl.signal)
    } catch (e) {
      if (ctl.signal.aborted) return
      throw e
    } finally { if (bootRef.current === ctl) setBoot(null) }
    if (ctl.signal.aborted) return
    setTimeBase(ds.request.start)
    // 11-26 계획 조건 · 운영 현황은 요청만으로 바로 띄운다. 후보는 데이터셋에 없으면 이어서 계산(브라우저 저장소에 있으면 바로)
    let scen = buildScen(ds)
    scenarioIdRef.current = id
    setScenarioIdRaw(id)
    setDataset(ds)
    const v = scenRef.current.version + 1
    replaceScen({ scen, version: v })
    if (!ds.results?.length) {
      setCalc({ sims: [], version: v, error: null, running: true, at: null })
      try {
        // 11-26 A가 끝나면 바로 A만 보인다(B · C 자리는 「계산 중」, pending = 남은 후보 수). B · C는 이어서 뒤에서 계산
        const onA = (a) => {
          const cur = scenRef.current
          const sa = { ...cur.scen, ...engineFacts(ds, a.response) }
          replaceScen({ scen: sa, version: cur.version })
          setCalc({ sims: rankSims([{ ...a, request: buildRequest(sa, a.preset) }]), version: cur.version, error: null, running: false, pending: 2, at: null })
        }
        bootCalcRef.current = ctl
        ds.results = await initialResults(ds, (step) => setBoot({ step, since: Date.now() }), ctl.signal, onA)
        ds.built_at = nowText().slice(0, 16)
      } catch (e) {
        if (ctl.signal.aborted) return // 다른 데이터셋을 열었거나 다시 열림 — 그쪽이 이어서 계산한다
        setCalc((c) => ({ ...c, running: false, pending: 0, error: `후보를 계산하지 못했습니다: ${e.message}` }))
        return
      } finally { if (bootRef.current === ctl) setBoot(null); if (bootCalcRef.current === ctl) bootCalcRef.current = null }
      if (ctl.signal.aborted) return
      // 엔진만 아는 값(탱크 재고 등)을 채운다. 그사이 스케줄러가 계획 조건을 고쳤어도 그 값은 그대로 둔다
      const cur = scenRef.current
      scen = { ...cur.scen, ...engineFacts(ds, ds.results[0].response) }
      replaceScen({ scen, version: cur.version })
    }
    // 데이터셋 결과는 요청을 따로 담지 않는다. 같은 계획 조건으로 다시 만들어 리스크 모델에 보낸다.
    const sims = rankSims(ds.results.map((r) => ({ ...r, request: buildRequest(scen, r.preset) })))
    // B 칸의 '고른 이유'는 데이터셋을 만들 때 쓴 σ로 적혀 있다. 지금 규칙으로 다시 골라 같은 안이면 이유만 새로 쓴다
    const nb = sims[0] && sims[1] && chooseB(scen, sims[0])
    if (nb && nb.id === sims[1].preset?.id) sims[1] = { ...sims[1], preset: { ...sims[1].preset, why: nb.why, grades: nb.grades } }
    // A만 보이던 상태(pending)이거나 처음이면 채운다. 그사이 스케줄러가 다시 계산했으면 그 결과를 덮지 않는다
    setCalc((c) => (c.running || (c.sims.length && !c.pending) ? c : { sims, version: scenRef.current.version, error: null, running: false, at: ds.built_at }))
    // 메일별 「단독 반영 시」는 화면이 뒤에서 계산한다(엔진 결과는 브라우저 저장소에 남아 다음부터는 바로)
    setWhatIf({})
  }, [replaceScen])

  useEffect(() => {
    // 11-26 1년치 데이터셋은 기본 기준 시각으로 연다 (상단에서 날짜 · 시각을 고른다)
    loadIndex().then((idx) => { setDatasets(idx); const d = idx.at(-1); if (d) return open(d.kind === 'year' ? scenarioIdOf(d.id, d.default_start) : d.id) })
      .catch((e) => { if (e.name !== 'AbortError') setLoadError(e.message) })
  }, [open])

  const setScenarioId = useCallback((id) => {
    if (id === scenarioIdRef.current) return
    logActivity('시나리오', '데이터셋 전환', id, `${scenarioIdRef.current} → ${id}`)
    open(id).catch((e) => { if (e.name !== 'AbortError') setLoadError(e.message) })
  }, [open])

  const { scen, version } = scenState
  const editScen = useCallback((fn) => {
    const prev = scenRef.current
    const draft = structuredClone(prev.scen)
    fn(draft)
    replaceScen({ scen: draft, version: prev.version + 1 })
    for (const change of diffScen(prev.scen, draft)) recordChange(scenarioIdRef.current, change)
  }, [replaceScen])

  // 다시 계산: 지금 계획 조건으로 엔진 API를 부른다(프리셋 3개 동시).
  const abortRef = useRef(null)
  const recalc = useCallback(async () => {
    const { scen: s, version: v } = scenRef.current
    abortRef.current?.abort()
    // 11-26 처음 여는 후보 계산이 아직 돌고 있으면 버린다(엔진 대기열의 그 작업도 취소) — 지금 계획 조건 계산이 먼저
    if (bootCalcRef.current) { bootCalcRef.current.abort(); bootCalcRef.current = null; setBoot(null) }
    const ctl = new AbortController(); abortRef.current = ctl
    const prev = calcRef.current.sims
    setCalc((c) => ({ ...c, running: true, pending: 0, error: null }))
    logActivity('계산', '다시 계산 요청', s.name, `계획 조건 v${v}`)
    try {
      let results
      if (prev.length) {
        // B는 지금 A 계획 · 계획 조건으로 다시 고른다(상황형 자리)
        results = await engineRecalc(s, ctl.signal, presetsFor(s, prev))
      } else {
        // A가 아직 없으면(처음 계산 중에 다시 계산) 처음 열 때처럼 A를 먼저 보이고 → A로 고른 B · C
        const [a] = await engineRecalc(s, ctl.signal, [s.presets[0]])
        const simsA = rankSims([a])
        setCalc({ sims: simsA, version: v, error: null, running: true, pending: 2, at: null })
        const [b, c] = await engineRecalc(s, ctl.signal, [chooseB(s, simsA[0]), s.presets[2]])
        results = [a, b, c]
      }
      setCalc({ sims: rankSims(results), version: v, error: null, running: false, at: nowText().slice(0, 16) })
      logActivity('계산', '다시 계산 완료', s.name, results.map((r) => `${r.preset.label} ${r.response.status}`).join(', '))
    } catch (e) {
      if (e.name === 'AbortError') return
      setCalc((c) => ({ ...c, running: false, pending: 0, error: e.message }))
    }
  }, [])

  // 11-25 리스크: 후보가 바뀔 때마다 팀 리스크 모델(POST /risk/risks)로 후보마다 계산한다(약 5초). 계획과 따로 실패할 수 있다.
  //   risks[simId] = {state: 'running'|'done'|'error', data, error}. 다시 계산하는 동안에는 직전 결과를 흐리게 보인다.
  const [risks, setRisks] = useState({})
  const risksRef = useRef(risks)
  risksRef.current = risks
  useEffect(() => {
    if (!calc.sims.length) return
    const ctl = new AbortController()
    // 같은 엔진 응답의 리스크는 다시 묻지 않는다 (A만 먼저 보인 뒤 B · C가 들어올 때 A 리스크가 깜빡이지 않게)
    const keep = (r, s) => r?.resp === s.resp && r.state === 'done'
    setRisks((prev) => Object.fromEntries(calc.sims.map((s) => [s.id, keep(prev[s.id], s) ? prev[s.id] : { state: 'running', data: null, error: null, resp: s.resp }])))
    for (const s of calc.sims) {
      if (keep(risksRef.current[s.id], s)) continue
      if (!s.req) { setRisks((r) => ({ ...r, [s.id]: { state: 'error', data: null, error: '요청 원문이 없어 리스크를 계산하지 못했습니다' } })); continue }
      fetchRisks(s.req, s.resp, ctl.signal)
        .then((data) => setRisks((r) => ({ ...r, [s.id]: { state: 'done', data, error: null, resp: s.resp } })))
        .catch((e) => { if (e.name !== 'AbortError') setRisks((r) => ({ ...r, [s.id]: { state: 'error', data: null, error: e.message } })) })
    }
    return () => ctl.abort()
  }, [calc.sims])

  const result = useMemo(() => ({
    candidates: calc.sims,
    error: loadError ?? (scen ? null : '데이터셋을 불러오는 중입니다'),
    loading: !scen && !loadError, boot,
    stale: !!scen && calc.version !== version, // 계획 조건이 후보 계산 뒤에 바뀜
    running: calc.running, pending: calc.pending ?? 0, calcError: calc.error, calcAt: calc.at,
    // 11-25 엔진 baseline은 "다른 스케줄러가 미리 세워 둔 기존 계획"으로 가정한다(사용자 결정).
    //   지금은 계획 조건의 탱크 재고 흐름에만 쓰고(scen.tanks[].base), 후보안과 비교하는 화면에는 아직 넣지 않았다.
    baseline: null,
  }), [calc, scen, version, loadError, boot])
  const all = result.candidates

  // ── 11-25 「반영하면?」 미리 계산 ─────────────────────────────────────
  //   반영 여부를 정하지 않은 조건 변경 메일마다, 지금 계획 조건 + 그 변경 하나로 후보 A · B · C를 엔진에 미리 돌려 둔다(한 단계만).
  //   결정(decideMails)은 여러 메일을 한꺼번에: 고른 것은 반영, 나머지는 반영 안 함으로 모두 해소된다. 하나만 반영하고 미리 계산이
  //   끝나 있으면 그 A · B · C로 바로 바꾸고, 여럿이면 다시 계산한다. 결정 뒤에는 더 나아가지 않고 「결정 되돌리기」로 전으로 돌아간다.
  //   메일 하나씩 차례로(엔진 작업자 3개를 후보 3개가 씀). 후보가 지금 조건으로 계산돼 있을 때만 돈다.
  //   whatIf[`${version}:${incId}`] = {state: 'running'|'done'|'error', sims[A,B,C], t0, error}
  const pendingIncs = useMemo(() => (scen?.incidents ?? []).filter((i) => {
    const s = ws.inbox[`inc:${scenarioIdRef.current}:${i.id}`]?.status
    return i.change && s !== 'applied' && s !== 'dismissed'
  }), [scen, wsRev]) // eslint-disable-line react-hooks/exhaustive-deps
  const pendingKey = pendingIncs.map((i) => i.id).join(',') // 체크 같은 다른 기록 변경에는 미리 계산을 멈추지 않게
  const pendingRef = useRef(pendingIncs)
  pendingRef.current = pendingIncs
  const whatIfKey = useCallback((incId) => `${scenRef.current.version}:${incId}`, [])
  const [wiTick, setWiTick] = useState(0) // 엔진이 바빠(429) 못 한 미리 계산을 1분 뒤 다시 돌리는 신호
  useEffect(() => {
    if (!scen || calc.running || calc.pending || calc.version !== version || !all.length) return
    const todo = pendingIncs.filter((i) => !whatIfRef.current[`${version}:${i.id}`])
    if (!todo.length) return
    const ctl = new AbortController()
    const put = (key, patch) => setWhatIf((w) => ({ ...w, [key]: { ...w[key], ...patch } }))
    ;(async () => {
      for (const inc of todo) {
        if (ctl.signal.aborted) return
        const key = `${version}:${inc.id}`
        put(key, { state: 'running', incId: inc.id, t0: Date.now() })
        try {
          const d = structuredClone(scen)
          applyChange(d, inc, true)
          const results = await engineRecalc(d, ctl.signal, presetsFor(d, all))
          put(key, { state: 'done', sims: rankSims(results) })
        } catch (e) {
          if (e.name === 'AbortError') { setWhatIf((w) => { const n = { ...w }; delete n[key]; return n }); return }
          if (/가득|429|Too Many/.test(e.message)) { // 엔진이 바쁨: 1분 뒤 다시
            put(key, { state: 'queued' })
            setTimeout(() => { setWhatIf((w) => { const n = { ...w }; delete n[key]; return n }); setWiTick((t) => t + 1) }, 60000)
            return
          }
          put(key, { state: 'error', error: e.message })
        }
      }
    })()
    return () => ctl.abort()
  }, [scen, version, calc.running, calc.pending, calc.version, all, pendingKey, wiTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTab] = useState('home')
  const [focusId, setFocusId] = useState('A')
  // 메일함에서 처음 펼칠 분류(왼쪽 메뉴의 「돌발 상황」을 누르면 'incident')
  const [mailFilter, setMailFilter] = useState('all')
  useEffect(() => {
    setFocusId((id) => (all.some((c) => c.id === id) ? id : all[0]?.id ?? 'A'))
  }, [all])

  // 선박 카드. at = 지도 시각(지도에서 열 때만), mode = 'card' | 'evidence'
  const [drawer, setDrawer] = useState(null)
  const openVessel = useCallback((simId, vid, opts = {}) => setDrawer({ simId, vid, at: opts.at ?? null, mode: opts.mode ?? 'card' }), [])
  const closeDrawer = useCallback(() => setDrawer(null), [])
  const drawerSim = drawer && (drawer.simId === 'existing' ? scen?.existing : all.find((s) => s.id === drawer.simId) ?? all[0] ?? scen?.existing) // 운영 현황의 기존 계획

  const role = ws.roleId ? ROLES[ws.roleId] : null
  const isScheduler = ws.roleId === 'scheduler'

  // 권한 밖 화면을 가리키면 그 계정의 첫 화면으로 보낸다.
  const go = useCallback((target) => {
    const next = target === 'risk' ? 'compare' : target === 'report' ? 'mail' : target
    const g = groupOf(next)
    setTab(ws.roleId && g && !canUse(ws.roleId, g) ? ROLES[ws.roleId].home : next)
  }, [])

  // 리스크 확인 체크(스케줄러). 키는 `${candId}:${riskKey}`.
  const [checks, setChecks] = useState({})
  const setCheck = useCallback((key, on) => setChecks((c) => ({ ...c, [key]: on })), [])

  const plan = activePlan()
  const current = useMemo(() => (plan
    ? { candId: plan.candId, label: plan.label, total: plan.total, reason: plan.reason, version: plan.version, planNo: plan.no, status: `확정 v${plan.no}` }
    : null), [plan, wsRev]) // eslint-disable-line react-hooks/exhaustive-deps

  const [reportDraft, setReportDraftRaw] = useState(EMPTY_DRAFT)
  const setReportDraft = useCallback((patch) => setReportDraftRaw((d) => ({ ...d, ...patch })), [])

  // 받은 메일(조건 변경 요청)을 「반영」하면 그 change가 계획 조건에 들어간다(되돌리면 뺀다): ETA · 부두 사용 불가 · 고정 · 엔진 조절값
  //   11-25 미리 계산(whatIf)이 끝나 있으면 다시 계산하지 않고 그 A · B · C로 바로 바꾼다. 바꿨으면 true
  const applyIncident = useCallback((incId, on) => {
    const v0 = scenRef.current.version
    const pre = on ? whatIfRef.current[`${v0}:${incId}`] : null
    const fresh = calcRef.current.version === v0 && !calcRef.current.running
    editScen((d) => {
      const inc = d.incidents.find((i) => i.id === incId)
      if (inc) applyChange(d, inc, on)
    })
    if (pre?.state === 'done' && fresh) {
      setCalc({ sims: pre.sims, version: scenRef.current.version, error: null, running: false, at: nowText().slice(0, 16) })
      return true
    }
    return false
  }, [editScen])

  // ── 11-25 조건 변경 결정 (후보 비교) ─────────────────────────────────
  //   mailDecision = {applied: [incId], dismissed: [incId], at, snap: {scen, version, calc, whatIf, statuses}} — 되돌리기용으로 결정 전 상태를 통째로 둔다
  const [mailDecision, setMailDecision] = useState(null)
  const mailDecisionRef = useRef(null)
  mailDecisionRef.current = mailDecision
  const alertIdOf = (incId) => `inc:${scenarioIdRef.current}:${incId}`
  const decideMails = useCallback((applyIds) => {
    const { scen: s0, version: v0 } = scenRef.current
    const c0 = calcRef.current
    const pend = pendingRef.current
    if (!pend.length) return
    const statuses = Object.fromEntries(pend.map((i) => [alertIdOf(i.id), ws.inbox[alertIdOf(i.id)] ?? null]))
    const keep = Object.fromEntries(Object.entries(whatIfRef.current).filter(([k]) => k.startsWith(`${v0}:`)))
    const pre = applyIds.length === 1 ? whatIfRef.current[`${v0}:${applyIds[0]}`] : null
    const fresh = c0.version === v0 && !c0.running
    if (applyIds.length) editScen((d) => { for (const i of d.incidents) if (applyIds.includes(i.id)) applyChange(d, i, true) })
    for (const i of pend) setAlertStatus(alertIdOf(i.id), applyIds.includes(i.id) ? 'applied' : 'dismissed', `[${i.kind}] ${i.title}`)
    setMailDecision({ applied: applyIds, dismissed: pend.filter((i) => !applyIds.includes(i.id)).map((i) => i.id), at: nowText(), snap: { scen: s0, version: v0, calc: c0, whatIf: keep, statuses } })
    logActivity('입력', '조건 변경 결정', `반영 ${applyIds.length}건 · 반영 안 함 ${pend.length - applyIds.length}건`)
    if (!applyIds.length) { if (!fresh) recalc(); return } // 반영 없음: 조건이 이미 바뀌어 있었으면 그대로 다시 계산
    if (pre?.state === 'done' && fresh) setCalc({ sims: pre.sims, version: scenRef.current.version, error: null, running: false, at: nowText().slice(0, 16) })
    else recalc()
  }, [editScen, recalc]) // eslint-disable-line react-hooks/exhaustive-deps
  const undoMailDecision = useCallback(() => {
    const md = mailDecisionRef.current
    if (!md) return
    abortRef.current?.abort()
    const v = scenRef.current.version + 1
    replaceScen({ scen: md.snap.scen, version: v })
    const c = md.snap.calc
    setCalc({ ...c, running: false, version: c.version === md.snap.version ? v : c.version })
    setWhatIf((w) => ({ ...w, ...Object.fromEntries(Object.values(md.snap.whatIf).map((e) => [`${v}:${e.incId}`, e])) }))
    for (const [id, prev] of Object.entries(md.snap.statuses)) restoreAlertStatus(id, prev)
    setMailDecision(null)
    logActivity('입력', '조건 변경 결정 되돌림', `반영 ${md.applied.length}건 · 반영 안 함 ${md.dismissed.length}건 취소`)
  }, [replaceScen])

  // 사용법 투어. 스케줄러 업무 흐름을 따라가므로 스케줄러 계정에만 있다.
  const [tourIdx, setTourIdx] = useState(null)
  const showTourStep = useCallback((i) => {
    const s = TOUR[i]
    setTourIdx(i)
    setDrawer(null)
    if (s.tab === 'compare') setFocusId(all[0]?.id ?? 'A')
    setTab(s.tab)
    s.do?.({ result, openVessel })
  }, [all, result, openVessel])
  const tour = useMemo(() => ({
    steps: TOUR,
    index: tourIdx,
    start: () => showTourStep(0),
    end: () => { setTourIdx(null); setDrawer(null) },
    next: () => (tourIdx < TOUR.length - 1 ? showTourStep(tourIdx + 1) : (setTourIdx(null), setDrawer(null))),
    prev: () => tourIdx > 0 && showTourStep(tourIdx - 1),
  }), [tourIdx, showTourStep])

  const [resetKey, setResetKey] = useState(0)
  const login = useCallback((id) => { setRole(id); setTab(ROLES[id].home) }, [])
  const logout = useCallback(() => { setRole(null); setDrawer(null); setTourIdx(null) }, [])
  // 시연 초기화: 확정 기록·리스크 확인·입력을 처음 값으로 되돌리고 운영 현황으로 돌아간다.
  const resetDemo = useCallback(() => {
    resetWorkspace()
    setChecks({})
    setMailDecision(null)
    setWhatIf({})
    setReportDraftRaw(EMPTY_DRAFT)
    setDrawer(null)
    setTourIdx(null)
    setFocusId('A')
    setResetKey((k) => k + 1)
    setTab('home')
    if (scenarioIdRef.current) open(scenarioIdRef.current)
  }, [open])

  const value = {
    wsRev, role, isScheduler, login, logout, resetDemo, resetKey,
    datasets, dataset, scenarioId, setScenarioId, scen, scenInput: scen, editScen, version, result, all, recalc,
    tab, go, focusId, setFocusId,
    drawer, drawerSim, openVessel, closeDrawer,
    checks, setCheck, current, tour, reportDraft, setReportDraft, risks,
    whatIf, whatIfKey, pendingIncs, mailDecision, decideMails, undoMailDecision,
    mailFilter, setMailFilter, applyIncident,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
