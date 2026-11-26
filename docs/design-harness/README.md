# 관리자 디자인 품질 관리

이 체계는 관리자 섹션 개선에 사용한 실제 기록이다. 다른 화면을 작업할 때도 같은 원칙과 루브릭을 사용할 수 있으나, 해당 화면의 수정 권한과 데이터 조건은 새로 확인한다.

- [설계 원칙·세 방향 비교](design-principles.md)
- [불필요한 요소 검토](anti-ai-slop.md)
- [고정 평가표](evaluation-rubric.md)
- [Baseline 감사](baseline-audit.md)
- [실제 반복·평가·복귀 이력](iteration-log.md)
- [최종 납품 보고서](final-review.md)

## 필수 검증의 재실행

기존 설치 환경과 Chrome을 사용한다. **의존성을 설치하거나 lock/config를 바꾸지 않는다.** 개발 서버를 실행한 뒤 필요한 검사만 고른다.

```bash
npm run dev
node --test src/lib/accounts.test.js
node scripts/design-qa/verify.mjs candidate
node scripts/design-qa/capture.mjs candidate
npm run build
```

`verify.mjs`는 관리자 변경의 필수 상태 전이·키보드·반응형·실패 복구와 기존 로그인/두 역할 메뉴를 확인한다. 전체 운영 업무의 회귀 검사가 아니다. `capture.mjs`는 시각 변경을 비교할 때만 실행한다. 문서만 변경했거나 이미 같은 제품 코드에서 통과한 검사를 근거 없이 반복하지 않는다.

환경변수 `CHROME_BIN`으로 기존 Chrome 실행 경로, `DESIGN_QA_URL`로 테스트 서버 주소를 지정할 수 있다. 임시 브라우저 프로필을 생성·정리하며 실제 사용자 브라우저나 저장소를 변경하지 않는다. QA 시계는 2026-11-25 10:00 KST로 고정한다. 모달 캡처는 애니메이션이 끝난 후 촬영한다.

## 증거 읽기

`evidence/<단계>/capture.json`, PNG, `verification.json`, `contrast.json`을 함께 읽는다. 캡처만으로 기능 통과를, 테스트 통과만으로 디자인 품질을 추정하지 않는다. 실패한 시도와 미검증은 `iteration-log.md`와 `final-review.md`에 남긴다.

가시 텍스트 대비 검사는 현재 DOM 표본에 대한 계산이다. 전체 WCAG 적합성, 스크린리더 발화, 실제 고객 인수 승인을 대신하지 않는다. 서버 인증·실계정 API·메일 발송이 미연동인 프로토타입을 운영 납품 완료로 보고하지 않는다.
