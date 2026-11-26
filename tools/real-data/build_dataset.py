"""데이터 팀 1년 묶음(optimizer_data_2025) → 화면용 데이터셋 JSON 하나 (기준 시각은 화면에서 고른다).

11-26: 날짜마다 파일을 만들지 않는다. 기준 시각 T에 따라 달라지는 것은 하역 속도(T 전에 끝난 과거 실적의 평균)뿐이라,
1년치 선박 · 생산계획 · 탱크 설정 · 기상 · 배별 여유와 과거 하역 실적을 한 파일에 담고, 화면이 고른 T로
  ① 팀 전처리 API(POST /prep/rates, berth_prep)에 과거 실적을 보내 하역 속도를 받고  ② 엔진 요청을 만든다.
후보 A · B · C도 화면이 엔진 API로 계산해 브라우저 저장소(IndexedDB, src/lib/cache.js)에 남긴다. 후보 구성 규칙은 src/lib/presets.js 한 곳.

시연 데이터 흐름 (팀 INTEGRATION.md 13장):
  D-MIN-dataset → 1년 묶음(optimizer_2025-01-01)
  → 최적화 팀 후보정 scripts/make_tank_plan.py (탱크 수, 1년 생산계획, 연초 재고, 탱크보다 큰 물량 축소)
  생산계획은 1/1 재고에서 T까지 실적으로 재고를 이어 세므로 1년 묶음에 붙인다.

준비 (묶음 사본에 후보정, 원본 묶음은 그대로):
  cp -R optimizer_2025-01-01 optimizer_2025-01-01_tank
  (엔진 저장소) .venv/bin/python scripts/make_tank_plan.py --bundle <optimizer_2025-01-01_tank>

실행 (엔진 저장소의 파이썬 환경, 몇 초):
  ../D-MIN-optimization/.venv/bin/python tools/real-data/build_dataset.py \
    --engine ../D-MIN-optimization --bundle ../optimizer_data_2025_1126/optimizer_2025-01-01_tank --id real-2025
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


def past_columns(bundle):
    """과거 하역 실적(past_shipments.csv) → 열별 배열 (화면이 전처리 API 형식으로 펼친다). 시각은 KST 'YYYY-MM-DD HH:MM'."""
    import csv
    cols = {k: [] for k in ('vessel_code', 'material_code', 'berth', 'work_start', 'work_end', 'qty')}
    with (bundle / 'dummy' / 'past_shipments.csv').open(encoding='utf-8-sig') as f:
        for r in csv.DictReader(f):
            for k in cols:
                cols[k].append(float(r[k]) if k == 'qty' else r[k])
    return cols


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', required=True)
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--id', required=True)
    ap.add_argument('--days', type=int, default=3)
    ap.add_argument('--time-limit', type=int, default=60)
    ap.add_argument('--workers', type=int, default=8)
    ap.add_argument('--default-start', default='2025-11-09 09:00', help='화면이 처음 여는 기준 시각')
    ap.add_argument('--shortcuts', default='2025-03-01 09:00,2025-03-10 09:00,2025-10-15 09:00,2025-11-09 09:00', help='바로가기 기준 시각 (쉼표)')
    ap.add_argument('--label')
    a = ap.parse_args()
    engine = Path(a.engine).resolve()
    bundle = Path(a.bundle).resolve()
    sys.path.insert(0, str(engine))

    # 구조(기준정보 · 선박 · 생산계획 · 탱크 설정 · 기상)는 전처리 요청 그대로. 하역 속도는 T마다 다르므로 빼고 화면이 채운다
    req = json.loads(subprocess.check_output(
        [sys.executable, '-m', 'berth_prep', 'request', '--data-dir', str(bundle / 'dummy'), '--start', a.default_start],
        cwd=engine, stderr=subprocess.DEVNULL))
    for v in req['vessels']:
        v['rate_t_per_h'] = None
    req.pop('start', None)
    # 기상은 10년치 시간별 관측이 통째로 들어와 크다. 묶음 연도 앞뒤만 남긴다 (엔진은 계획 기간 근처만 본다)
    from datetime import datetime, timedelta, timezone
    kst = timezone(timedelta(hours=9))
    years = sorted({v['entry_year'] for v in req['vessels']})
    lo = datetime(int(min(years)), 1, 1, tzinfo=kst) - timedelta(days=30)
    hi = datetime(int(max(years)), 12, 31, tzinfo=kst) + timedelta(days=45)
    req['weather'] = [w for w in req.get('weather') or [] if lo <= datetime.fromisoformat(w['time'].replace('Z', '+00:00')) <= hi]
    req['params'] = {'horizon': {'days': a.days}, 'solver': {'time_limit_s': a.time_limit, 'workers': a.workers}}

    add_buffers(req, bundle)

    meta = json.loads((bundle / 'dummy' / 'meta.json').read_text())
    year = meta.get('plan_start', '2025')[:4]
    ds = {
        'id': a.id,
        'label': a.label or f'{year}년 1년치',
        'kind': 'year',
        'bundle': bundle.name,
        'days': a.days,
        'range': {'from': f'{year}-01-01', 'to': f'{year}-12-31'},
        'default_start': a.default_start,
        'shortcuts': [x.strip() for x in a.shortcuts.split(',') if x.strip()],
        'source': f'데이터 팀 묶음 {bundle.name} (실제 접안 실적 + 합성 값, 계약은 가상) · 팀 엔진 berth_sim CP-SAT',
        'meta_bundle': {k: meta.get(k) for k in ('dropped_bunker', 'multi_berth', 'berth_fit')},
        'meta': {k: meta.get(k) for k in ('plan_start', 'plan_days', 'current_shipments', 'past_shipments')},
        'request': req,
        'past_shipments': past_columns(bundle),
        'built_at': time.strftime('%Y-%m-%d %H:%M'),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f'{a.id}.json').write_text(json.dumps(ds, ensure_ascii=False, separators=(',', ':')))
    keys = ('id', 'label', 'kind', 'days', 'range', 'default_start', 'shortcuts', 'bundle')
    (OUT / 'index.json').write_text(json.dumps([{k: ds[k] for k in keys}], ensure_ascii=False, indent=1))
    print(f'→ {OUT / (a.id + ".json")} (선박 {len(req["vessels"]):,}척 · 과거 실적 {len(ds["past_shipments"]["qty"]):,}건 · 기상 {len(req["weather"]):,}시간)', file=sys.stderr)


if __name__ == '__main__':
    main()
