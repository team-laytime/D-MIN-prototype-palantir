// 화면 전체가 공유하는 상태 한 곳. 화면 컴포넌트는 props 대신 useApp()으로 읽는다.
// 11-24: 목 데이터(가상 6척·부두 3곳)와 브라우저 안 전수 탐색을 걷어내고, 실데이터셋 + 팀 엔진(CP-SAT) 결과로 바꿨다.
//   - 데이터셋을 불러오면 후보 3개(엔진 프리셋별 계획)가 바로 있다.
//   - 계획 조건(ETA·부두 사용 불가·고정·파라미터)을 고치면 「다시 계산」으로 엔진 API에 보낸다(약 1분).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { buildScen, loadDataset, loadIndex, rankSims, recalc as engineRecalc } from '../lib/dataset.js'
import { setTimeBase } from '../lib/time.js'
import { diffScen } from '../lib/scenDiff.js'
import { ROLES, activePlan, canUse, groupOf, logActivity, recordChange, resetWorkspace, setRole, useWorkspace, ws } from '../lib/workspace.js'
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

  const open = useCallback(async (id) => {
    setLoadError(null)
    const ds = await loadDataset(id)
    setTimeBase(ds.results[0].response.window.start)
    const scen = buildScen(ds)
    scenarioIdRef.current = id
    setScenarioIdRaw(id)
    setDataset(ds)
    const v = scenRef.current.version + 1
    replaceScen({ scen, version: v })
    setCalc({ sims: rankSims(ds.results), version: v, error: null, running: false, at: ds.built_at })
  }, [replaceScen])

  useEffect(() => {
    loadIndex().then((idx) => { setDatasets(idx); if (idx.length) return open(idx.at(-1).id) })
      .catch((e) => setLoadError(e.message))
  }, [open])

  const setScenarioId = useCallback((id) => {
    if (id === scenarioIdRef.current) return
    logActivity('시나리오', '데이터셋 전환', id, `${scenarioIdRef.current} → ${id}`)
    open(id).catch((e) => setLoadError(e.message))
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
    const ctl = new AbortController(); abortRef.current = ctl
    setCalc((c) => ({ ...c, running: true, error: null }))
    logActivity('계산', '다시 계산 요청', s.name, `계획 조건 v${v}`)
    try {
      const results = await engineRecalc(s, ctl.signal)
      setCalc({ sims: rankSims(results), version: v, error: null, running: false, at: new Date().toLocaleString('ko-KR') })
      logActivity('계산', '다시 계산 완료', s.name, results.map((r) => `${r.preset.label} ${r.response.status}`).join(', '))
    } catch (e) {
      if (e.name === 'AbortError') return
      setCalc((c) => ({ ...c, running: false, error: e.message }))
    }
  }, [])

  const result = useMemo(() => ({
    candidates: calc.sims,
    error: loadError ?? (scen ? null : '데이터셋을 불러오는 중입니다'),
    loading: !scen && !loadError,
    stale: !!scen && calc.version !== version, // 계획 조건이 후보 계산 뒤에 바뀜
    running: calc.running, calcError: calc.error, calcAt: calc.at,
    baseline: calc.sims[0]?.baseline ?? null, // 실제 계획(실제 부두·실제 접안)
  }), [calc, scen, version, loadError])
  const all = result.candidates

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
  const drawerSim = drawer && (all.find((s) => s.id === drawer.simId) ?? all[0])

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

  // 돌발 상황을 「반영」하면 부두 사용 불가 구간(blocks)으로 계획 조건에 들어간다(되돌리면 뺀다).
  const applyIncident = useCallback((incId, on) => editScen((d) => {
    const inc = d.incidents.find((i) => i.id === incId)
    d.blocks = d.blocks.filter((b) => b.incId !== incId)
    if (on && inc?.block) d.blocks.push({ ...inc.block, incId, source: `돌발 상황: ${inc.title}` })
  }), [editScen])

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
    checks, setCheck, current, tour, reportDraft, setReportDraft,
    mailFilter, setMailFilter, applyIncident,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
