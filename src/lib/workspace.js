// 계정 · 메뉴 권한 · 업무 기록(시연용, 새로고침하면 사라짐).
// 계정은 둘이다. 일정을 짜는 스케줄러와 확정된 일정을 받아 쓰는 이용자. 로그인할 때 역할이 정해지고, 그 역할의 메뉴만 보인다.
//   HN-092 확정·취소는 스케줄러만 · HN-094 이용자는 확정본만 · HN-095 요율·금액은 스케줄러만
// Vue 원본의 reactive 대신 작은 외부 저장소로 두고, React는 useWorkspace()로 구독한다.
import { useSyncExternalStore } from 'react'

export const PASSWORD = '1234'
// 11-25 시스템 관리자 시연 계정: 로그인하면 관리자 화면(?view=admin)으로 간다. 비밀번호는 다른 시연 계정과 같다.
export const ADMIN_LOGIN_ID = 'admin'
export const ROLES = {
  scheduler: { id: 'scheduler', name: '스케줄러 A', title: '선박 스케줄러', loginId: 'scheduler', home: 'home', desc: '접안 계획 작성·비교·확정' },
  user: { id: 'user', name: '이용자 B', title: '일정 이용자', loginId: 'user', home: 'ops', desc: '확정된 접안 일정 조회', myBerth: 'B2', team: '3부두 하역 1팀', mail: 'sk3-ops@example.com' },
  // 11-26 계약 문서 담당(임시): C/P · recap · 매매 확인서를 넣고 파서 추출값을 검토한다
  contract: { id: 'contract', name: '계약 담당 C', title: '계약 문서 담당', loginId: 'contract', home: 'docs', desc: '계약 문서 등록, 추출값 검토' },
}

// 왼쪽 레일 = 묶음. roles에 없는 계정에게는 어디에도 나오지 않는다. icon은 Blueprint 아이콘 이름.
export const NAV = [
  { key: 'DASHBOARD', label: '운영', roles: ['scheduler'], items: [{ id: 'home', label: '운영 현황', icon: 'globe-network' }] },
  // 11-24 최최종: 알림함 → 메일함. 받은메일함은 현장·기상·시스템에서 온 메일, 보낸메일함은 보낸 확정 통보 메일.
  { key: 'MAIL', label: '메일', roles: ['scheduler', 'user'], items: [{ id: 'inbox', label: '메일함', icon: 'inbox' }] },
  // 11-20 피드백: REPORT 묶음 제목이 별도 탭처럼 보임 → 계획부터 메일까지 한 묶음, 번호로 순서를 보인다.
  // 리스크 확인·확정은 후보 비교 화면에 합쳤다.
  { key: 'BERTH PLANNING', label: '접안 계획 업무', roles: ['scheduler'], items: [
    { id: 'input', label: '계획 조건', icon: 'properties', no: 1 },
    { id: 'compare', label: '후보 비교·확정', icon: 'comparison', no: 2 },
    // 11-24 최최종: 보고서 화면은 지우고 확정 통보 메일의 첨부(체선료 지불 부서)로만 남긴다.
    { id: 'mail', label: '확정 통보 메일', icon: 'envelope', no: 3 },
  ] },
  // 11-20 피드백: 계산 검증·활동 기록 화면은 뺀다(C).
  { key: 'SCHEDULE', label: '일정', roles: ['user'], items: [{ id: 'ops', label: '확정 접안 일정', icon: 'timeline-events' }] },
  { key: 'CONTRACT', label: '계약 문서 업무', roles: ['contract'], items: [
    { id: 'docs', label: '문서 등록', icon: 'document', no: 1 },
    { id: 'terms', label: '추출값 검토', icon: 'search-text', no: 2 },
  ] },
]

export const canUse = (roleId, group) => group.roles.includes(roleId)
export const groupOf = (tab) => NAV.find((g) => g.items.some((i) => i.id === tab))
export const itemOf = (tab) => NAV.flatMap((g) => g.items).find((i) => i.id === tab)
// 브라우저마다 로캘 시각 모양이 달라('14시 35분') 기록용 시각은 KST 'YYYY-MM-DD HH:MM:SS'로 고정한다.
export const nowText = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ')

const fresh = () => ({
  roleId: null, // 로그인 전
  plans: [], // 확정 이력 {no, candId, label, total, reason, appliedChanges, skippedChanges, checkedRisks, uncheckedRisks, at, who, version, placements, cancelled}
  log: [], // 활동 기록(추가만) {id, ts, at, who, roleTitle, kind, action, target, detail}
  history: {}, // 대상별 변경 이력 `${scenarioId}:${vid|'env'}` → [{id, ts, at, who, field, label, from, to, logId}]
  notes: {}, // 선박 메모 `${scenarioId}:${vid}` → [{id, ts, at, who, text}]
  inbox: {}, // 받은 메일 상태 mailId → {status: 'read'|'applied'|'dismissed', at, who}
  sent: [], // 보낸 메일 {id, at, who, planNo, groupId, toName, to, subject, body, attachments, kind: 'notice'|'manual'}
})
let seq = 0
const nextId = () => ++seq

