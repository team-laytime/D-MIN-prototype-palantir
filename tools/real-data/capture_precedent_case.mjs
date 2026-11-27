import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { buildRequest, buildScen, kstIso, rankSims, vesselIdOf } from '../../src/lib/dataset.js'
import { BASE_PRESET, C_PRESET, chooseB } from '../../src/lib/presets.js'
import { setTimeBase } from '../../src/lib/time.js'
import { scenarioConstraint, variants, withScenarioConstraint } from './precedent_constraints.mjs'

const args = process.argv.slice(2)
const screening = args.at(-1) === '--screening'
if (screening) args.pop()
const trialIndex = args.indexOf('--variant')
const variant = trialIndex >= 0 ? args.splice(trialIndex, 2)[1] : null
const [datasetPath, date, output, enginePath, python = 'python3'] = args
if (!datasetPath || !/^2025-\d\d-\d\d$/.test(date ?? '') || !output || !enginePath
    || args.length > 5 || (trialIndex >= 0 && !variants.includes(variant))) {
  throw new Error('Usage: node capture_precedent_case.mjs DATASET 2025-MM-DD OUTPUT ENGINE [PYTHON] [--variant TYPE] [--screening]')
}
if (existsSync(output)) throw new Error(`Output already exists: ${output}`)

const hours = 3_600_000
const start = `${date} 09:00`
const iso = kstIso(start)
const startMs = Date.parse(iso)
if (new Date(startMs).toISOString().slice(0, 10) !== date) throw new Error(`Invalid date: ${date}`)
const horizonMs = 72 * hours
const endMs = startMs + horizonMs
const excluded = ['03-01', '03-10', '10-15', '11-09'].map(day => Date.parse(`2025-${day}T00:00:00Z`))
const overlapsDemo = (from, to) => excluded.some(demo => from < demo + horizonMs && demo < to)
if (overlapsDemo(startMs, endMs)) throw new Error('Planning window overlaps a reserved demo window')

const dataset = readFileSync(datasetPath)
const base = JSON.parse(dataset)
if (base.request.params.horizon.days !== 3) throw new Error('Expected a 72-hour dataset')
const hash = value => createHash('sha256').update(value).digest('hex')
const hashJson = value => hash(JSON.stringify(value))
const planKey = (plan, includeCosts) => plan ? hashJson(plan.vessels.map(row => [
  row.vessel_id, row.berth, row.etb, row.work_start, row.work_end, row.hose_off, row.etu,
  ...(includeCosts ? [row.demurrage_cents] : []),
]).sort((left, right) => left[0].localeCompare(right[0]))) : null

const snapshot = {
  case_id: `${date}-ulsan-72h`,
  provenance: variant ? 'historical_replay_with_synthetic_constraint_unreviewed' : 'historical_operations_replay_unreviewed',
  as_of: `${date}T09:00:00+09:00`,
  nominal_window_end: new Date(endMs).toISOString(),
  search_eligible: false,
  calculation_mode: screening ? 'screening' : 'prototype_defaults',
  sources: {
    input_dataset_sha256: hash(dataset),
    bundle: base.bundle,
    observed: ['historical berth operations', 'hourly weather observations'],
    simulated_or_assumed: ['ETA where synthesized', 'contract terms and demurrage rates', 'adjusted tank and production inputs'],
    timing_caveat: 'Weather observations during the simulated decision window were available only in hindsight.',
  },
  prep: null,
  candidates: [],
  displayed: null,
  human_judgments: [],
  operational_outcome: null,
  status: 'incomplete',
}

