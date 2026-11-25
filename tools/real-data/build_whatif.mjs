// 11-25 조건 변경 메일별 「단독 반영 시」 A · B · C를 데이터셋에 미리 넣는다 (화면을 열자마자 메일 하나를 결정하면 바로 바뀌게).
//   화면과 같은 코드를 그대로 쓴다: 메일 만들기(seedIncidents) · 조건 넣기(applyChange) · B 고르기(presetsFor) · 요청 만들기(buildRequest).
//   엔진 API(127.0.0.1:8000, BERTH_API_WORKERS=3)로 메일 하나씩 A · B · C를 동시에 푼다. 결과는 데이터셋 whatIf[incId] = [{preset, response}].
//   요청 원문은 크기 때문에 넣지 않는다(화면이 같은 규칙으로 다시 만든다).
// 쓰는 법: bun tools/real-data/build_whatif.mjs [데이터셋 id]   (build_dataset.py 다음에)
const ROOT = new URL('../..', import.meta.url).pathname
const id = process.argv[2] ?? 'real-2025-11-09'
const ENGINE = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000'
const { buildScen, buildRequest, rankSims } = await import(`${ROOT}src/lib/dataset.js`)
const { setTimeBase } = await import(`${ROOT}src/lib/time.js`)
const { applyChange } = await import(`${ROOT}src/lib/incidents.js`)
const { presetsFor } = await import(`${ROOT}src/lib/presets.js`)

const path = `${ROOT}public/data/${id}.json`
const ds = await Bun.file(path).json()
setTimeBase(ds.results[0].response.window.start)
const scen = buildScen(ds)
const sims = rankSims(ds.results)
ds.whatIf ??= {} // 이미 계산한 메일은 건너뛴다(중간에 멈춰도 다시 돌리면 이어서)
for (const inc of scen.incidents) {
  if (ds.whatIf[inc.id]) { console.error(`${inc.kind}: 이미 있음, 건너뜀`); continue }
  const t0 = Date.now()
  try {
  const d = structuredClone(scen)
  applyChange(d, inc, true)
  const out = await Promise.all(presetsFor(d, sims).map(async (preset) => {
    const solve = async (retry) => {
      const req = buildRequest(d, preset)
      if (retry) req.params.solver = { ...req.params.solver, time_limit_s: Math.max(60, req.params.solver?.time_limit_s ?? 0) }
      // 엔진이 바쁘면 한 계산이 몇 분 걸린다: Bun 기본 시간 제한을 끈다
      let r
      for (;;) {
        r = await fetch(`${ENGINE}/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), timeout: false })
        if (r.status !== 429) break
        await r.body?.cancel()
        console.error(`${inc.kind} · ${preset.label}: 엔진 대기열이 가득 참, 30초 뒤 다시`) // 화면이 같이 계산 중이거나 남은 요청이 있을 때
        await Bun.sleep(30000)
      }
      const body = await r.json()
      if (!r.ok) throw new Error(`${inc.kind} · ${preset.label}: ${body.detail ?? r.status}`)
      return body
    }
    let response = await solve(false)
    if (!response.plan) response = await solve(true)
    return { preset, response }
  }))
  if (out.some((x) => !x.response.plan)) { console.error(`${inc.kind}: 계획 없음, 건너뜀`); continue }
  ds.whatIf[inc.id] = out
  await Bun.write(path, JSON.stringify(ds)) // 메일 하나 끝날 때마다 저장
  console.error(`${inc.kind}: ${out.map((x) => `${x.preset.label} $${(x.response.plan.total_cents / 100).toLocaleString()}`).join(' · ')} · ${Math.round((Date.now() - t0) / 1000)}s`)
  } catch (e) { console.error(`${inc.kind}: 실패, 건너뜀 (${e.message})`) }
}
console.error(`→ ${path} (whatIf ${Object.keys(ds.whatIf).length}건)`)
