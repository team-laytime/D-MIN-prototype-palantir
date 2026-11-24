const L = process.argv[2]
const { SCENARIOS } = await import(L + '/scenarios.js')
const { runSearch, validate } = await import(L + '/engine.js')
let seed = 7
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const out = {}
let viol = 0
for (let i = 0; i < 60; i++) {
  const s = SCENARIOS[['S1', 'S2', 'S3'][i % 3]]()
  for (const v of s.vessels) { v.eta += Math.round((rnd() * 24 - 12) * 6) * 10; if (rnd() < 0.3) v.contract.weather = ['FULL', 'HALF', 'NONE'][Math.floor(rnd() * 3)] }
  if (s.env.weather) { s.env.weather.start += Math.round(rnd() * 12 - 6) * 60; s.env.weather.end = s.env.weather.start + (6 + Math.round(rnd() * 12)) * 60 }
  s.env.switchBufferMin = [0, 0, 30, 60][Math.floor(rnd() * 4)]
  const r = runSearch(s)
  if (r.error) continue
  const sims = [r.fcfs, ...r.candidates]
  viol += sims.reduce((n, x) => n + validate(x, s).length, 0)
  out['R' + i] = { vessels: s.vessels, berths: s.berths, env: s.env, sims: sims.map((x) => ({ id: x.id, placements: x.placements.map((p) => ({ vid: p.vid, bid: p.bid, etb: p.etb, etu: p.etu, cents: p.dem.cents, ltStart: p.dem.ltStart })) })) }
}
console.error('validate 위반', viol)
console.log(JSON.stringify(out))
