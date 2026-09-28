/**
 * 통합 시험 전용 "결과적 일관성" 대기 헬퍼.
 *
 * 공개 메시지 응답 뒤에 일어나는 부수 작업(대화 로그 적재 `ConversationLogService.record()` 등)은
 * 의도적으로 발사 후 망각(void)이라 — 응답 직후에는 목록·DB에 아직 결과가 없을 수 있다(NFR-P6).
 * 그런 결과를 읽는 시험은 고정 지연 대신 이 헬퍼로 **조건이 참이 될 때까지** 폴링한다.
 * (`docs/04-test/자동시험_전략.md` "간헐 실패(flaky) 방침" 참고)
 */

/** `check`가 truthy 값을 돌려줄 때까지 폴링한다. 시간 안에 안 되면 `label`이 담긴 오류로 실패한다. */
export async function waitFor<T>(
  check: () => Promise<T | null | undefined | false>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 50;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() >= deadline) throw new Error(`waitFor 시간 초과(${timeoutMs}ms)${opts.label ? `: ${opts.label}` : ''}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

interface LiveSessionListResponse {
  body: { items?: Array<{ sessionRef: string }> };
}

/**
 * 진행 중 상담 목록(`GET /chatbots/:id/live-sessions`)에 첫 세션이 나타날 때까지 기다렸다가 그 `sessionRef`를 돌려준다.
 * `fetchList`는 각 시험 파일의 `jsonRequest` 호출(쿠키 포함)을 감싼 함수다.
 */
export async function waitForLiveSessionRef(fetchList: () => Promise<LiveSessionListResponse>, label = 'live-sessions 첫 세션'): Promise<string> {
  return waitFor(async () => (await fetchList()).body.items?.[0]?.sessionRef, { label });
}
