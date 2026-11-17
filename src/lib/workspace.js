// 계정 · 메뉴 권한 · 업무 기록(시연용, 새로고침하면 사라짐).
// 계정은 둘이다. 일정을 짜는 스케줄러와 확정된 일정을 받아 쓰는 이용자. 로그인할 때 역할이 정해지고, 그 역할의 메뉴만 보인다.
//   HN-092 확정·취소는 스케줄러만 · HN-094 이용자는 확정본만 · HN-095 요율·금액은 스케줄러만
// Vue 원본의 reactive 대신 작은 외부 저장소로 두고, React는 useWorkspace()로 구독한다.
import { useSyncExternalStore } from 'react'

export const PASSWORD = '1234'
export const ROLES = {
  scheduler: { id: 'scheduler', name: '스케줄러 A', title: '선박 스케줄러', loginId: 'scheduler', home: 'home', desc: '접안 계획 작성·비교·확정' },
  user: { id: 'user', name: '이용자 B', title: '일정 이용자', loginId: 'user', home: 'ops', desc: '확정된 접안 일정 조회' },
}

// 왼쪽 레일 = 묶음. roles에 없는 계정에게는 어디에도 나오지 않는다. icon은 Blueprint 아이콘 이름.
export const NAV = [
  { key: 'DASHBOARD', code: 'COP', gnb: '운영 현황', roles: ['scheduler'], items: [{ id: 'home', label: '운영 현황', icon: 'globe-network' }] },
  { key: 'BERTH PLANNING', code: 'PLAN', gnb: '접안 계획', roles: ['scheduler'], items: [
    { id: 'input', label: '시나리오 입력', icon: 'properties' },
    { id: 'compare', label: '후보 비교', icon: 'comparison' },
    { id: 'risk', label: '리스크·확정', icon: 'shield' },
  ] },
  { key: 'REPORT', code: 'RPT', gnb: '보고서', roles: ['scheduler'], items: [
    { id: 'report', label: '접안계획 보고서', icon: 'document' },
    { id: 'mail', label: '메일 작성', icon: 'envelope' },
  ] },
  { key: 'QUALITY', code: 'QA', gnb: '검증', roles: ['scheduler'], items: [{ id: 'verify', label: '계산 검증', icon: 'endorsed' }] },
  { key: 'SCHEDULE', code: 'SCHED', gnb: '확정 일정', roles: ['user'], items: [{ id: 'ops', label: '확정 접안 일정', icon: 'timeline-events' }] },
]

export const canUse = (roleId, group) => group.roles.includes(roleId)
export const groupOf = (tab) => NAV.find((g) => g.items.some((i) => i.id === tab))
export const itemOf = (tab) => NAV.flatMap((g) => g.items).find((i) => i.id === tab)
export const nowText = () => new Date().toLocaleString('ko-KR', { hour12: false })

const fresh = () => ({
  roleId: null, // 로그인 전
  plans: [], // 확정 이력 {no, candId, label, total, reason, uncheckedRisks, at, who, version, placements, cancelled}
  log: [], // 확정·취소 기록(추가만)
})

// 저장소 자체는 제자리에서 바뀌고, rev가 바뀌어야 React가 다시 그린다.
export const ws = fresh()
let rev = 0
const listeners = new Set()
const emit = () => { rev++; for (const l of listeners) l() }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
/** 구독용 훅. 반환값 rev는 의존성 배열에 넣어 다시 계산할 때 쓴다. */
export const useWorkspace = () => useSyncExternalStore(subscribe, () => rev)

export function resetWorkspace() { Object.assign(ws, fresh()); emit() }
export function setRole(roleId) { ws.roleId = roleId; emit() }

export const role = () => ROLES[ws.roleId]
function addLog(action, target, detail = '') {
  const r = role()
  ws.log.push({ at: nowText(), who: r.name, roleTitle: r.title, action, target, detail })
}

/** 지금 적용 중인 확정 계획(마지막 확정, 취소 안 됨). */
export const activePlan = () => {
  const p = ws.plans.at(-1)
  return p && !p.cancelled ? p : null
}

/** 스케줄러 확정. 이후 입력이 바뀌어도 이용자는 확정 당시 일정을 본다(스냅숏). */
export function fixPlan({ cand, scen, version, reason, uncheckedRisks }) {
  const v = Object.fromEntries(scen.vessels.map((x) => [x.id, x]))
  const bn = (id) => scen.berths.find((b) => b.id === id)?.name
  const plan = {
    no: ws.plans.length + 1, candId: cand.id, label: cand.label, total: cand.total, reason, uncheckedRisks,
    at: nowText(), who: role().name, version, cancelled: false,
    placements: [...cand.placements].sort((a, b) => a.etb - b.etb).map((p) => ({
      vid: p.vid, name: v[p.vid].name, product: v[p.vid].product, dir: v[p.vid].dir, ton: v[p.vid].ton, dwt: v[p.vid].dwt,
      eta: v[p.vid].eta, bid: p.bid, berth: bn(p.bid), etb: p.etb, etu: p.etu,
    })),
  }
  ws.plans.push(plan)
  addLog('계획 확정', `접안 계획 v${plan.no} · ${cand.label}`, reason)
  emit()
  return plan
}
export function cancelPlan(reason) {
  const p = activePlan()
  if (!p) return
  p.cancelled = true
  addLog('확정 취소', `접안 계획 v${p.no} · ${p.label}`, reason)
  emit()
}
