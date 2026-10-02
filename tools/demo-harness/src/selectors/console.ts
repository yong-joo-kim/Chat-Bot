// 관리 콘솔 선택자 단일 출처(NFR-DHM1 · 설계 §9.3 · §10) — 보이는 문구/접근성 이름 기반, data-testid 0.
// 문구는 apps/web/src/constants/*.messages.ts 에서 복사한 값이며 단위 시험 H-T9가 원문과 대조한다(제품 소스는 import하지 않는다).
// 같은 이름 버튼이 2개인 곳(화면 버튼 vs 확인 대화상자)은 대화상자 범위(`dialog(...)`)로 한정한다.
// 숫자가 들어가는 문구는 함수로 두고, H-T9는 숫자를 기준으로 조각을 나눠 원문에 조각이 모두 있는지 확인한다.
import type { FrameLocator, Locator } from 'playwright-core';

export const CONSOLE_TEXT = {
  common: { save: '저장', cancel: '취소', confirm: '확인', close: '닫기' },
  intents: { newExampleLabel: '새 예문 입력', addExample: '추가' },
  nodes: { totalLabel: (n: number) => `총 ${n}건` },
  answerSettings: {
    semanticLabel: '의미 매칭 사용',
    saveSuccess: '저장되었습니다. 다음 턴부터 적용됩니다.',
  },
  simulator: { composerLabel: '메시지 입력', send: '전송', showTrace: '판정 근거 보기' },
  // 장면 5 · 환경(운영 전환 2인 승인) — constants/messages.ts · switchApproval.messages.ts
  environment: {
    headerBadge: (prodNo: number, stagingNo: number) => `운영 v${prodNo} · 스테이징 v${stagingNo}`,
    policyOnPrefix: '켜짐 — 요청한 뒤',
    requestButton: '운영 전환 승인 요청...',
    requestConfirm: (n: number) => `v${n} 승인 요청 보내기`,
    requestSuccess: '승인 요청을 보냈습니다. 다른 관리자가 승인하면 운영에 반영됩니다.',
    rollbackButton: '직전 버전으로 되돌리기...',
    soloAck: '승인 없이 바로 실행됨을 이해했습니다',
    soloConfirm: (n: number) => `v${n}로 즉시 되돌리기(승인 없이)`,
    /** 전환 이력 표의 "방식" 열 — 예약이 자동으로 실행된 기록. */
    historyScheduled: '예약 전환 실행',
  },
  approvals: {
    detailLinkLabel: (chatbotName: string) => `${chatbotName} 승인 요청 자세히 보기`,
    approveNow: '승인하고 운영에 적용',
    approveConfirm: '승인',
    appliedBanner: (n: number) => `v${n}을 운영에 적용했습니다.`,
  },
  auditTargetApproval: '운영 전환 승인 요청',
  // 장면 6 · 상담 콘솔 대화 보기 · 걸린 기록 · 데이터 거버넌스
  transcript: { title: '대화 보기', piiNotice: '개인정보는 자동으로 가려진 상태로 표시됩니다.' },
  guardrailEvents: { appliedReplace: '안전 문구로 대체' },
  governance: { egressTitle: '외부 전송(출구)', retentionTitle: '보존 정책', retentionConversationKind: '대화 로그 본문' },
  // 장면 7 · 발화 묶음 분석
  analysis: {
    /** 파일 입력의 접근성 이름 — FileUploadField는 `<label htmlFor>`에 "파일 선택"을 쓰고 "발화 파일"은 보조 글자(sr-only)에만 쓴다. */
    fileInputLabel: '파일 선택',
    previewDone: (valid: number) => `파일 검사를 마쳤습니다. 분석할 발화는 ${valid}개입니다`,
    submit: '분석 시작',
    clusterCaption: '묶음 목록 — 발화가 많은 순 · 미분류는 맨 끝',
    showUtterances: (no: string) => `${no}번 묶음의 발화 보기`,
    filterUnapplied: '아직 안 넣은 것만',
    utteranceCaption: '발화 목록 — 필터와 페이지에 따라 바뀝니다',
    selectionCount: (n: number, max: number) => `${n}개 선택됨 — 최대 ${max}개`,
    applyOpen: '선택한 발화를 의도 예문으로 넣기',
    applyTargetExisting: '이미 있는 의도에 넣기',
    applyIntentPickerLabel: '의도 검색',
    applyPreviewButton: '미리보기',
    applyStep2: '2/3 확인',
    applyStep3: '3/3 결과',
    applyConfirm: (n: number) => `예문 ${n}개 넣기`,
    applyResultPrefix: '넣은 문장',
    applyDone: '닫기',
    // [DT-2] 엑셀로 받기(UA-3 상세) — messages.ts utteranceAnalysis
    exportButton: '엑셀로 받기',
    exportDone: '엑셀을 내려받았습니다. 받은 기록이 남습니다.',
  },
  // [DT-2] 음성(채널 탭 WEB 카드 펼침) — messages.ts voice
  voice: {
    entryButton: '음성',
    ttsToggleLabel: '답변 듣기 사용',
    serverOk: '음성 인식 서버를 사용할 수 있습니다.',
    serverMock: '시험용 모의 인식으로 동작 중입니다.',
    serverDisabled: '서버에서 음성 인식이 꺼져 있습니다.',
    statsCaption: '일별 음성 인식 숫자',
    governanceTitle: '음성(눌러서 말하기 · 답변 듣기)',
    governanceTts: '답변 읽기: 사용자 기기 안에서 처리(기기 안 음성만) · 서버 전송 0',
    governanceAudio: '음성 원본: 저장 0 · 디스크 기록 0 · 사내 음성 인식 프로세스로만 전송 · 가림 불가',
  },
  // [DT-2] 선제 안내(채널 탭 WEB 카드 펼침) — messages.ts proactive
  proactive: {
    entryButton: '선제 안내',
    listCaptionPrefix: '선제 안내 규칙',
    statsButton: '통계 보기',
    previewButton: '미리보기',
    statsTitle: '선제 안내 통계',
  },
  // [DT-2] 가드레일 현황 — guardrails.messages.ts overview
  guardrailOverview: { title: '현황', cardsLabel: '요약', ruleTableCaption: '규칙별 걸린 횟수', replacedLabel: '안전 문구로 바뀜' },
} as const;

/** 문구 한 곳에서 만드는 도우미 — 같은 이름의 버튼이 둘 이상이면 호출자가 범위(card 등)를 한정한다. */
export const consoleUi = {
  /** 열린 대화상자(제품 자체 ConfirmDialog·편집 모달). */
  dialog: (c: FrameLocator): Locator => c.getByRole('dialog').last(),
  /** 목록의 이름 버튼(의도 이름은 버튼으로 렌더된다). */
  nameButton: (c: FrameLocator, name: string): Locator => c.getByRole('button', { name, exact: true }).first(),
  toast: (c: FrameLocator, text: string): Locator => c.getByText(text, { exact: false }).first(),
};