// 저장소 자체는 제자리에서 바뀌고, rev가 바뀌어야 React가 다시 그린다.
export const ws = fresh()
let rev = 0
const listeners = new Set()
const emit = () => { rev++; for (const l of listeners) l() }
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
/** 구독용 훅. 반환값 rev는 의존성 배열에 넣어 다시 계산할 때 쓴다. */
export const useWorkspace = () => useSyncExternalStore(subscribe, () => rev)

// 11-26 시연 초기화는 로그인은 그대로 두고 기록 · 입력만 지운다 (전에는 로그인까지 지워 로그인 화면으로 튕겼다)
export function resetWorkspace() { Object.assign(ws, { ...fresh(), roleId: ws.roleId }); emit() }
export function setRole(roleId) {
  if (roleId) {
    ws.roleId = roleId
    addLog('접속', '로그인', ROLES[roleId].title)
  } else if (ws.roleId) {
    addLog('접속', '로그아웃', ROLES[ws.roleId].title)
    ws.roleId = null
  }
  emit()
}

export const role = () => ROLES[ws.roleId]
function addLog(kind, action, target, detail = '') {
  const r = role()
  const entry = { id: nextId(), ts: Date.now(), at: nowText(), who: r?.name ?? '-', roleTitle: r?.title ?? '-', kind, action, target, detail }
  ws.log.push(entry)
  return entry
}
/** 화면에서 남기는 활동 기록. kind: 접속 | 입력 | 시나리오 | 리스크 | 보고서 | 메일 | 확정 | 메모 | 알림 */
export function logActivity(kind, action, target, detail = '') {
  addLog(kind, action, target, detail)
  emit()
}

// 같은 사람이 같은 칸을 1분 안에 연달아 고치면(날짜 입력처럼 한 번 고치는데 여러 번 바뀌는 경우) 한 건으로 묶는다.
const MERGE_MS = 60_000
/** 입력 변경 한 건을 대상 변경 이력과 활동 기록에 남긴다. change: {key, field, label, targetName, from, to} */
export function recordChange(scenarioId, change) {
  const hkey = `${scenarioId}:${change.key}`
  const list = (ws.history[hkey] ??= [])
  const r = role()
  const last = list.at(-1)
  const detail = (from, to) => `${change.label}: ${from} → ${to}`
  if (last && last.field === change.field && last.who === r?.name && Date.now() - last.ts < MERGE_MS) {
    last.to = change.to
    last.ts = Date.now()
    last.at = nowText()
    const entry = ws.log.find((l) => l.id === last.logId)
    if (entry) { entry.detail = detail(last.from, last.to); entry.ts = last.ts; entry.at = last.at }
    if (last.from === last.to) {
      // 원래 값으로 돌아오면 바뀐 것이 없으므로 기록을 지운다.
      list.pop()
      ws.log = ws.log.filter((l) => l.id !== last.logId)
    }
  } else {
    const entry = addLog('입력', '입력 수정', change.targetName, detail(change.from, change.to))
    list.push({ id: nextId(), ts: entry.ts, at: entry.at, who: entry.who, field: change.field, label: change.label, from: change.from, to: change.to, logId: entry.id })
  }
  emit()
}
export const historyOf = (scenarioId, key) => ws.history[`${scenarioId}:${key}`] ?? []

export const notesOf = (scenarioId, vid) => ws.notes[`${scenarioId}:${vid}`] ?? []
export function addNote(scenarioId, vid, vesselName, text) {
  const r = role()
  const note = { id: nextId(), ts: Date.now(), at: nowText(), who: r.name, text }
  ;(ws.notes[`${scenarioId}:${vid}`] ??= []).push(note)
  addLog('메모', '메모 추가', vesselName, text.length > 60 ? `${text.slice(0, 60)}…` : text)
  emit()
}
export function removeNote(scenarioId, vid, vesselName, id) {
  const key = `${scenarioId}:${vid}`
  ws.notes[key] = (ws.notes[key] ?? []).filter((n) => n.id !== id)
  addLog('메모', '메모 삭제', vesselName)
  emit()
}

/** 받은 메일 상태. status: 'read'(읽음) | 'applied'(돌발 상황 반영) | 'dismissed'(반영 안 함) | null(안 읽음으로) */
export function setAlertStatus(id, status, title) {
  if (status) ws.inbox[id] = { status, at: nowText(), who: role()?.name }
  else delete ws.inbox[id]
  if (status !== 'read') addLog('메일', status === 'applied' ? '조건 변경 반영' : status === 'dismissed' ? '조건 변경 반영 안 함' : '안 읽음으로', title)
  emit()
}
/** 11-25 조건 변경 결정 되돌리기: 메일 상태를 결정 전 값으로 그대로 돌린다(기록은 부르는 쪽에서 한 번만). */
export function restoreAlertStatus(id, prev) {
  if (prev) ws.inbox[id] = prev
  else delete ws.inbox[id]
  emit()
}
/** 읽음 표시는 기록을 남기지 않는다(열 때마다 쌓이지 않게). */
export function markRead(id) {
  if (ws.inbox[id]) return
  ws.inbox[id] = { status: 'read', at: nowText(), who: role()?.name }
  emit()
}
/** 메일 보내기(시연판은 실제 발송 없이 보낸메일함에 저장). */
export function sendMail(mail) {
  const entry = { id: nextId(), at: nowText(), who: role()?.name, ...mail }
  ws.sent.push(entry)
  addLog('메일', mail.kind === 'notice' ? '통보 메일 보냄' : '메일 보냄', mail.subject, `${mail.toName} <${mail.to}>${mail.attachments?.length ? ` · 첨부 ${mail.attachments.map((a) => a.name).join(', ')}` : ''}`)
  emit()
  return entry
}

