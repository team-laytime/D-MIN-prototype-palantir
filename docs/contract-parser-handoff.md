# 계약 문서 화면 ↔ 파서 연결 안내

브랜치 `feature/parser-view`. 계약 문서 담당(`contract` 계정)의 두 화면 「문서 등록」, 「추출값 검토」는 **화면만 있고 파서에 연결돼 있지 않다.**
파일을 올리면 미리 돌려 둔 파서 결과(합성 계약서 eval4 묶음)를 붙이는 흉내만 낸다. 이 문서는 파서(`D-MIN-contract`)를 붙일 사람이 바꿀 자리와 주고받을 데이터를 적는다.

## 1. 화면 구성

| 화면 | 파일 | 하는 일 |
|---|---|---|
| 문서 등록 (`docs`) | `src/screens/ContractDocs.jsx` | 파일 올리기(pdf · 스캔 pdf · docx · eml · txt), 메일 본문 붙여 넣기(recap), 등록 문서 목록과 추출 상태 · 예외 |
| 추출값 검토 (`terms`) | `src/screens/ContractTerms.jsx` | 선박(거래)별 추출값 표. 행을 펼치면 근거(스캔본은 원본 쪽에서 근거 줄을 잘라 확대 + 박스, 글자층 PDF는 원문 문장 강조), 「원본 보기」 드로어(문서 전체), 「원문과 일치」 · 같은 쪽 묶음 확인 · 문서 간 불일치 값 고르기 · 값 고치기 |
| 상태 저장소 | `src/state/useContract.js` | 등록 문서 · 검토 기록. **연결할 때 바꿀 곳은 거의 다 여기** |
| 변환 (순수 함수) | `src/lib/contract.js` (+ `contract.test.js`) | 파서 JSON → 화면 행. 검토 필수 판정, 양식 기본값, 값 표시 |
| 목업 | `src/mock/contract/` | eval4_llm 파서 출력 18건 + `deals.json` 일부, 스캔본 쪽 이미지(`pages/`), 원본 PDF · recap 텍스트(`files/`). 모두 합성 데이터 |

역할 · 메뉴는 `src/lib/workspace.js`(`ROLES.contract`, NAV `CONTRACT` 묶음)에 있다. 두 화면은 데이터셋 없이 열린다(`src/App.jsx`).

## 2. 바꿀 자리 (`src/state/useContract.js`)

| 지금 (흉내) | 연결하면 |
|---|---|
| `DOCS`: 목업 JSON을 `import.meta.glob`으로 읽음 | 파서가 돌려준 문서 JSON을 등록할 때마다 넣는다 |
| `DEALS`: 목업 `deals.json` | 등록된 문서로 파서 `reconcile`을 다시 돌린 결과 |
| `add()`의 `setTimeout`: 1.8초 뒤 `detectKind`(파일 이름 낱말)로 종류를 정하고 `POOL`에서 결과 하나를 붙임 | 파일을 파서로 보내고, 끝나면 결과를 붙인다. `POOL` · `EXTRACT_MS` · `detectKind`는 지운다 |
| 중복 판정: 파일 이름 | 내용 해시나 파서 `doc_id` |
| `pageImage()` · `pageCount()`: 목업 스캔본 2건(SYN-CP-304 · 315)의 원본 쪽을 그림으로 바꿔 둔 `src/mock/contract/pages/<doc_id>-<쪽>.jpg`. 없으면 `null` → 자리 표시 | 서버가 주는 쪽 이미지 주소와 쪽 수 |
| `docFile()`: 원본 전체 보기용. 스캔본은 쪽 이미지, 글자층 PDF는 `files/<doc_id>.pdf`(브라우저 PDF 보기), recap은 `files/<doc_id>.txt` | 서버가 주는 원본 파일 주소 |
| `review()`: 검토 기록을 브라우저 메모리에만 둠(새로고침하면 사라짐) | 파서의 검토 기록에 쓴다(5절) |
| `SEED`: 처음부터 등록된 문서 15건(오류 예시 3건 포함). 파일 이름은 합성 계약서 원본 이름 그대로 | 서버의 등록 목록 |

