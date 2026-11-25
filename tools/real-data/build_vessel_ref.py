"""호출부호별 선박명·제원 참조 파일을 만든다 (11-25).

원천: team-laytime/D-MIN-dataset 저장소
  - data/reference/vessel_lookup_list.csv   호출부호 → 한글·영문 선박명, 선종, 국적, 총톤수(해수부)
  - data/reference/vessel_specs_web_merged.csv  호출부호 → IMO, MMSI, 건조 연도, DWT, LOA, 폭, 만재 흘수(웹 조회)
결과: public/data/vessel-ref.json  (public/data/는 비공개라 저장소에 올리지 않는다)

쓰는 법:
  python tools/real-data/build_vessel_ref.py <D-MIN-dataset 폴더 또는 두 CSV가 있는 폴더>
  폴더를 안 주면 gh CLI로 저장소에서 두 파일을 받는다(팀 저장소 읽기 권한 필요).
"""
import csv
import io
import json
import subprocess
import sys
from pathlib import Path

REPO = 'team-laytime/D-MIN-dataset'
FILES = {'lookup': 'data/reference/vessel_lookup_list.csv', 'specs': 'data/reference/vessel_specs_web_merged.csv'}
OUT = Path(__file__).resolve().parents[2] / 'public' / 'data' / 'vessel-ref.json'


def read(kind, root):
    if root:
        p = Path(root)
        cand = [p / FILES[kind], p / Path(FILES[kind]).name]
        for c in cand:
            if c.exists():
                return c.read_text(encoding='utf-8-sig')
        raise SystemExit(f'{FILES[kind]}를 {root}에서 찾지 못했습니다')
    raw = subprocess.run(['gh', 'api', f'repos/{REPO}/contents/{FILES[kind]}', '-H', 'Accept: application/vnd.github.raw'],
                         check=True, capture_output=True).stdout
    return raw.decode('utf-8-sig')


def num(x):
    try:
        f = float(x)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else None
    out = {}
    for r in csv.DictReader(io.StringIO(read('lookup', root))):
        out[r['callsgn']] = {
            'nameKo': r['vessel_name_ko'] or None, 'nameEn': r['vessel_name_en'] or None,
            'type': r['vessel_type'] or None, 'flag': r['flag'] or None,
            'gt': num(r['gt_mof']), 'voyages2025': num(r['voyages_2025']), 'usualBerths': r['berths'] or None,
        }
    for r in csv.DictReader(io.StringIO(read('specs', root))):
        e = out.setdefault(r['callsgn'], {})
        e['web'] = {
            'imo': r['imo'] or None, 'mmsi': r['mmsi'] or None, 'built': num(r['year_built']),
            'dwt': num(r['dwt_t']), 'loa': num(r['loa_m']), 'beam': num(r['beam_m']), 'draft': num(r['summer_draft_m']),
            'match': r['match_status'] or None, 'source': r['source_url'] or None, 'checked': r['checked_date'] or None,
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'{OUT}: 호출부호 {len(out)}개')


if __name__ == '__main__':
    main()
