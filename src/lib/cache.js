// 11-26 계산 결과 저장소 (브라우저 IndexedDB). 엔진 · 리스크 모델 결과를 요청 내용 + 모델 지문을 키로 남겨,
//   같은 요청이면 다시 계산하지 않는다(새로고침 · 탭을 닫아도 남음). 데이터셋에는 계산 결과를 넣지 않는다.
//   지문(엔진 코드 · 파라미터, 리스크 규칙)이 바뀌면 키가 달라져 저절로 다시 계산하고, 다른 지문의 결과는 그때 지운다.
//   저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 저장 없이 계산만 한다.
const DB = 'dmin-cache'
const STORE = 'results'

let dbp = null
function db() {
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbp
}

function run(mode, fn) {
  return db().then((d) => d && new Promise((resolve) => {
    try {
      const tx = d.transaction(STORE, mode)
      const out = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(out?.result)
      tx.onerror = tx.onabort = () => resolve(undefined)
    } catch { resolve(undefined) }
  }))
}

export const cacheGet = (key) => run('readonly', (s) => s.get(key))
export const cacheSet = (key, value) => run('readwrite', (s) => s.put(value, key))

/** prefix로 시작하지만 keep으로 시작하지 않는 항목을 지운다 (지문이 바뀐 옛 결과) */
export function cachePrune(prefix, keep) {
  return run('readwrite', (s) => {
    const req = s.openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c) return
      const k = String(c.key)
      if (k.startsWith(prefix) && !k.startsWith(keep)) c.delete()
      c.continue()
    }
    return null
  })
}

/** 11-26 시연 초기화: prefixes 중 하나로 시작하는 항목을 모두 지운다 (계산 결과를 버리고 다시 계산하게) */
export function cacheClear(prefixes) {
  return run('readwrite', (s) => {
    const req = s.openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c) return
      if (prefixes.some((p) => String(c.key).startsWith(p))) c.delete()
      c.continue()
    }
    return null
  })
}

/** 문자열 해시 (FNV-1a 두 번 + 길이). 키 충돌이 나도 같은 길이 · 같은 해시 두 개가 맞아야 해서 사실상 없다 */
export function hashText(s) {
  let h1 = 2166136261, h2 = 5381
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619)
    h2 = (Math.imul(h2, 33) + c) | 0
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${s.length.toString(36)}`
}

/** 서버 지문을 페이지마다 한 번 묻는다. 지문이 바뀌었으면 그 종류의 옛 결과를 지운다. 못 받으면 null(저장 없이 계산) */
export function versionOf(kind, url, pick) {
  versionOf.memo ??= {}
  versionOf.memo[kind] ??= fetch(url).then((r) => r.json()).then((b) => {
    const v = pick(b)
    if (!v) throw new Error('no version')
    cachePrune(`${kind}:`, `${kind}:${v}:`)
    return v
  }).catch(() => { delete versionOf.memo[kind]; return null }) // 서버가 꺼져 있으면 다음에 다시 묻는다
  return versionOf.memo[kind]
}
