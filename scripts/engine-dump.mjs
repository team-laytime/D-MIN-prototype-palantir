const L = process.argv[2]
const { SCENARIOS } = await import(L + '/scenarios.js')
const { runSearch, validate } = await import(L + '/engine.js')
const { fmt } = await import(L + '/time.js')
const dump = process.argv[3] === 'json'
const out = {}
for (const [id, mk] of Object.entries(SCENARIOS)) {
  const s = mk()
  const t = Date.now()
  const r = runSearch(s)
  if (r.error) { console.log(id, r.error); continue }
  if (dump) {
    out[id] = { vessels: s.vessels, berths: s.berths, env: s.env, sims: [r.fcfs, ...r.candidates].map((x) => ({ id: x.id, total: x.total, placements: x.placements.map((p) => ({ vid: p.vid, bid: p.bid, etb: p.etb, etu: p.etu, cents: p.dem.cents, ltStart: p.dem.ltStart })) })) }
    continue
  }
  console.log(`${id} ${s.name} explored=${r.explored} ms=${Date.now() - t} fcfs=$${r.fcfs.total / 100} best=${r.candidates.map((c) => '$' + c.total / 100).join(', ')} viol=${[r.fcfs, ...r.candidates].map((x) => validate(x, s).length)}`)
  for (const p of r.candidates[0].placements) console.log('  ', p.vid, p.bid, fmt(p.etb), '->', fmt(p.etu), p.binding, p.blockers.map((b) => b.rule).join('+'), p.dem.ltStartRule, fmt(p.dem.ltStart), '$' + p.dem.cents / 100)
}
if (dump) console.log(JSON.stringify(out))
