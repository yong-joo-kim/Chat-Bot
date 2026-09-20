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
} as const;
