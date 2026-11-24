# D-MIN 운영 콘솔 프로토타입 (Palantir 스타일)

[D-MIN-prototype](https://github.com/team-laytime/D-MIN-prototype)(Vue)의 화면 흐름과 계산을 그대로 두고, React + [Blueprint](https://blueprintjs.com/)(Palantir 공식 UI 툴킷) 다크 테마로 다시 만든 버릴 코드다. Palantir Gotham 같은 운영 콘솔 느낌이 이 프로젝트에 맞는지 확인하는 용도다.

- 데모: https://team-laytime.github.io/D-MIN-prototype-palantir/
- 계정: 처음 화면에서 로그인한다(비밀번호 `1234`). 스케줄러(`scheduler`)는 일정을 짜고 확정하고, 이용자(`user`)는 확정된 일정만 본다.
- 디자인 규칙: [DESIGN.md](DESIGN.md)

```bash
bun install && bun run dev   # http://localhost:5175
```

- 데이터는 전부 가상이다(`src/lib/scenarios.js`, 시나리오 S1~S3).
- 계산식(`src/lib/engine.js`)은 팀 최적화 엔진 [D-MIN-optimization](https://github.com/team-laytime/D-MIN-optimization)(`berth_sim`, 커밋 7b7a731)을 옮겼다. ETB = max(ETA + Direction, 앞 선박 ETU + Switching) → 야간 도선 제한 → 기상 부두 제약, 그 뒤 작업시작(ETB + 1h) → 작업완료(물량 ÷ 배 × 부두 하역 속도) → 호스분리(+30분) · ETU(+2h) → 정박개시(LayCan · Daylight 분기) → 정박종료 → 기상체선 공제 → 체선료. 숫자는 `PARAMS`(= 팀 엔진 `params.default.json`).
- 검산: `scripts/oracle.py`가 같은 입력을 팀 Python 엔진으로 다시 계산해 ETB · ETU · 정박개시 · 센트를 대조한다(S1~S3 72칸, 무작위 60개 1,440칸 모두 일치). 정답 세트는 `scripts/make_answers.py`로 만든다.
- 팀 엔진에 없는 것은 넣지 않았다: 조석 제약, DWT 6만 톤 이상 주간 접안 규칙(야간 도선 제한으로 바뀜). 동일 화물 그룹 · #4 동시 접안 · 탱크 재고 · 풍속 하역 중단은 이 화면의 부두(SK 3 · 5 · 6)와 데이터에 해당이 없어 옮기지 않았다.
- 6척 × 순서 720가지 × 부두 배정 8가지 = 5,760안을 브라우저에서 전부 돌려 후보 3개를 고른다.
- 원본의 실시간 AIS 모드(로컬 demo 서버 필요)는 옮기지 않았다.
- `main`에 푸시하면 GitHub Actions가 Pages로 배포한다.
