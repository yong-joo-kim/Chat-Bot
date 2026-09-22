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
} as const;