예외 표시는 `ERROR`의 키로 한다: `vessel`(선박명을 못 읽음), `kind`(종류 모름), `empty`(글자 없음), `duplicate`, `pool`(흉내 전용, 연결하면 지움). 파서 `run.extract_file`이 돌려주는 실패 이유 `"글자 없음(OCR 실패)"` → `empty`, `"종류 모름"` → `kind`로 맞추면 된다. 파서 실행 자체가 실패한 경우의 키는 아직 없다.

거래 key는 `deal.documents[0]`이다(`dealViews`). 문서가 더 등록돼 deals를 다시 만들면 첫 문서가 바뀔 수 있다. 그러면 그 거래의 검토 기록(`reviews["<key>:<칸>"]`)이 끊기니, 연결할 때 바뀌지 않는 key(예: IMO + laydays)로 바꾸는 게 좋다.

## 3. 화면이 받는 데이터

모양은 파서 저장소의 출력 그대로다. 화면은 파서 JSON을 고치지 않고 `contract.js`에서만 바꿔 쓴다.

**문서 하나** = `run.extract_file`의 결과(`data/out/<doc_id>.json`과 같은 모양)

```
{ doc_id, kind: "cp" | "recap" | "sales",
  cp | sales: { <칸>: { value, evidence } },     // recap도 "cp" 키
  link?: { vessel_name, imo, ... },               // 매매 확인서의 선박 · 물량
  review: [...] }                                 // 화면은 쓰지 않는다(4절)
evidence: { doc_id, page, section: "part1" | "rider" | "sales" | ..., quote, confidence, method: "rule" | "llm" | "manual", ocr, reviewed_by }
```

- 화면이 읽는 칸은 `contract.js`의 `FIELDS` 36개다. 그중 `weather`는 파서의 `weather_rule`과 `bad_weather_half`를 합친 화면 전용 칸이다.
- evidence에서 쓰는 것: `page`, `section`, `quote`(원문 문장, 값 위치는 화면이 문장 안에서 찾아 강조), `method`, `ocr`, `confidence`(LLM 안내 문구에만).
- SOF(`kind: "sof"`)는 화면이 다루지 않는다.
- 문서 JSON의 날짜는 `2028-04-03T00:00:00`, deals는 `2028-04-03 00:00`이다. 화면이 맞춰서 비교한다.

**거래 묶음** = `reconcile.reconcile`의 결과(`deals.json`)

```
[{ documents: [doc_id...], conflicts: [{documents, field, cp_value, other_value, resolved_value}],
   mismatches: [{sc, field, cp_value, sc_value, resolved_value}], cp_gaps: [{sc, field, cp_text, sc_value, resolved_value}] }]
```

`cross_checks`는 지금 화면이 쓰지 않는다.

**근거 위치와 쪽 이미지**:
- 화면은 evidence의 `boxes`(줄마다 `[x0, y0, x1, y1]`, 쪽 대비 비율, 왼쪽 위 0)로 근거 줄을 쪽 이미지에서 잘라 확대하고 박스를 친다(`Crop`). 원본 보기에서는 그 쪽의 근거를 모두 표시한다. `ocr_conf`는 「인식 신뢰도」로 보인다.
- 지금 파서(`layout.attach`)가 이미 `boxes` · `ocr_conf`를 내보낸다. 목업의 eval4_llm 출력은 그 전 것이라, 스캔본 두 건(SYN-CP-304 · 315)만 지금 파서로 다시 돌려(규칙 + tesseract, LLM 없이) `boxes` · `ocr_conf`를 옮겨 넣었다. 값은 eval4_llm 그대로다.
- 박스가 없는 근거(문자 인식이 값을 못 읽음, 특약에 조항이 없는지 확인하는 기본값)는 쪽 전체 썸네일과 원본 보기로 확인한다.
- 박스 품질은 문자 인식 문장 품질을 따른다. 깨진 긴 문장(예: SYN-CP-304 허용 정박시간)은 박스가 여러 줄에 걸치고, 몇몇 칸(IMO · DWT 등)은 한 줄 어긋나 있다. 파서 쪽에서 볼 부분이다.
- 쪽 이미지는 파서가 내보내지 않는다. 합성 스캔본은 한 쪽에 이미지 한 장이라 `ocr.page_images()`로 꺼낼 수 있다. 쪽 번호는 evidence의 `page`(1부터)다. 쪽 비율은 A4로 고정해 두었다(`PAGE_RATIO`).

