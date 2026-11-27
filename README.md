# D-MIN 운영 콘솔 프로토타입 (Palantir 스타일)

[D-MIN-prototype](https://github.com/team-laytime/D-MIN-prototype)(Vue)의 화면 흐름과 계산을 그대로 두고, React + [Blueprint](https://blueprintjs.com/)(Palantir 공식 UI 툴킷)로 다시 만든 버릴 코드다(11-26부터 라이트 모드만 씀, 다크는 주소에 `?theme=dark`). Palantir Gotham 같은 운영 콘솔 느낌이 이 프로젝트에 맞는지 확인하는 용도다.

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
  ../D-MIN-optimization/.venv/bin/python tools/real-data/build_dataset.py \
    --engine ../D-MIN-optimization \
    --bundle ../optimizer_data_2025/optimizer_2025-01-01_tank --id real-2025
  ```

  - 1년 묶음 하나로 `public/data/real-2025.json`을 만든다(선박 · 생산계획 · 탱크 · 기상 · 배별 여유 · 과거 하역 실적, 계산 결과는 넣지 않음). 기준 시각은 화면 상단에서 고르고(시연 바로가기 03-03 강풍 · 10-03 탱크 · 11-09, 선석 겹침 구간이 걸리는 시각은 고를 수 없음), 화면이 그 시각의 하역 속도를 팀 전처리 API로 받아 엔진 요청을 만든다. 후보 A · B · C와 메일별 「단독 반영 시」는 화면이 처음 열 때 엔진으로 계산하고(A가 끝나면 A부터 보임) 브라우저 저장소(IndexedDB)에 남겨, 다음부터는 바로 뜬다. 「시연 초기화」는 이 저장 결과도 지워 처음부터 다시 계산한다. 자세한 것은 [docs/frontend-guide.md](docs/frontend-guide.md).
  - **비공개 데이터라 `public/data/`는 저장소에 올리지 않는다**(.gitignore). 그래서 GitHub Pages 배포본에는 데이터가 없다.
- 다시 계산: 계획 조건(ETA, 부두 사용 불가, 선박 고정, 엔진 조절값)을 고치면 「다시 계산」이 엔진 API(`/plan-jobs` 작업 방식)로 보낸다. 날짜를 바꾸거나 다시 계산하면 앞 계산은 엔진에서도 취소한다. 개발 서버가 `/engine`을 `127.0.0.1:8000`(엔진 저장소에서 `BERTH_API_HOST=127.0.0.1 BERTH_API_WORKERS=3 .venv/bin/python -m berth_sim.api`)으로 넘긴다. 다른 주소는 `ENGINE_URL`.
- 하역 속도: 개발 서버가 `/prep`을 팀 전처리 API `127.0.0.1:8001`(엔진 저장소에서 `PREP_API_HOST=127.0.0.1 PREP_API_PORT=8001 PREP_API_MAX_BODY_MB=100 .venv/bin/python -m berth_prep serve`)로 넘긴다. 다른 주소는 `PREP_URL`.
- 리스크: 개발 서버가 `/risk`를 팀 리스크 모델 `127.0.0.1:8002`(엔진 저장소에서 `.venv/bin/python -m uvicorn berth_risk.api:app --host 127.0.0.1 --port 8002 --workers 3`)로 넘긴다. 다른 주소는 `RISK_URL`.
- 금액은 데이터 팀 가상 계약 기준이라 안끼리 비교하는 값이다. 부두 하역팀 연락처도 가상이다.
- 원본의 실시간 AIS 모드(로컬 demo 서버 필요)는 옮기지 않았다.
- `main`에 푸시하면 GitHub Actions가 Pages로 배포한다.
