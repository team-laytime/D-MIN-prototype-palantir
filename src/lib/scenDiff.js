// 계획 조건이 바뀐 칸을 사람이 읽는 말로 뽑는다. 변경 이력, 활동 기록, 메일함이 이 결과를 쓴다.
// 11-24 실데이터: 바꿀 수 있는 것은 선박 ETA, 부두 사용 불가(blocks), 선박 고정(fixes), 엔진 조절값(params)이다.
import { fmt } from './time.js'

export const BLOCK_KINDS = { WEATHER: '기상', CONSTRUCTION: '공사', EQUIPMENT: '설비' }

// 계획 조건 화면에서 고치는 엔진 조절값. def = 팀 엔진 기본값(scen.params에 없으면 이 값으로 계산된다).
export const PARAM_FIELDS = [
  { path: ['tank', 'safe_min_pct'], label: '안전재고 하한', unit: '%', def: 20, min: 0, max: 100, step: 1, note: '탱크 재고가 이 비율 밑으로 내려가지 않게' },
  { path: ['tank', 'safe_max_pct'], label: '안전재고 상한', unit: '%', def: 80, min: 0, max: 100, step: 1, note: '탱크 재고가 이 비율을 넘지 않게' },
  { path: ['shifting', 'buffer_switch_h'], label: '부두 전환 여유', unit: 'h', def: 0, min: 0, max: 12, step: 0.5, note: '앞 선박 이안 뒤 다음 접안까지 더 비우는 시간' },
  { path: ['solver', 'time_limit_s'], label: '계산 제한 시간', unit: 's', def: 30, min: 5, max: 300, step: 5, note: '후보 하나를 찾는 데 쓰는 최대 시간' },
]
export const getIn = (o, path) => path.reduce((x, k) => (x == null ? undefined : x[k]), o)

const berthCode = (scen, id) => scen.berths.find((b) => b.id === id)?.code ?? id
const blockKey = (b, i) => b.id ?? (b.incId ? `inc:${b.incId}` : `idx:${i}`)
const blockText = (scen, b) => `${b.berths ? b.berths.map((id) => berthCode(scen, id)).join(', ') : '전 부두'} ${fmt(b.start)} ~ ${fmt(b.end)} ${BLOCK_KINDS[b.kind] ?? b.kind}`
const fixText = (scen, f) => (f ? `${berthCode(scen, f.bid)} ${fmt(f.etb)} 접안` : '고정 안 함')

/** 중첩된 params를 'a.b' 경로 → 값으로 편다 */
function flat(o, pre = '', out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = pre ? `${pre}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, p, out)
    else out[p] = v
  }
  return out
}

/** @returns {{key, field, label, targetName, from, to, kind}[]} key는 선박 id 또는 'env' */
export function diffScen(prev, next) {
  if (!prev || !next) return []
  const out = []

  // 선박 ETA
  const before = Object.fromEntries(prev.vessels.map((v) => [v.id, v]))
  for (const v of next.vessels) {
    const p = before[v.id]
    if (p && p.eta !== v.eta) out.push({ key: v.id, field: 'eta', label: 'ETA', targetName: v.name, from: fmt(p.eta), to: fmt(v.eta), kind: 'eta' })
  }

  // 부두 사용 불가: 추가, 삭제, 수정
  const label = (b) => `부두 사용 불가 (${BLOCK_KINDS[b.kind] ?? b.kind})`
  const pb = new Map(prev.blocks.map((b, i) => [blockKey(b, i), b]))
  const nb = new Map(next.blocks.map((b, i) => [blockKey(b, i), b]))
  for (const [k, b] of nb) {
    const a = pb.get(k)
    const from = a ? blockText(prev, a) : '없음'
    const to = blockText(next, b)
    if (from !== to) out.push({ key: 'env', field: `block:${k}`, label: label(b), targetName: '부두', from, to, kind: 'block' })
  }
  for (const [k, a] of pb) {
    if (!nb.has(k)) out.push({ key: 'env', field: `block:${k}`, label: label(a), targetName: '부두', from: blockText(prev, a), to: '없음', kind: 'block' })
  }

  // 선박 고정
  const pf = Object.fromEntries(prev.fixes.map((f) => [f.vid, f]))
  const nf = Object.fromEntries(next.fixes.map((f) => [f.vid, f]))
  for (const vid of new Set([...Object.keys(pf), ...Object.keys(nf)])) {
    const a = fixText(prev, pf[vid]), b = fixText(next, nf[vid])
    if (a !== b) out.push({ key: vid, field: 'fix', label: '선박 고정', targetName: next.vessels.find((v) => v.id === vid)?.name ?? vid, from: a, to: b, kind: 'fix' })
  }

  // 엔진 조절값
  const pp = flat(prev.params), np = flat(next.params)
  for (const path of new Set([...Object.keys(pp), ...Object.keys(np)])) {
    if (pp[path] === np[path]) continue
    const f = PARAM_FIELDS.find((x) => x.path.join('.') === path)
    const show = (x) => (x === undefined ? (f ? `기본값 ${f.def}${f.unit}` : '기본값') : `${x}${f?.unit ?? ''}`)
    out.push({ key: 'env', field: `param:${path}`, label: f?.label ?? path, targetName: '엔진 조절값', from: show(pp[path]), to: show(np[path]), kind: 'param' })
  }
  return out
}