## 4. 화면이 정한 규칙 (파서와 겹치는 것)

연결한 뒤에도 화면에 남는 판정이다. 파서 쪽에서 같은 규칙을 바꾸면 여기도 맞춰야 한다.

- **검토 필수** (`dealRows`):
  - 스캔본 문자 인식 값: `evidence.ocr`로 판정하고 confidence는 보지 않는다(스캔본 특약 값 0.8도 포함).
  - 글자층 C/P 없이 스캔본만 있을 때의 양식 기본값(「스캔본 특약 미확인」).
  - LLM 판정(`method: "llm"`).
  - 문서 간 불일치(deals).
  - C/P 요율 미확인.

  파서의 `review[]`는 쓰지 않는다. 「필수 칸 없음」 같은 이유가 화면 기준과 달라서다.
- **일 체선료**: 매매 확인서 `rate_basis`가 「CP 요율 준용」이면 C/P 값이 기준이다.
  - 값이 다르면 문서 간 불일치로 보고, C/P 값을 쓴다.
  - C/P에서 값을 못 읽었으면 매매 확인서 값을 임시로 쓰고 검토 필수로 둔다.
  - 「별도」 요율은 쓰지 않는다.

  `reconcile.py`와 같은 규칙이다.
- **출처와 확인할 곳**: 표의 「출처」는 적용값을 가져온 곳이다. 둘이 다른 행은 출처에 「(임시)」 · 「(양식 기본값)」을 붙이고 「확인할 곳」을 따로 보인다(행의 `srcTag` · `check`).
  - C/P 요율 미확인: 값은 매매 확인서에서 임시로, 확인은 C/P에서(파서가 C/P 값을 못 읽음).
  - 스캔본 특약 미확인: 값은 양식 조항에서, 확인은 스캔 C/P 특약에서. 특약 쪽 범위는 파서가 내주지 않아 「특약 근거가 나온 첫 쪽 ~ 문서 끝」으로 추정한다(`riderRange`, `shortcut:`).
- **문서 우선순위**: C/P → recap → 매매 확인서 순이다. 같은 종류 안에서는 글자층 있는 문서가 스캔 사본보다 앞이다(`reconcile`과 같음).
- **양식 기본값** (`FORM_DEFAULTS`): ASBATANKVOY 2025 Part II 기본값 8개를 `llm.py` 프롬프트에서 옮겨 적은 것이다. 출처 칸에는 조항 원문이 아니라 요약 문장이 나온다. 파서 쪽에 양식별 기본값 표가 생기면 그걸 읽게 바꾼다(`shortcut:` 주석).
- **기상 조항**: 파서는 산입 기준(FULL · HALF · NONE)이고 계산은 공제 기준(`weather_deduct_pct`)이다. FULL → 0, HALF → 50, NONE → 100(`weatherDeductPct`).

## 5. 아직 없는 것

- **검토 결과 모양**: 화면의 검토 기록은 `{by, at}`(원문과 일치 · 변경 조항 없음), `{by, at, value}`(직접 수정), `{by, at, value, from}`(문서 간 불일치에서 고른 문서 값)이다. 같은 쪽 묶음 확인은 칸마다 `{by, at}`를 남긴다.

- **검토 기록 저장**: 파서에 이미 저장소가 있다. `cp_extract/edits.py`의 `data/review/edits.jsonl`이고, 한 줄에 `{at, by, doc, field, action: confirm|set, old, new, note}`이며 덧붙이기만 한다. 화면의 「원문과 일치」는 `confirm`, 「고친 값 저장」은 `set`에 맞는다. `reconcile.load`가 이 기록을 반영한다.
  - 화면의 검토 key는 거래 단위(`<거래 key>:<칸>`)이고 파서는 문서 단위(`doc`, `field`)다. 쓸 때 그 행의 출처 문서(`row.src.doc_id`)로 바꿔야 한다.
  - 양식 기본값 행은 출처 문서가 없다. 「변경 조항 없음 확인」을 어디에 남길지 정해야 한다.
