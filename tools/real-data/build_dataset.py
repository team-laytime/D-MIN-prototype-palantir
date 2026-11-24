"""데이터 팀 묶음(optimizer_data_2025) → 화면용 데이터셋 JSON.

팀 최적화 엔진(D-MIN-optimization)의 전처리(berth_prep request)로 계산 요청을 만들고,
엔진(berth_sim.api.service.solve)을 후보 프리셋마다 한 번씩 돌려 결과를 함께 담는다.
화면은 이 파일 하나로 시작하고, 계획 조건을 고치면 같은 요청을 엔진 API(/engine/plans)로 다시 보낸다.

실행 (엔진 저장소의 파이썬 환경, Python 3.11~3.12 + ortools):
  python tools/real-data/build_dataset.py \
    --engine ../D-MIN-prototype/D-MIN-optimization \
    --bundle ../D-MIN-prototype/optimizer_data_2025/optimizer_2025-11-09 \
    --start "2025-11-09 09:00" --days 3 --id real-2025-11-09

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

# 후보 = 같은 기준 시각에서 파라미터만 바꾼 계획 (팀 INTEGRATION.md 13장 "후보안 비교 화면")
PRESETS = [
    {'id': 'base', 'label': '기본', 'desc': '팀 엔진 기본 파라미터', 'params': {}},
    {'id': 'tank', 'label': '안전재고 25~75%', 'desc': '탱크 안전 범위를 20~80%에서 25~75%로 좁힘', 'params': {'tank': {'safe_min_pct': 25, 'safe_max_pct': 75}}},
    {'id': 'buffer', 'label': '계획 여유 1시간', 'desc': '부두 전환 여유 1시간, 방향 전환 여유 30분', 'params': {'shifting': {'buffer_switch_h': 1, 'buffer_direction_h': 0.5}}},
]


def merge(a, b):
    out = dict(a)
    for k, v in b.items():
        out[k] = merge(out.get(k, {}), v) if isinstance(v, dict) else v
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', required=True)
    ap.add_argument('--bundle', required=True)
    ap.add_argument('--start', required=True)
    ap.add_argument('--days', type=int, default=3)
    ap.add_argument('--time-limit', type=int, default=30)
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
    common = {'horizon': {'days': a.days}, 'solver': {'time_limit_s': a.time_limit}}
    req['params'] = common

    from berth_sim.api import service  # noqa: E402
    results = []
    for p in PRESETS:
        body = dict(req, params=merge(common, p['params']), name=p['label'], request_id=p['id'])
        t0 = time.time()
        status, out = service.solve(body)
        if status != 200:
            raise SystemExit(f'{p["label"]}: {status} {json.dumps(out, ensure_ascii=False)[:500]}')
        print(f'{p["label"]}: {out["status"]} ${out["plan"]["total_cents"] / 100:,.2f} · {time.time() - t0:.0f}s', file=sys.stderr)
        results.append({'preset': p, 'response': out})

    meta = json.loads((bundle / 'dummy' / 'meta.json').read_text())
    ds = {
        'id': a.id,
        'label': a.label or f'{a.start[:10]} 기준 {a.days * 24}시간',
        'bundle': bundle.name,
        'start': a.start,
        'days': a.days,
        'source': f'데이터 팀 묶음 {bundle.name} (실제 접안 실적 + 합성 값, 계약은 가상) · 팀 엔진 berth_sim CP-SAT',
        'meta': {k: meta.get(k) for k in ('plan_start', 'plan_days', 'current_shipments', 'past_shipments')},
        'request': req,
        'results': results,
        'built_at': time.strftime('%Y-%m-%d %H:%M'),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f'{a.id}.json').write_text(json.dumps(ds, ensure_ascii=False, separators=(',', ':')))
    idx_path = OUT / 'index.json'
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else []
    idx = [d for d in idx if d['id'] != a.id] + [{'id': a.id, 'label': ds['label'], 'start': a.start, 'days': a.days, 'bundle': bundle.name}]
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1))
    print(f'→ {OUT / (a.id + ".json")}', file=sys.stderr)


if __name__ == '__main__':
    main()