const engine = resolve(enginePath)
const worker = spawn(python, ['-u', fileURLToPath(new URL('./precedent_engine.py', import.meta.url))], {
  cwd: engine,
  env: { ...process.env, PYTHONPATH: [engine, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
  stdio: ['pipe', 'pipe', 'inherit'],
})
const exited = once(worker, 'close')
const replies = createInterface({ input: worker.stdout })[Symbol.asyncIterator]()
worker.stdin.on('error', error => { process.stderr.write(`${error.message}\n`) })

async function callEngine(payload) {
  worker.stdin.write(`${JSON.stringify(payload)}\n`)
  const reply = await replies.next()
  if (reply.done) throw new Error('Engine process exited without a response')
  const value = JSON.parse(reply.value)
  if (value.error) throw new Error(value.error)
  return value
}

async function capture(scen, preset, slot) {
  const request = buildRequest(scen, preset)
  console.log(date, slot, preset.id, 'calculating')
  const result = await callEngine({ request })
  const { plan, window } = result.response
  const recorded = {
    slot, preset, request, request_sha256: hashJson(request), ...result,
    schedule_id: planKey(plan, true), placement_id: planKey(plan, false),
    demo_overlap: window ? overlapsDemo(Date.parse(window.start), Date.parse(window.end)) : null,
  }
  if (slot !== 'control') snapshot.candidates.push(recorded)
  console.log(date, slot, preset.id, result.response.status ?? result.status, plan?.total_cents ?? '-', result.risks?.counts ?? result.risk_error ?? '', result.response.elapsed_seconds ?? '-')
  return recorded
}

try {
  console.log(date, 'preparing rates')
  setTimeBase(iso)
  const keys = ['call_sign', 'entry_year', 'voyage', 'stay_seq', 'vessel_code', 'material_code', 'qty']
  const past = base.past_shipments
  const rates = await callEngine({ prep: {
    start: iso,
    vessels: base.request.vessels.map(row => Object.fromEntries(keys.map(key => [key, row[key]]))),
    past_shipments: past.qty.map((qty, index) => ({
      qty, vessel_code: past.vessel_code[index], material_code: past.material_code[index], berth: past.berth[index],
      work_start: `${past.work_start[index].replace(' ', 'T')}:00+09:00`,
      work_end: `${past.work_end[index].replace(' ', 'T')}:00+09:00`,
    })),
  } })
  if (rates.vessels.length !== base.request.vessels.length) throw new Error('Rate row count mismatch')
  const vessels = base.request.vessels.map((row, index) => {
    const detail = rates.vessels[index]
    if (!keys.slice(0, 4).every(key => (row[key] ?? '') === (detail[key] ?? ''))) throw new Error(`Rate row mismatch at ${index}`)
    return { ...row, rate_t_per_h: Object.keys(detail.rate_t_per_h).length ? detail.rate_t_per_h : null }
  })
  const params = structuredClone(base.request.params)
  if (screening) {
    Object.assign(params.solver ??= {}, { time_limit_s: 15, workers: 2, max_gap_rounds: 4, max_tank_gap_rounds: 2 })
  }
  const ds = { ...base, id: `${base.id}@${start}`, start, request: { ...base.request, start: iso, vessels, params } }
  const bare = { request: ds.request, vessels: [], blocks: [], fixes: [], params: {} }
  const control = variant ? await capture(bare, BASE_PRESET, 'control') : null
  if (control) {
    snapshot.control = control
    if (!control.response.plan) throw new Error('No baseline plan to anchor a simulated constraint')
    snapshot.simulated_constraint = scenarioConstraint(variant, control.request, control.response.plan)
  }
  const applyTrial = (scen) => control ? withScenarioConstraint(scen, snapshot.simulated_constraint) : scen
  const a = await capture(applyTrial(bare), BASE_PRESET, 'A')
  const scen = applyTrial(buildScen({ ...ds, results: a.response.window ? [a] : [] }))
  const planned = new Set(scen.vessels.map(vessel => vessel.id))
  snapshot.prep = {
    version: rates.model.version,
    used_past_shipments: rates.used_past_shipments,
    excluded_after_start: rates.excluded_after_start,
    planned_vessel_ids: [...planned].sort(),
    planned_rate_details: rates.vessels.filter((_, index) => planned.has(vesselIdOf(vessels[index]))),
  }
  if (a.response.plan) {
    await capture(scen, chooseB(scen, rankSims([a])[0]), 'B')
  } else {
    snapshot.candidates.push({ slot: 'B', status: 'not_run', reason: 'B depends on a plan from A.' })
  }
  await capture(scen, C_PRESET, 'C')
  if (snapshot.candidates.every(candidate => candidate.response?.plan)) {
    snapshot.displayed = rankSims(snapshot.candidates).map(sim => ({
      slot: sim.id, source_preset_id: sim.req.request_id, schedule_id: planKey(sim.resp.plan, true),
      placement_id: planKey(sim.resp.plan, false),
    }))
  }
  if (control?.demo_overlap || snapshot.candidates.some(candidate => candidate.demo_overlap)) {
    snapshot.status = 'excluded_demo_overlap'
  } else if (snapshot.candidates.every(candidate => candidate.response?.plan && candidate.risks && candidate.demo_overlap === false)) {
    snapshot.status = 'candidate_snapshot_ready'
  } else if (snapshot.candidates.some(candidate => candidate.response?.status === 'NO_PLAN')) {
    snapshot.status = 'candidate_not_produced'
  }
} catch (error) {
  snapshot.error = error.message
  process.exitCode = 1
  process.stderr.write(`${date} ${error.message}\n`)
} finally {
  worker.stdin.end()
  try {
    const [code] = await exited
    if (code !== 0) process.exitCode = 1
  } finally {
    const temporary = `${output}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(snapshot)}\n`, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, output)
  }
}
