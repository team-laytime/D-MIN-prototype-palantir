# D-MIN 운영 콘솔 프로토타입 (Palantir 스타일)

[D-MIN-prototype](https://github.com/team-laytime/D-MIN-prototype)(Vue)의 화면 흐름과 계산을 그대로 두고, React + [Blueprint](https://blueprintjs.com/)(Palantir 공식 UI 툴킷) 다크 테마로 다시 만든 버릴 코드다. Palantir Gotham 같은 운영 콘솔 느낌이 이 프로젝트에 맞는지 확인하는 용도다.

- 데모: https://team-laytime.github.io/D-MIN-prototype-palantir/
- 계정: 처음 화면에서 로그인한다(비밀번호 `1234`). 스케줄러(`scheduler`)는 일정을 짜고 확정하고, 이용자(`user`)는 확정된 일정만 본다.
- 디자인 규칙: [DESIGN.md](DESIGN.md)

```bash
bun install && bun run dev   # http://localhost:5175
```

- 데이터는 전부 가상이다(`src/lib/scenarios.js`, 시나리오 S1~S3). `src/lib/`의 계산 코드는 원본 프로토타입에서 그대로 가져왔다.
- 6척 × 순서 720가지 × 부두 배정 8가지 = 5,760안을 브라우저에서 전부 돌려 후보 3개를 고른다.
- 원본의 실시간 AIS 모드(로컬 demo 서버 필요)는 옮기지 않았다.
- `main`에 푸시하면 GitHub Actions가 Pages로 배포한다.
