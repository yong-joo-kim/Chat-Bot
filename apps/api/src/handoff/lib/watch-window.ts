export interface WatchWindowInput {
  /** 세션의 마지막 턴 시각(로그가 없으면 null). */
  lastTurnAt: Date | null;
  /** 마지막 턴이 관찰 창을 여는 조건(§5.5 — 미응답 ∧ 차단 아님 ∧ 설문/상담 구간 아님)을 만족했는가. */
  lastTurnUnanswered: boolean;
  now: Date;
  watchWindowMs: number;
}

/**
 * 개입 시점에 관찰 창이 이미 닫혔거나(또는 애초에 열린 적이 없거나) 판정한다(순수 함수, EX-CS-3,
 * §1.3.2). true면 위젯이 지금 상담 폴링을 하고 있지 않다는 뜻이라 개입 사실(연결 안내·상담원 메시지)
 * 전달이 사용자의 다음 발화 응답까지 보류된다 — 콘솔이 "사용자가 다음에 말할 때 연결됩니다" 안내를
 * 띄우는 근거다.
 */
export function isWatchWindowMissed(input: WatchWindowInput): boolean {
  if (!input.lastTurnUnanswered || input.lastTurnAt === null) return true;
  return input.now.getTime() - input.lastTurnAt.getTime() >= input.watchWindowMs;
}
