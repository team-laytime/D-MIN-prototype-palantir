"""데이터 팀 묶음(optimizer_data_2025) → 화면용 데이터셋 JSON.

팀 최적화 엔진(D-MIN-optimization)의 전처리(berth_prep request)로 계산 요청을 만들고,
엔진(berth_sim.api.service.solve)을 후보 프리셋마다 한 번씩 돌려 결과를 함께 담는다.
화면은 이 파일 하나로 시작하고, 계획 조건을 고치면 같은 요청을 엔진 API(/engine/plans)로 다시 보낸다.

시연 데이터 흐름 (팀 INTEGRATION.md 13장, 11-25 이 흐름으로 바꿈):
  D-MIN-dataset → 1년 묶음(optimizer_2025-01-01)
  → 최적화 팀 후보정 scripts/make_tank_plan.py (탱크 수, 1년 생산계획, 연초 재고, 탱크보다 큰 물량 32척 축소)
  → 기준 시각 T만 골라 엔진 요청(berth_prep request, 생산계획 · 탱크 설정 포함) → 엔진
  생산계획은 1/1 재고에서 T까지 실적으로 재고를 이어 세므로 반드시 1년 묶음에 붙인다(7일 묶음은 이어 셀 실적이 없음).

준비 (묶음 사본에 후보정, 원본 묶음은 그대로):
  cp -R optimizer_2025-01-01 optimizer_2025-01-01_tank
  (엔진 저장소) .venv/bin/python scripts/make_tank_plan.py --bundle <optimizer_2025-01-01_tank>

실행 (엔진 저장소의 파이썬 환경, Python 3.11~3.12 + ortools):
  python tools/real-data/build_dataset.py \
    --engine ../D-MIN-prototype/D-MIN-optimization \
    --bundle ../D-MIN-prototype/optimizer_data_2025/optimizer_2025-01-01_tank \
    --start "2025-11-09 09:00" --days 3 --id real-2025-11-09
  제한 시간 60초, workers 8은 팀 권장값(탱크 반영 계획은 코어가 모자라면 60초 안에 못 찾음).

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
# 11-25 후보 개편: A 기본 · B 상황형(탱크와 풍속 중 리스크가 높은 쪽) · C 배별 지연 대비(데이터 팀 안 3)
#   B를 고르는 규칙은 화면(src/lib/presets.js)과 같다. 다시 계산할 때는 화면이 같은 규칙으로 다시 고른다.
SIGMA_MS = 2.0  # 예보 풍속 오차 σ (m/s). 사용자 설정 값(11-25, 1 → 2). 여유 < 1σ 높음 · < 2σ 중간 · < 3σ 낮음
TANK_LIMIT = (20.0, 80.0)  # 탱크 마지노선 (리스크 모델 기본값과 같음)
TANK_BANDS = ((3, 1.0), (2, 4.0), (1, 7.0))  # (등급, 마지노선까지 %p 안) 높음 3 · 중간 2 · 낮음 1
BASE = {'id': 'base', 'label': '기본', 'desc': '팀 엔진 기본 파라미터', 'params': {}}
C_PRESET = {'id': 'vessel_buffer', 'label': '배별 지연 대비', 'desc': '배마다 늦어질 만큼 앞뒤 간격을 비워 둔 계획 (작업 여유 · 도착 여유, 데이터 팀 안 3)',
            'params': {'shifting': {'vessel_buffer': True}}}
B_OPTIONS = {
    'tank': {'id': 'tank', 'label': '안전재고 강화', 'desc': '탱크 안전 범위를 20~80%에서 25~75%로 좁힘', 'params': {'tank': {'safe_min_pct': 25, 'safe_max_pct': 75}}},
    'wind': {'id': 'wind', 'label': '보수적 풍속 기준', 'desc': '하역 중단 풍속을 예보 오차 2σ만큼 낮춤',
             'params': None},  # 기준 풍속에서 2σ를 뺀 값으로 채운다 (wind_preset)
    'buffer_half': {'id': 'buffer_half', 'label': '배별 지연 대비 절반', 'desc': '배별 작업 여유를 절반만 둠 (도착 여유는 그대로)',
                    'params': {'shifting': {'vessel_buffer': True, 'work_buffer_scale': 0.5}}},
}
GRADE = {0: '없음', 1: '낮음', 2: '중간', 3: '높음'}


def tank_grade(resp):
    """A 계획 재고 곡선이 마지노선 20/80%에 얼마나 가까운가 → (등급, 설명)."""
    best = (0, None)
    for t in resp.get('tanks') or []:
        for lv in t['levels_t']:
            pct = lv / t['capacity_t'] * 100
            gap = round(min(pct - TANK_LIMIT[0], TANK_LIMIT[1] - pct), 1)
            g = next((g for g, w in TANK_BANDS if gap < w), 0)
            if g > best[0] or (g == best[0] and g and gap < best[1][1]):
                best = (g, (t['tank'], gap, round(pct, 1)))
    g, d = best
    return g, (f"{d[0]} 재고 {d[2]}%, 마지노선까지 {d[1]}%p" if d else '탱크 재고가 마지노선에서 멀음')


def wind_grade(req, resp):
    """계획 기간 예보 최대 풍속과 하역 중단 기준의 여유를 σ로 → (등급, 설명, 기준 풍속)."""
    th = (resp.get('params') or {}).get('weather', {}).get('thresholds_ms') or {'#1~2·GAS': [18, 20], '#3~7': [14, 21]}
    s, e = resp['window']['start'], resp['window']['end']
    ws = [w['wind_ms'] for w in req.get('weather') or [] if s <= w['time'] <= e and w.get('wind_ms') is not None]
    if not ws:
        return 0, '예보 없음', th
    top = max(ws)
    margin, grp = min((v[0] - top, k) for k, v in th.items())
    g = 3 if margin < SIGMA_MS else 2 if margin < 2 * SIGMA_MS else 1 if margin < 3 * SIGMA_MS else 0
    return g, f"예보 최대 {top:g} m/s, {grp} 중단 기준 {th[grp][0]:g} m/s까지 {margin:g} m/s (σ {SIGMA_MS:g})", th


def choose_b(req, resp_a):
    """B = 탱크 등급과 풍속 등급 중 높은 쪽. 같으면 탱크, 둘 다 없으면 배별 지연 대비 절반."""
    tg, tw = tank_grade(resp_a)
    wg, ww, th = wind_grade(req, resp_a)
    if tg == 0 and wg == 0:
        p, why = B_OPTIONS['buffer_half'], f'탱크 · 풍속 리스크 없음 ({tw} · {ww})'
    elif tg >= wg:
        p, why = B_OPTIONS['tank'], f'탱크 {GRADE[tg]}: {tw}' + (f' (풍속 {GRADE[wg]})' if wg else '')
    else:
        p = dict(B_OPTIONS['wind'], params={'weather': {'thresholds_ms': {k: [max(1.0, v[0] - 2 * SIGMA_MS), v[1]] for k, v in th.items()}}})
        p['desc'] += ': ' + ', '.join(f"{k} {v[0]:g}→{max(1.0, v[0] - 2 * SIGMA_MS):g}" for k, v in th.items()) + ' m/s'
        why = f'풍속 {GRADE[wg]}: {ww}' + (f' (탱크 {GRADE[tg]})' if tg else '')
    return dict(p, why=why, grades={'tank': tg, 'wind': wg})


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

    from berth_sim.api import service  # noqa: E402
    add_buffers(req, bundle)

    def run(p):
        body = dict(req, params=merge(common, p['params']), name=p['label'], request_id=p['id'])
        t0 = time.time()
        status, out = service.solve(body)
        if status != 200:
            raise SystemExit(f'{p["label"]}: {status} {json.dumps(out, ensure_ascii=False)[:500]}')
        print(f'{p["label"]}: {out["status"]} ${out["plan"]["total_cents"] / 100:,.2f} · {time.time() - t0:.0f}s', file=sys.stderr)
        return {'preset': p, 'response': out}

    # A를 먼저 풀고, A 재고 곡선과 예보로 B를 고른 뒤 B · C
    ra = run(BASE)
    b = choose_b(req, ra['response'])
    print(f'B 선택: {b["label"]} — {b["why"]}', file=sys.stderr)
    results = [ra, run(b), run(C_PRESET)]

    meta = json.loads((bundle / 'dummy' / 'meta.json').read_text())
    ds = {
        'id': a.id,
        'label': a.label or f'{a.start} 현재, {a.days * 24}시간 계획',
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
