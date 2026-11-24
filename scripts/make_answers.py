"""정답 세트(answerSet.js)를 팀 엔진 after_etb 계산으로 만든다. 사용: python3 scripts/make_answers.py <D-MIN-optimization 경로> > src/lib/answerSet.js"""
import sys
from datetime import datetime, timedelta

sys.path.insert(0, sys.argv[1])
from berth_sim.after_etb.pipeline import ShipmentPlan, calc_after_etb  # noqa: E402
from berth_sim.after_etb.s12_demurrage_fee import fee_cents  # noqa: E402
from berth_sim.step3_berth_block import BerthBlock, BlockKind  # noqa: E402

T0 = datetime(2026, 11, 14)
PCT = {'FULL': 100.0, 'HALF': 50.0, 'NONE': 0.0}


def at(d, h, m=0):
    return (d - 14) * 1440 + h * 60 + m


def js_at(x):
    d, r = divmod(x, 1440)
    h, m = divmod(r, 60)
    return f"at({d + 14}, {h}{', ' + str(m) if m else ''})"


dt = lambda m: T0 + timedelta(minutes=m)  # noqa: E731
WX = (at(14, 18), at(15, 6))
LC = (at(13, 0), at(15, 16))
P = '석유제품선'
# id, 사례, ETA, ETB, 물량, 속도, 허용h, 일 체선료, 개시h, 기상 조항, 기상 구간, 선종, LayCan, CFR
CASES = [
    ('T01', '정박개시 전 접안 → 정박개시 = ETB', at(14, 8), at(14, 10), 45000, 2500, 26, 28000, 6, 'FULL', WX, P, LC, False),
    ('T02', '기상체선, 공제 없음', at(14, 8), at(15, 7, 30), 62000, 3000, 28, 45000, 6, 'NONE', WX, P, None, False),
    ('T03', '기상체선, 전부 공제', at(14, 8), at(15, 7, 30), 62000, 3000, 28, 45000, 6, 'FULL', WX, P, None, False),
    ('T04', '기상체선, 50% 공제 (장표 기본)', at(14, 8), at(15, 7, 30), 62000, 3000, 28, 45000, 6, 'HALF', WX, P, None, False),
    ('T05', 'Daylight 미적용 선종, NOR 즉시 개시', at(14, 20), at(15, 9), 10000, 1250, 14, 12000, 0, 'FULL', None, '화학제품선', LC, False),
    ('T06', 'Daylight: 일출 전 NOR → 그날 07:00', at(14, 2), at(14, 11), 45000, 2500, 20, 28000, 6, 'FULL', None, P, LC, False),
    ('T07', 'Daylight: 일몰 뒤 NOR → 다음 날 07:00', at(14, 20), at(15, 13), 25000, 2000, 14, 18000, 6, 'HALF', None, P, (at(14, 0), at(16, 16)), False),
    ('T08', 'Early Loading: NOR · 접안 모두 LayCan 전 → ETB', at(14, 8), at(14, 12), 35000, 2500, 12, 22000, 6, 'HALF', None, P, (at(15, 0), at(17, 16)), False),
    ('T09', 'LayCan Miss: NOR이 LayCan To 뒤 → ETB', at(14, 14), at(15, 20), 40000, 2500, 12, 30000, 6, 'FULL', None, P, (at(11, 0), at(13, 16)), False),
    ('T10', 'LayCan 전 NOR → LayCan From 날 07:00', at(14, 8), at(15, 9), 35000, 2500, 12, 22000, 6, 'FULL', None, P, (at(15, 0), at(17, 16)), False),
    ('T11', '원유선 · CFR 아님 · LayCan 없음(양하) → Laytime 50%', at(14, 9), at(14, 20), 80000, 4000, 42, 40000, 6, 'HALF', None, '원유선', None, False),
    ('T12', '작업 중 기상도 기상체선에 포함 (정박개시 ~ 호스분리)', at(14, 9), at(14, 16), 40000, 2000, 14, 30000, 6, 'HALF', WX, P, LC, False),
    ('T13', '반 센트 경계 (HALF_UP)', at(14, 10), at(14, 10), 18200, 2000, 10, 10001, 6, 'NONE', None, P, LC, False),
]

print("import { at } from './time.js'\n")
print('// 정답 세트. expectedCents는 팀 최적화 엔진 D-MIN-optimization(berth_sim/after_etb, 커밋 7b7a731)으로 계산한 값이다.')
print('// 이 화면의 자동 계산(engine.js)과 따로 돌려 센트 단위로 맞춰 본다. 다시 만들기: scripts/make_answers.py')
print('export const ANSWER_SET = [')
for (cid, note, eta, etb, ton, rate, lt, usd, turn, wx, wxs, vt, lc, cfr) in CASES:
    blocks = [BerthBlock(dt(wxs[0]), dt(wxs[1]), BlockKind.WEATHER)] if wxs else []
    a = calc_after_etb(ShipmentPlan(
        etb=dt(etb), berth='6', rate=rate, qty=ton, vessel_type=vt,
        laycan_from=dt(lc[0]) if lc else None, laycan_to=dt(lc[1]) if lc else None, eta=dt(eta),
        laytime=timedelta(hours=lt), cfr=cfr, demurrage_rate=usd, notice_h=turn, weather_deduct_pct=PCT[wx]), blocks)
    from decimal import Decimal, ROUND_HALF_UP
    exact = int((Decimal(a.demurrage_time.total_seconds()) / 3600 * usd / 24 * 100).quantize(Decimal('1'), rounding=ROUND_HALF_UP))
    team = fee_cents(a.demurrage_fee)
    lcs = f"{{ from: {js_at(lc[0])}, to: {js_at(lc[1])} }}" if lc else 'null'
    wxj = f"{{ start: {js_at(wxs[0])}, end: {js_at(wxs[1])} }}" if wxs else 'null'
    print(f"  {{ id: '{cid}', note: '{note}', eta: {js_at(eta)}, etb: {js_at(etb)}, ton: {ton}, rate: {rate}, laytimeH: {lt}, rateUsd: {usd}, turnH: {turn}, "
          f"weather: '{wx}', wx: {wxj}, vesselType: '{vt}', laycan: {lcs}, cfr: {str(cfr).lower()}, expectedCents: {exact}{'' if team == exact else f', teamCents: {team}'} }},"
          f"  // {a.laytime_start.reason}")
print(']')