/** 지금 적용 중인 확정 계획(마지막 확정, 취소 안 됨). */
export const activePlan = () => {
  const p = ws.plans.at(-1)
  return p && !p.cancelled ? p : null
}

/** 스케줄러 확정. 이후 입력이 바뀌어도 이용자는 확정 당시 일정을 본다(스냅숏). */
// 11-24 실데이터: 스냅숏에 선박, 부두, 체선료(센트)까지 복사해 둔다. 확정 뒤 계획 조건을 고쳐도 이 값은 바뀌지 않는다.
export function fixPlan({ cand, scen, version, reason, uncheckedRisks, skippedChanges = [], appliedChanges = [], checkedRisks = [] }) {
  const plan = { ...planSnapshot({ cand, scen, version, reason }), no: ws.plans.length + 1, appliedChanges, skippedChanges, checkedRisks, uncheckedRisks }
  ws.plans.push(plan)
  addLog('확정', '계획 확정', `접안 계획 v${plan.no} · ${cand.label}`, reason)
  emit()
  return plan
}

/** 확정 기록 한 건의 모양(저장하지 않음). 11-26 확정 전 통보 메일 예시 미리보기도 이것으로 만든다 */
export function planSnapshot({ cand, scen, version, reason }) {
  const v = Object.fromEntries(scen.vessels.map((x) => [x.id, x]))
  const b = Object.fromEntries(scen.berths.map((x) => [x.id, x]))
  return {
    no: 0, candId: cand.id, label: cand.label, total: cand.total, reason, // 11-26 판단 근거 = 작업자 판단 근거 · 조건(반영 / 반영 안 함) · 리스크(확인 / 확인 안 함)
    appliedChanges: [], skippedChanges: [], checkedRisks: [], uncheckedRisks: [],
    preset: cand.preset ? { id: cand.preset.id, label: cand.preset.label, desc: cand.preset.desc } : null,
    baselineTotal: null, moves: cand.moves ?? null,
    status: cand.status, proven: Boolean(cand.proven), solveSec: cand.solveSec ?? null,
    scenName: scen.name, bundle: scen.bundle ?? null,
    at: nowText(), who: role()?.name ?? '-', version, cancelled: false,
    tanks: structuredClone(cand.tanks ?? []),
    // 11-25 메일 템플릿용: 생산계획(탱크 묶음별 주별 t/h), 부두 사용 불가 구간, 야간 도선 규칙
    production: (scen.tanks ?? []).map((t) => ({ name: t.name, weeks: t.weeks })),
    blocks: structuredClone(scen.blocks ?? []),
    nightPilot: scen.nightPilot ?? null,
    placements: [...cand.placements].sort((a, c) => a.etb - c.etb).map((p) => {
      const x = v[p.vid] ?? {}
      const berth = b[p.bid] ?? {}
      return {
        vid: p.vid, name: x.name ?? p.vid, callSign: x.callSign ?? null, product: x.product ?? '-', cargo: x.cargo ?? null, dir: x.dir ?? '-', in: Boolean(x.in),
        ton: x.ton ?? null, dwt: x.dwt ?? null, grt: x.grt ?? null, draft: x.draft ?? null, biz: x.biz ?? null, tank: x.tank ?? null, eta: x.eta ?? p.eta,
        bid: p.bid, berth: berth.label ?? berth.name ?? p.bid, berthCode: berth.code ?? p.bid, pier: berth.pier ?? null, pierName: berth.pierName ?? null,
        etb: p.etb, etu: p.etu, night: Boolean(p.night), fixed: Boolean(p.fixed), dem: p.dem?.cents ?? 0,
        // 11-25 체선 시간은 엔진 값(demurrage_minutes). 배치 그림 · 산출 근거용으로 작업 · 정박시간 · 호스 분리 시각도 남긴다.
        demMin: p.dem?.excessMin ?? (p.le != null && p.hose != null ? Math.max(0, p.hose - p.le) : null),
        ws: p.ws ?? null, wf: p.wf ?? null, ls: p.ls ?? null, le: p.le ?? null, hose: p.hose ?? null, waitMin: p.waitMin ?? 0,
      }
    }),
  }
}
export function cancelPlan(reason) {
  const p = activePlan()
  if (!p) return
  p.cancelled = true
  addLog('확정', '확정 취소', `접안 계획 v${p.no} · ${p.label}`, reason)
  emit()
}
