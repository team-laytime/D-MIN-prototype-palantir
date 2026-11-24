# D-MIN 운영 콘솔 프로토타입 (Palantir 스타일)

[D-MIN-prototype](https://github.com/team-laytime/D-MIN-prototype)(Vue)의 화면 흐름과 계산을 그대로 두고, React + [Blueprint](https://blueprintjs.com/)(Palantir 공식 UI 툴킷) 다크 테마로 다시 만든 버릴 코드다. Palantir Gotham 같은 운영 콘솔 느낌이 이 프로젝트에 맞는지 확인하는 용도다.

- 데모: https://team-laytime.github.io/D-MIN-prototype-palantir/
- 계정: 처음 화면에서 로그인한다(비밀번호 `1234`). 스케줄러(`scheduler`)는 일정을 짜고 확정하고, 이용자(`user`)는 확정된 일정만 본다.
- 디자인 규칙: [DESIGN.md](DESIGN.md)

```bash
bun install && bun run dev   # http://localhost:5175
```

## 데이터와 계산 (11-24: 목 데이터 제거)

- 가상 시나리오(6척, 부두 3곳)와 브라우저 안 전수 탐색(5,760안)은 지웠다. 화면은 **데이터 팀 실데이터 묶음 + 팀 최적화 엔진(CP-SAT) 결과**로만 동작한다.
- 데이터셋 만들기 (엔진 저장소 [D-MIN-optimization](https://github.com/team-laytime/D-MIN-optimization)의 파이썬 환경, Python 3.11~3.12):

  ```bash
  ../D-MIN-prototype/D-MIN-optimization/.venv/bin/python tools/real-data/build_dataset.py \
    --engine ../D-MIN-prototype/D-MIN-optimization \
    --bundle ../D-MIN-prototype/optimizer_data_2025/optimizer_2025-11-09 \
    --start "2025-11-09 09:00" --days 3 --id real-2025-11-09
  ```

  - 팀 전처리(`berth_prep request`)로 엔진 요청을 만들고, 프리셋 3개(기본, 안전재고 25~75%, 계획 여유 1시간)를 엔진으로 계산해 `public/data/<id>.json`에 담는다.
  - **비공개 데이터라 `public/data/`는 저장소에 올리지 않는다**(.gitignore). 그래서 GitHub Pages 배포본에는 데이터가 없다.
- 다시 계산: 계획 조건(ETA, 부두 사용 불가, 선박 고정, 엔진 조절값)을 고치면 「다시 계산」이 엔진 API로 보낸다. 개발 서버가 `/engine`을 `127.0.0.1:8000`(엔진 저장소에서 `BERTH_API_HOST=127.0.0.1 BERTH_API_WORKERS=3 .venv/bin/python -m berth_sim.api`)으로 넘긴다. 다른 주소는 `ENGINE_URL`.
- 금액은 데이터 팀 가상 계약 기준이라 안끼리 비교하는 값이다. 부두 하역팀 연락처도 가상이다.
- 원본의 실시간 AIS 모드(로컬 demo 서버 필요)는 옮기지 않았다.
- `main`에 푸시하면 GitHub Actions가 Pages로 배포한다.
