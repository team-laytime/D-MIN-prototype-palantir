// 화면 전환은 AppProvider가 맡고, 안내는 각 화면의 data-tour 앵커만 참조한다.
export const TOUR = [
  {
    section: '현황 지도', tab: 'home', target: '[data-tour="plan-table"]', title: '안별 체선료',
    body: '후보 A·B·C의 총 예상 체선료, 최저안 대비 차이, 선택한 시각까지 쌓인 금액입니다. 행을 누르면 지도와 선박 목록이 그 안으로 바뀝니다.',
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
    section: '공통', tab: 'home', target: '[data-tour="scen"]', title: '데이터셋',
    body: '데이터 팀 묶음에서 만든 실데이터셋(기준 시각, 계획 기간)을 고릅니다. 바꾸면 그 데이터셋의 엔진 계산 결과로 모든 화면이 바뀝니다.',
  },
  {
    section: '시나리오 입력', tab: 'input', target: '[data-tour="inputs"]', title: '선박·계약 조건',
    body: '도착 예정 시각과 부두 사용 불가 구간, 엔진 조절값을 고칠 수 있습니다. 계약 값은 잠겨 있습니다. 고친 뒤 「다시 계산」을 누르면 팀 엔진이 후보 3개를 새로 만듭니다(약 1분).',
    try: 'GOLDEN STAR 도착 시각을 몇 시간 늦춰 후보 변화 확인',
  },
  {
    section: '시나리오 입력', tab: 'input', target: '[data-tour="env"]', title: '기상',
    body: '울산 부이 관측 풍속입니다. 엔진은 풍속 기준을 넘는 시간에 하역을 멈추거나 접안을 막고, 일출·일몰로 야간 도선 제한과 정박개시를 계산합니다.',
  },
  {
    section: '후보 비교', tab: 'compare', target: '[data-tour="cards"]', title: '후보 3개',
    body: '같은 기준 시각에서 엔진 파라미터만 바꿔 만든 계획 3개입니다. 체선료가 낮은 순서로 A, B, C이고 A가 기본 선택입니다. 실제 계획(실제 부두와 접안 시각) 대비 금액도 함께 봅니다.',
    try: '후보를 누르면 아래 표가 그 후보로 바뀝니다.',
  },
  {
    section: '후보 비교', tab: 'compare', target: '[data-tour="tl-row-on"]', title: '부두별 타임라인',
    body: '부두마다 한 줄이고, 막대 하나가 선박 한 척의 접안부터 이안까지입니다. 체선이 생기는 배와 야간 접안은 색으로 구분합니다.',
  },
  {
    section: '후보 비교', tab: 'compare', target: '[data-tour="drawer"]', title: '산출 근거',
    body: '도착, 정박시간 개시, 접안, 작업, 호스 분리, 이안 시각과 체선 시간, 기상 공제, 체선료를 엔진 계산값 그대로 보여 줍니다.',
    do: ({ result, openVessel }) => {
      const candidate = result.candidates?.[0]
      const sample = candidate?.placements.find((p) => p.dem.cents > 0) ?? candidate?.placements[0]
      if (sample) openVessel(candidate.id, sample.vid, { mode: 'evidence' })
    },
  },
  {
    section: '리스크·선택', tab: 'risk', target: '[data-tour="risks"]', title: '남은 리스크',
    body: '체선 발생, 야간 접안, 기상 하역 중단, 긴 대기, 탱크 범위 이탈을 엔진 결과에서 읽어 해당 / 해당 없음으로 보여 주고 대응을 붙입니다.',
    try: '「해당」 항목을 읽고 「확인」 체크',
  },
  {
    section: '리스크·확정', tab: 'risk', target: '[data-tour="decide"]', title: '계획 확정',
    body: '사유를 적고 확정합니다. 확인하지 않은 리스크가 있으면 한 번 더 묻습니다. 확정과 취소는 스케줄러만 할 수 있고, 확정한 일정은 이용자 계정의 「확정 일정」에 그대로 전달됩니다. Agent는 계획을 확정하지 않습니다.',
  },
  {
    section: '통보', tab: 'mail', target: '[data-tour="mail-compose"]', title: '부서별 확정 통보 메일',
    body: '부서마다 템플릿과 첨부가 다릅니다. 부두 하역팀과 입출항 작업지시자에게는 전체확정일정.xlsx가, 체선료 지불 부서에게는 접안계획 보고서가 붙고, 생산팀은 입고, 출하 일정과 탱크 재고만 본문으로 받습니다. 보낸 메일은 메일함의 보낸메일함에 남습니다.',
  },
  {
    section: '검증', tab: 'verify', target: '[data-tour="answer-set"]', title: '계산 검증',
    body: '팀 최적화 엔진 계산값과의 일치 건수, 시나리오별 절감액, 제약 위반 수입니다.',
  },
  {
    section: '메일함', tab: 'inbox', target: '[data-tour="inbox-list"]', title: '메일함',
    body: '받은메일함에는 기상 특보, 입력 변경, 현장 돌발 상황, 확정 알림이 메일로 들어옵니다. 돌발 상황은 있을 때만 보이고, 메일을 열어 반영할지 정합니다. 보낸메일함에는 보낸 확정 통보 메일이 남습니다.',
  },
  {
    section: '검증', tab: 'activity', target: '[data-tour="activity-log"]', title: '활동 기록',
    body: '입력 수정, 후보 선택, 판단근거, 리스크 확인, 확정·취소, 보고서·메일 작업을 누가 언제 했는지 남깁니다. 기록은 추가만 되고 CSV로 내보낼 수 있습니다.',
  },
  {
    section: '끝', tab: 'home', target: '[data-tour="help-btn"]', title: '다시 보기',
    body: '오른쪽 위 「사용법」에서 이 안내를 다시 열 수 있습니다.',
  },
]
