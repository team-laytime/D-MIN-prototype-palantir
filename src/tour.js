// 화면 전환은 AppProvider가 맡고, 안내는 각 화면의 data-tour 앵커만 참조한다.
export const TOUR = [
  {
    section: '현황 지도', tab: 'home', target: '[data-tour="plan-table"]', title: '안별 체선료',
    body: '도착순 기준안과 후보 A·B·C의 총 예상 체선료, 기준안 대비 차이, 선택한 시각까지 쌓인 금액입니다. 행을 누르면 지도와 선박 목록이 그 안으로 바뀝니다.',
  },
  {
    section: '현황 지도', tab: 'home', target: '[data-tour="time-dock"]', title: '시각 이동',
    body: '막대를 끌면 그 시각의 선박 위치가 지도에 표시됩니다. 빨간 구간은 기상 악화로 접안할 수 없는 시간입니다.',
    try: '재생 버튼을 누르면 30분씩 진행합니다.',
  },
  {
    section: '현황 지도', tab: 'home', target: '[data-tour="vessel-list"]', title: '선박 상태',
    body: '정박지 대기, 작업 중, 체선 발생으로 구분합니다. 선박을 누르면 지도가 그 위치로 이동하고, 「근거」는 계산 과정을 엽니다.',
  },
  {
    section: '공통', tab: 'home', target: '[data-tour="scen"]', title: '시나리오 전환',
    body: '데모 시나리오 3개 중 하나를 고릅니다. 바꾸면 모든 화면을 다시 계산합니다.',
  },
  {
    section: '시나리오 입력', tab: 'input', target: '[data-tour="inputs"]', title: '선박·계약 조건',
    body: '도착 예정 시각, 허용 시간, 하루 체선료, 기상 조항을 수정할 수 있습니다. 수정 즉시 후보를 다시 계산합니다.',
    try: 'GOLDEN STAR 도착 시각을 몇 시간 늦춰 후보 변화 확인',
  },
  {
    section: '시나리오 입력', tab: 'input', target: '[data-tour="env"]', title: '기상·조석',
    body: '기상 악화 예보를 끄거나 시간을 바꿉니다. 만조와 일출·일몰은 대형선의 접안 가능 시간을 정합니다.',
  },
  {
    section: '후보 비교', tab: 'compare', target: '[data-tour="cards"]', title: '기준안과 후보',
    body: '맨 왼쪽은 도착순 기준안(비교용, 현행 실적 아님)이고 나머지는 체선료가 낮은 후보입니다.',
    try: '후보를 누르면 아래 표가 그 후보로 바뀝니다.',
  },
  {
    section: '후보 비교', tab: 'compare', target: '[data-tour="tl-row-on"]', title: '부두별 타임라인',
    body: '막대 하나가 선박 한 척의 접안부터 작업 종료까지입니다. 주황은 체선 발생, 빗금은 기상 악화, 회색 띠는 야간, 점선은 도착 후 대기입니다.',
  },
  {
    section: '후보 비교', tab: 'compare', target: '[data-tour="drawer"]', title: '산출 근거',
    body: '정박시간 개시, 기상 공제, 적용한 계약 규칙, 접안이 밀린 이유를 단계별로 보여 줍니다.',
    do: ({ result, openVessel }) => {
      const candidate = result.candidates?.[0]
      const sample = candidate?.placements.find((p) => p.dem.cents > 0) ?? candidate?.placements[0]
      if (sample) openVessel(candidate.id, sample.vid, { mode: 'evidence' })
    },
  },
  {
    section: '리스크·선택', tab: 'risk', target: '[data-tour="risks"]', title: '남은 리스크',
    body: '날씨 급변, 설비, 탱크, 긴급 출하, 현장 안전을 해당 / 해당 없음 / 판단 불가로 판정하고 대안을 붙입니다.',
    try: '「해당」 항목을 읽고 「확인」 체크',
  },
  {
    section: '리스크·확정', tab: 'risk', target: '[data-tour="decide"]', title: '계획 확정',
    body: '사유를 적고 확정합니다. 확인하지 않은 리스크가 있으면 한 번 더 묻습니다. 확정과 취소는 스케줄러만 할 수 있고, 확정한 일정은 이용자 계정의 「확정 일정」에 그대로 전달됩니다. Agent는 계획을 확정하지 않습니다.',
  },
  {
    section: '보고서', tab: 'report', target: '[data-tour="report-doc"]', title: '보고서 생성',
    body: '위에서 후보안을 고르고 숙련자 판단근거를 적으면, 아래 미리보기에 후보 3개 비교·차트·후보별 분석·공통 리스크가 담긴 보고서가 만들어집니다. 금액은 계산 결과와 자동 대조합니다.',
  },
  {
    section: '보고서', tab: 'mail', target: '[data-tour="mail-compose"]', title: '메일 작성',
    body: '보고서와 같은 후보·판단근거로 메일 초안을 만듭니다. 받는 사람과 본문을 고쳐 쓴 뒤 복사하거나 메일 앱으로 넘깁니다. 이 화면에서 발송하지는 않습니다.',
  },
  {
    section: '검증', tab: 'verify', target: '[data-tour="answer-set"]', title: '계산 검증',
    body: '손계산 정답과의 일치 건수, 시나리오별 절감액, 제약 위반 수입니다.',
  },
  {
    section: '끝', tab: 'home', target: '[data-tour="help-btn"]', title: '다시 보기',
    body: '오른쪽 위 「사용법」에서 이 안내를 다시 열 수 있습니다.',
  },
]
