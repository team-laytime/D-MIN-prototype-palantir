"""데이터 팀 묶음(optimizer_data_2025) → 화면용 데이터셋 JSON (엔진 요청만).

팀 최적화 엔진(D-MIN-optimization)의 전처리(berth_prep request)로 계산 요청을 만들어 담는다.
11-26부터 계산 결과는 넣지 않는다: 화면이 처음 열 때 후보 A → (A로 고른) B · C를 엔진 API로 계산하고
브라우저 저장소(IndexedDB, src/lib/cache.js)에 남긴다. 후보 구성 규칙은 src/lib/presets.js 한 곳.

시연 데이터 흐름 (팀 INTEGRATION.md 13장):
  D-MIN-dataset → 1년 묶음(optimizer_2025-01-01)
  → 최적화 팀 후보정 scripts/make_tank_plan.py (탱크 수, 1년 생산계획, 연초 재고, 탱크보다 큰 물량 축소)
  → 기준 시각 T만 골라 엔진 요청(berth_prep request, 생산계획 · 탱크 설정 포함)
  생산계획은 1/1 재고에서 T까지 실적으로 재고를 이어 세므로 반드시 1년 묶음에 붙인다(7일 묶음은 이어 셀 실적이 없음).

준비 (묶음 사본에 후보정, 원본 묶음은 그대로):
  cp -R optimizer_2025-01-01 optimizer_2025-01-01_tank
  (엔진 저장소) .venv/bin/python scripts/make_tank_plan.py --bundle <optimizer_2025-01-01_tank>

실행 (엔진 저장소의 파이썬 환경, 몇 초):
  ../D-MIN-optimization/.venv/bin/python tools/real-data/build_dataset.py \
    --engine ../D-MIN-optimization \
    --bundle ../optimizer_data_2025_1126/optimizer_2025-01-01_tank \
    --start "2025-11-09 09:00" --days 3 --id real-2025-11-09
  요청에 넣는 제한 시간 60초, workers 8은 팀 권장값(탱크 반영 계획은 코어가 모자라면 60초 안에 못 찾음).

출력: public/data/<id>.json, public/data/index.json  (비공개 데이터라 저장소에 올리지 않는다 · .gitignore)
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / 'public' / 'data'

def add_buffers(req, bundle):
    """11-25 데이터 팀 배별 여유(묶음 buffer/)를 요청 vessels[].arrival_buffer_h · work_buffer_h로 넣는다.
    엔진은 shifting.vessel_buffer를 켠 후보에서만 쓰고, 리스크 모델은 작업 간격 판정의 필요 여유로 쓴다."""
    import csv
    from berth_sim.data_files import ship_id
    from berth_sim.plan_buffer import read_buffers
    with (bundle / 'dummy' / 'current_shipments.csv').open(encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    buf = read_buffers(bundle / 'buffer', rows)
    work = {}
    for (sid, b), h in buf.work_h.items():
        work.setdefault(sid, {})[b] = h
    n = 0
    for v in req['vessels']:
        sid = ship_id({'callsgn': v['call_sign'], 'ptentVtsYr': v['entry_year'], 'vyg': v['voyage'], 'stay_seq': v.get('stay_seq') or ''})
        if sid in buf.arrival_h:
            v['arrival_buffer_h'] = buf.arrival_h[sid]
        if sid in work:
            v['work_buffer_h'] = work[sid]
            n += 1
    print(f'배별 여유: {n}척 (물량이 바뀌어 여유를 다시 계산해야 정확한 배 {len(buf.stale)}척)', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', required=True)
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--start', required=True)
    ap.add_argument('--days', type=int, default=3)
    ap.add_argument('--time-limit', type=int, default=60)
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--id', required=True)
    ap.add_argument('--label')
    a = ap.parse_args()
    engine = Path(a.engine).resolve()
    bundle = Path(a.bundle).resolve()
    sys.path.insert(0, str(engine))

    req = json.loads(subprocess.check_output(
        [sys.executable, '-m', 'berth_prep', 'request', '--data-dir', str(bundle / 'dummy'), '--start', a.start],
        cwd=engine, stderr=subprocess.DEVNULL))
    # 기상은 10년치 시간별 관측이 통째로 들어와 파일이 커진다. 계획 기간 앞뒤만 남긴다(엔진은 이 구간만 본다).
    from datetime import datetime, timedelta, timezone
    t0 = datetime.strptime(a.start, '%Y-%m-%d %H:%M').replace(tzinfo=timezone(timedelta(hours=9)))
    lo, hi = t0 - timedelta(days=2), t0 + timedelta(days=a.days + 7)
    req['weather'] = [w for w in req.get('weather') or [] if lo <= datetime.fromisoformat(w['time'].replace('Z', '+00:00')) <= hi]
    common = {'horizon': {'days': a.days}, 'solver': {'time_limit_s': a.time_limit, 'workers': a.workers}}
    req['params'] = common

    add_buffers(req, bundle)

    meta = json.loads((bundle / 'dummy' / 'meta.json').read_text())
    ds = {
        'id': a.id,
        'label': a.label or f'{a.start} 현재, {a.days * 24}시간 계획',
        'bundle': bundle.name,
        'start': a.start,
        'days': a.days,
        'source': f'데이터 팀 묶음 {bundle.name} (실제 접안 실적 + 합성 값, 계약은 가상) · 팀 엔진 berth_sim CP-SAT',
        'meta_bundle': {k: meta.get(k) for k in ('dropped_bunker', 'multi_berth', 'berth_fit')},
        'meta': {k: meta.get(k) for k in ('plan_start', 'plan_days', 'current_shipments', 'past_shipments')},
        'request': req,
        'built_at': time.strftime('%Y-%m-%d %H:%M'),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f'{a.id}.json').write_text(json.dumps(ds, ensure_ascii=False, separators=(',', ':')))
    idx_path = OUT / 'index.json'
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else []
    idx = [d for d in idx if d['id'] != a.id] + [{'id': a.id, 'label': ds['label'], 'start': a.start, 'days': a.days, 'bundle': bundle.name}]
    idx.sort(key=lambda d: d['start'])  # 화면은 마지막(가장 늦은 기준 시각)을 먼저 연다
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1))
    print(f'→ {OUT / (a.id + ".json")}', file=sys.stderr)


if __name__ == '__main__':
    main()
