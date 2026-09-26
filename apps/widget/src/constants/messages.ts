/** 위젯 한국어 문구 1곳(FR-0-23, FR-W-14). `apps/web`의 `MESSAGES`와 공유하지 않는다(§0-9). */
export const MESSAGES = {
  launcherLabel: '상담 시작하기',
  closeLabel: '상담창 닫기',
  inputLabel: '메시지 입력',
  send: '전송',
  sending: '응답 생성 중',
  remaining: (n: number) => `${n}자 남음`,
  retry: '다시 시도',
  errorNetwork: '일시적인 오류가 발생했어요. 다시 시도해 주세요.',
  errorRateLimited: '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  errorDisabled: '현재 상담을 이용할 수 없습니다.',
  errorUnknown: '문제가 발생했어요. 잠시 후 다시 시도해 주세요.',
  emptyOutputsFallback: '잠시 후 다시 시도해 주세요.',
  stateResetNotice: '대화가 만료되어 새로 시작합니다.',
  /** [신규 No.42] 식별 `sub` 변경(로그인 전환·로그아웃) 시 새 대화 안내(`omnichannel-inbox-설계.md` §6.8). */
  identityChangedNotice: '새 대화를 시작했어요.',
  buttonGroupLabel: '선택지',
  sourcesLabel: '출처',
  sourcesCaption: '참고용 표시이며 정확한 위치가 아닐 수 있습니다.',
  /** PENDING(2단계 RAG) 답변 대기 문구(FR-N2-38/39, `nlu-rag-answering-ui-spec.md` §4.4). */
  pending: {
    /** `#cb-status`에 진입 시 1회만 기록한다(매 폴링 tick마다 갱신하지 않음). */
    statusAnnounce: '문서를 확인하고 있어요',
    readyAnnounce: '답변이 도착했습니다',
    /** 폴링 중단(FAILED/404/TTL 만료/90초 초과) 공통 정리 문구 — 오류로 표시하지 않는다(S-15). */
    timeoutFallback: '지금은 답변을 준비하지 못했어요.',
  },
  /**
   * 하이브리드 CS(No.24) 상담 모드 문구(ADR-0036 §14, §4.5·§10.1). **연결·종료·연결 실패 안내는
   * 서버 설정값이 원천**이며(`HandoffMessage`의 `SYSTEM` 텍스트로 도착) 아래 상수는 네트워크 실패
   * 등으로 서버 문구를 받기 전 `#cb-status` 영역에 즉시 표시하는 폴백일 뿐이다.
   */
  agentLabel: '상담원',
  handoffConnectAnnounce: '상담원이 연결되었어요. 잠시만 기다려 주세요.',
  handoffEndAnnounce: '상담이 종료되었어요. 이제 챗봇이 도와드릴게요.',
  handoffFailAnnounce: '지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요.',
  handoffUnverified: '지금은 메시지를 보낼 수 없어요. 잠시 후 다시 시도해 주세요.',
  handoffPollUnstable: '연결이 원활하지 않아요',
  handoffRestoreNotice: '이전 챗봇 대화는 다시 표시되지 않아요',
  handoffNodeSelectionPrefix: (label: string) => `[선택] ${label}`,
  /**
   * 피드백 기반 개선 루프(No.44) 위젯 문구 전체 목록(`feedback-loop-ui-spec.md` §3.2.5). 이 7개가
   * 위젯이 평가와 관련해 사용자에게 보여주는 **모든** 문구다.
   */
  feedback: {
    groupLabel: '답변 평가',
    up: '도움이 됐어요',
    down: '도움이 안 됐어요',
    thanks: '의견을 보내 주셔서 고마워요',
    saveFailed: '저장하지 못했어요',
    unavailable: '지금은 의견을 받을 수 없어요',
    locked: '더 이상 바꿀 수 없어요',
  },
} as const;
