// 화면 전체가 공유하는 상태 한 곳. 화면 컴포넌트는 props 대신 useApp()으로 읽는다.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { SCENARIOS } from '../lib/scenarios.js'
import { runSearch } from '../lib/engine.js'
import { ROLES, activePlan, canUse, groupOf, resetWorkspace, setRole, useWorkspace, ws } from '../lib/workspace.js'
import { TOUR } from '../tour.js'

const Ctx = createContext(null)
export const useApp = () => useContext(Ctx)

export function AppProvider({ children }) {
  const wsRev = useWorkspace()

  // 시나리오: 편집은 editScen(draft => { ... })로 복사본을 고쳐 통째로 바꾼다. 바뀔 때마다 version이 오른다.
  const [scenarioId, setScenarioIdRaw] = useState('S1')
  const [scenState, setScenState] = useState(() => ({ scen: SCENARIOS.S1(), version: 1 }))
  const { scen, version } = scenState
  const setScenarioId = useCallback((id) => {
    setScenarioIdRaw(id)
    setScenState((s) => ({ scen: SCENARIOS[id](), version: s.version + 1 }))
  }, [])
  const editScen = useCallback((fn) => {
    setScenState((s) => {
      const draft = structuredClone(s.scen)
      fn(draft)
      return { scen: draft, version: s.version + 1 }
    })
  }, [])

  // 6척 × 720 순서 × 8 배정 = 5,760안 전수 탐색. 시나리오가 바뀔 때만 다시 돈다.
  const result = useMemo(() => runSearch(scen), [scen])
  const all = useMemo(() => (result.error ? [] : [result.fcfs, ...result.candidates]), [result])

  const [tab, setTab] = useState('home')
  const [focusId, setFocusId] = useState('A')
  // 원본과 같이 결과가 바뀔 때만 확인한다. 기준안(FCFS)을 고른 상태는 그대로 둔다.
  useEffect(() => {
    if (result.error) return
    setFocusId((id) => (id === 'FCFS' || result.candidates.some((c) => c.id === id) ? id : result.candidates[0]?.id ?? 'FCFS'))
  }, [result])

  // 선박 카드. at = 지도 시각(지도에서 열 때만), mode = 'card' | 'evidence'
  const [drawer, setDrawer] = useState(null)
  const openVessel = useCallback((simId, vid, opts = {}) => setDrawer({ simId, vid, at: opts.at ?? null, mode: opts.mode ?? 'card' }), [])
  const closeDrawer = useCallback(() => setDrawer(null), [])
  const drawerSim = drawer && all.find((s) => s.id === drawer.simId)

  const role = ws.roleId ? ROLES[ws.roleId] : null
  const isScheduler = ws.roleId === 'scheduler'

  // 권한 밖 화면을 가리키면 그 계정의 첫 화면으로 보낸다.
  const go = useCallback((next) => {
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

  // 사용법 투어. 스케줄러 업무 흐름을 따라가므로 스케줄러 계정에만 있다.
  const [tourIdx, setTourIdx] = useState(null)
  const showTourStep = useCallback((i) => {
    const s = TOUR[i]
    setTourIdx(i)
    setDrawer(null)
    if (s.tab === 'compare') setFocusId(result.candidates[0]?.id ?? 'FCFS')
    setTab(s.tab)
    s.do?.({ result, openVessel })
  }, [result, openVessel])
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
  // 시연 초기화: 확정 기록·리스크 확인·입력을 처음 값으로 되돌리고 로그인 화면으로 돌아간다.
  const resetDemo = useCallback(() => {
    resetWorkspace()
    setChecks({})
    setScenState((s) => ({ scen: SCENARIOS[scenarioId](), version: s.version + 1 }))
    setDrawer(null)
    setTourIdx(null)
    setFocusId('A')
    setResetKey((k) => k + 1)
    setTab('home')
  }, [scenarioId])

  const value = {
    wsRev, role, isScheduler, login, logout, resetDemo, resetKey,
    scenarioId, setScenarioId, scen, editScen, version, result, all,
    tab, go, focusId, setFocusId,
    drawer, drawerSim, openVessel, closeDrawer,
    checks, setCheck, current, tour,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