- **계산 연결 · 재산출**: 고친 값은 계약 화면 상태에만 남는다. 계산 쪽 계약 조건은 `scen.vessels[].contract = {laytimeH, rateUsd, noticeH, weatherPct, cfr}`이고, 데이터셋에서만 만들어진다(`src/lib/dataset.js` 171행). `buildRequest`는 ETA만 되돌려 쓴다. 이어 붙이려면 아래처럼 맞추면 되는데, 계약 문서의 선박과 데이터셋 선박을 잇는 기준(IMO 등)부터 정해야 한다.
  - `laytime_total_h` → `laytimeH`
  - `demurrage_rate_per_day` → `rateUsd`
  - `nor_notice_h` → `noticeH`
  - `weather` → `weatherPct`
- **관리자 화면**: 계정 관리의 역할 목록(`src/lib/accounts.js` `ROLE_LABELS`)에 계약 담당이 없다.

## 6. 연결할 때 알아 둘 것

- **시간**: 파서는 느리다. 특약 조항을 로컬 Ollama(`qwen3:8b`)로 읽어서다.
  - 글자층 C/P 한 건(SYN-CP-302)을 LLM과 함께 추출하는 데 3분 27초 걸렸다(11-26에 한 번 잰 값, LLM 캐시가 거의 비어 있었음).
  - 스캔본 OCR은 tesseract로 하면 그보다 빠르고, 비전 모델(`qwen2.5vl:7b`)로 하면 쪽당 40~60초다.

  그래서 올리기는 「추출 중」 상태로 두고 끝나면 붙이는 비동기 흐름이어야 한다(화면은 이미 그렇게 그려짐). 한 PC에서 Ollama 모델이 번갈아 올라가면 몇 배 느려진다(`llm.check_busy`). 파서 호출은 한 번에 하나씩 하는 게 안전하다.
- **기밀**: 파서 저장소는 계약 원본, OCR 결과, 추출 결과(원문 인용 포함)를 기밀로 다룬다(`.gitignore`의 `data/`). 서버를 붙이면 올린 파일과 중간 결과를 같은 규칙으로 두고, 로그에 원문 · 파일 이름을 찍지 않는다. 목업에 넣은 것은 합성 eval4 묶음뿐이다.
- **시연 날짜**:
  - 목업 JSON의 날짜는 상단 기준 시각(2025-11-09 09:00)에 맞춰 옮겨 두었다. Laydays는 11-10~11-18이고, 처음부터 등록된 문서는 11-05~11-08에 등록한 것으로 했다.
  - 파서가 실제로 돌린 결과와 원본 PDF 쪽 이미지는 원래 날짜(2028년)다. 그래서 화면은 스캔 이미지 아래에 「원본 날짜 그대로, 화면 값은 시연용으로 옮긴 날짜」라고 적는다. 실제 문서를 붙이면 날짜 옮기기도 이 문구도 필요 없다.
  - `useContract.js`의 시연 시계(`T0`)도 같은 이유로 2025-11-09에 고정돼 있다.
- **접근 권한**: 계약 메뉴는 `contract` 역할에만 보인다. 다른 역할이 주소로 들어오면 `go()`가 그 역할의 첫 화면으로 돌려보낸다.
- **올릴 수 있는 형식**: 화면의 파일 선택은 `.pdf,.docx,.eml,.txt`다(`ContractDocs.jsx`의 `accept`). 파서가 읽는 형식과 같다.

## 7. 지금 화면 시험

`bun run dev`(또는 `npm run dev`)로 띄우고 http://localhost:5175 에 `contract` 계정으로 들어간다. 비밀번호는 다른 시연 계정과 같다. 변환 테스트는 `node --test src/lib/*.test.js`이다.

시연 순서:
1. 「메일 본문 붙여 넣기」에 `Fixture recap - SYN BELLATRIX`를 넣으면 「recap만 있음」이 된다.
2. 이어서 `SYN-CP-312.pdf`(또는 이름에 `BELLATRIX`와 `CP`가 들어간 PDF)를 올리면 문서 간 불일치 1건이 생긴다. 흉내라서 올린 파일 내용은 읽지 않고, 파일 이름에 든 문서 번호 · 선박명으로 미리 돌린 결과를 고른다.
3. 「추출값 검토」에서 SYN VEGA(스캔 C/P)를 열면 스캔본 검토 흐름을 볼 수 있다. 「일 체선료」를 펼쳐 원본 2쪽으로 넘기면, 문자 인식이 못 읽은 요율(USD 46,300)이 원본에 있는 것을 볼 수 있다.
