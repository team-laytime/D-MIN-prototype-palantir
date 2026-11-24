"""palantir engine.js 결과를 팀 엔진(D-MIN-optimization berth_sim)으로 다시 계산해 대조한다.
사용 (저장소 루트에서):
  node scripts/engine-dump.mjs $PWD/src/lib json | python3 scripts/oracle.py <D-MIN-optimization 경로>     # S1~S3 후보 전부
  node scripts/engine-random.mjs $PWD/src/lib | python3 scripts/oracle.py <D-MIN-optimization 경로>        # 도착·기상을 흔든 60개
"""
import json
import sys
from datetime import datetime, timedelta

sys.path.insert(0, sys.argv[1])
from berth_sim.after_etb.pipeline import ShipmentPlan, calc_after_etb  # noqa: E402
from berth_sim.after_etb.s12_demurrage_fee import fee_cents  # noqa: E402
from berth_sim.models import Vessel  # noqa: E402
from berth_sim.params import from_dict, using  # noqa: E402
from berth_sim.step1_prev_fix import schedule  # noqa: E402
from berth_sim.step2_night_pilot import make_night_pilot_adjuster  # noqa: E402
from berth_sim.step3_berth_block import BerthBlock, BlockKind, make_berth_block_adjuster  # noqa: E402

T0 = datetime(2026, 11, 14)
BERTH = {'#6': '6', '#3': '3', '#5-5': '5-5'}
PCT = {'FULL': 100.0, 'HALF': 50.0, 'NONE': 0.0}
dt = lambda m: T0 + timedelta(minutes=m)  # noqa: E731
mins = lambda d: round((d - T0).total_seconds() / 60, 3)  # noqa: E731

data = json.loads(sys.stdin.read().strip().splitlines()[-1])
checked = bad = 0
for sid, sc in data.items():
    vs = {v['id']: v for v in sc['vessels']}
    bname = {b['id']: BERTH[b['shiftGroup']] for b in sc['berths']}
    w = sc['env']['weather']
    blocks = [BerthBlock(dt(w['start']), dt(w['end']), BlockKind.WEATHER)] if w else []
    adjusters = [make_night_pilot_adjuster(), make_berth_block_adjuster(blocks)]
    params = from_dict({'shifting': {'buffer_switch_h': sc['env'].get('switchBufferMin', 0) / 60}})
    for sim in sc['sims']:
      with using(params):
          # ① ~ ③ ETB: 부두별 순서를 팀 schedule()에 넣는다. 기존 접안선은 FIX 선박으로 둔다.
          seqs = {}
          for b in sc['berths']:
              seq = []
              if b['occupiedUntil'] is not None:
                  seq.append(Vessel(f"OCC-{b['id']}", bname[b['id']], dt(b['occupiedUntil'] - 60), timedelta(minutes=60),
                                    is_fix=True, fixed_etb=dt(b['occupiedUntil'] - 60)))
              for p in sorted((p for p in sim['placements'] if p['bid'] == b['id']), key=lambda p: p['etb']):
                  v = vs[p['vid']]
                  stay = 60 + round(v['ton'] / v['rates'][p['bid']] * 60) + 120
                  seq.append(Vessel(v['id'], bname[b['id']], dt(v['eta']), timedelta(minutes=stay),
                                    biz='IM' if v['dir'] == '수입' else 'EX', grt=v['grt'], draft=v['draft']))
              seqs[bname[b['id']]] = seq
          team = {r.vessel_id: r for rs in schedule(seqs, adjusters).values() for r in rs}
          for p in sim['placements']:
              v = vs[p['vid']]
              c = v['contract']
              r = team[v['id']]
              lc = c.get('laycan')
              plan = ShipmentPlan(
                  etb=dt(p['etb']), berth=bname[p['bid']], rate=v['rates'][p['bid']], qty=v['ton'],
                  vessel_type=v['vesselType'], laycan_from=dt(lc['from']) if lc else None, laycan_to=dt(lc['to']) if lc else None,
                  eta=dt(v['eta']), nr_tender=dt(v['nrTender']) if v.get('nrTender') is not None else None,
                  laytime=timedelta(hours=c['laytimeH']), cfr=bool(c.get('cfr')), demurrage_rate=c['rateUsd'],
                  notice_h=c['norTurnH'], weather_deduct_pct=PCT[c['weather']],
              )
              a = calc_after_etb(plan, blocks)
              got = {'etb': mins(r.etb), 'etu': mins(a.etu), 'ltStart': mins(a.laytime_start.at), 'cents': fee_cents(a.demurrage_fee)}
              want = {'etb': p['etb'], 'etu': p['etu'], 'ltStart': p['ltStart'], 'cents': p['cents']}
              checked += 1
              if got != want:
                  bad += 1
                  print('불일치', sid, sim['id'], v['id'], 'team', got, 'js', want, a.laytime_start.reason)
print(f'대조 {checked}건, 불일치 {bad}건')
