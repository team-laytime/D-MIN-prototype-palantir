---
name: D-MIN 운영 콘솔
description: 울산 CLX 접안 순서·체선료 최적화 운영 콘솔 (Palantir 계열 운영 콘솔 프로토타입, 라이트 테마)
colors:
  bg-chrome: "#ffffff"
  bg-canvas: "#eef1f4"
  bg-panel: "#ffffff"
  bg-raised: "#f5f7f9"
  bg-hover: "#e8edf2"
  line: "#e2e7ec"
  line-strong: "#cdd5dd"
  line-tick: "#8f9cab"
  fg: "#1b2129"
  fg-muted: "#4a5768"
  fg-faint: "#687788"
  accent: "#c2410c"
  accent-action: "#d9481c"
  amber: "#a85f00"
  red: "#c42b36"
  green: "#0f7f50"
  violet: "#5b45c7"
  blue: "#1f5fc4"
typography:
  screen-title:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  panel-title:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  panel-code:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "10.5px"
    fontWeight: 400
    letterSpacing: "0.08em"
  body:
    fontFamily: "Pretendard Variable, Pretendard, Apple SD Gothic Neo, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
  stat-value:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, monospace"
    fontSize: "18px"
    fontWeight: 500
rounded:
  none: "0px"
  control: "2px"
spacing:
  gap: "10px"
  panel-pad: "12px"
  cell-x: "10px"
  screen-x: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-action}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
  panel:
    backgroundColor: "{colors.bg-panel}"
    rounded: "{rounded.none}"
  panel-head:
    backgroundColor: "{colors.bg-raised}"
    height: "34px"
  table-header-cell:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.fg-faint}"
    height: "30px"
---

# Design System: D-MIN 운영 콘솔

## Overview

**North Star: "The Common Operating Picture"**

Palantir Gotham·Foundry 계열의 운영 콘솔 문법을 따른다. 스케줄러가 하루 종일 띄워 두는 업무 화면이라 숫자가 먼저 읽혀야 한다. 11-26부터 **라이트 테마만** 쓴다(다크 토큰은 `src/theme.css`에 남아 있고 주소에 `?theme=dark`를 붙이면 볼 수 있다). 화면은 지도·표·타임라인 같은 실제 데이터 표면으로 채우고, 꾸밈은 1px 선과 모서리 눈금 정도로 끝낸다.

참고한 자료:
- [Palantir Blueprint](https://blueprintjs.com/) — Palantir 공식 UI 툴킷. 이 프로토타입의 컴포넌트 바탕(데이터 밀도).
- [Mission Control DESIGN.md](https://github.com/nexu-io/open-design/blob/main/design-systems/mission-control/DESIGN.md) — 모노 수치, 대문자 패널 코드, 의미 색 체계.
- [palantir-for-family-trips DESIGN.md](https://github.com/andrewjiang/palantir-for-family-trips/blob/master/DESIGN.md) — 4px 단위, 직각 모서리.

영화 속 HUD처럼 네온 발광·스캔라인·글리치로 연출하지 않는다. 실제 Palantir 제품은 차분하다.

**Key Characteristics:**
- 화면 = 패널 격자. 패널은 1px 테두리 + 좌상·우하 모서리 눈금 + 머리 줄(영문 코드 · 한국어 제목 · 한 줄 설명 · 동작).
- 수치·시각·ID·금액은 JetBrains Mono, 한국어 문장은 Pretendard. 모노 글꼴에 한글을 넣지 않는다.
- 그림자·둥근 카드·그라데이션·유리 효과 없음. 깊이는 바탕 단계(chrome → canvas → panel → raised)로만.
- 색은 뜻이 있을 때만.

## Colors

### Surfaces
- **Chrome** (#ffffff): 상단 명령 바, 왼쪽 레일, 하단 상태 바.
- **Canvas** (#eef1f4): 작업 영역 바탕.
- **Panel** (#ffffff) / **Raised** (#f5f7f9): 패널 본문 / 패널 머리·표 머리.
- **Line** (#e2e7ec) / **Line Strong** (#cdd5dd) / **Tick** (#8f9cab): 행 구분 / 표 머리 아래·입력 테두리 / 패널 모서리 눈금.

### Named Rules
**The Meaning-Only Color Rule.** 주황(#c2410c, 주 동작 버튼 #d9481c · 11-25 시안에서 바꿈)은 선택·현재 위치·주 동작, 호박(#a85f00)은 대기·해당·주의, 빨강(#c42b36)은 체선 발생·위반·경보, 초록(#0f7f50)은 정상·절감, 보라(#5b45c7)는 판단 불가, 파랑(#1f5fc4)은 변경 값·링크. 뜻 없는 곳에 색을 칠하지 않는다. 상태는 바탕을 칠하지 않고 점 + 글자색(`.st`)으로 표시한다.

## Typography

- **Screen Title** (600, 17px): 화면 제목. 위에 영문 경로(`BERTH PLANNING / PLAN-COMPARE`)를 모노 10.5px로.
- **Panel Code** (mono 10.5px, 0.08em, 주황): `CAND-COST`, `BERTH-TL` 같은 짧은 식별자.
- **Panel Title** (600, 13px): 한국어 패널 제목.
- **Body** (400, 13px, 1.5): 표 칸과 본문.
- **Data** (mono 12px, tabular): 숫자·시각·금액. 금액은 오른쪽 정렬.
- **Stat Value** (mono 500, 18px): 요약 줄의 큰 수치.

모든 글씨 크기에는 `--fs` 배율을 곱한다(지금 1.0, 11-25~26에 1.2였다). 화면 전체 크기는 브라우저 확대로 맞춘다(시연은 75%).

## Layout

- 고정 틀: 상단 바 44px · 왼쪽 레일 212px · 하단 상태 바 24px. 작업 영역은 남은 화면 전체.
- 운영 현황은 스크롤 없는 한 화면 콘솔(지도 중심 + 좌우 패널 + 아래 표). 나머지 화면은 머리(경로·제목·단계·동작) + 스크롤 본문.
- 패널 사이 10px, 패널 안쪽 12px, 표 칸 좌우 10px.
- 최소 너비 1024px(데스크톱 업무 화면, 11-26 1280에서 줄임). 그보다 좁으면 가로 스크롤.

## Elevation & Depth

평면이다. 겹쳐 뜨는 것은 선박 카드 드로어와 사용법 안내 카드뿐이며, 이것도 바탕 단계와 1px 선으로 구분한다.

## Shapes

모서리 2px(버튼·입력), 패널과 표는 0. 패널 모서리 눈금은 7px 길이 1px 선.

## Components

Blueprint v6 라이트 테마를 쓰고, 주 동작 색만 주황 계열로 바꾼다(`--bp-intent-primary-*`). 아이콘은 Blueprint 아이콘만 쓴다.
