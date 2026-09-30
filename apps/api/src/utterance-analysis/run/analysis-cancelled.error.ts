/** 취소 요청이 관측되어 작업을 중단할 때 던지는 내부 예외 — 러너가 잡아 `CANCELLED`로 종결 처리한다(문장 0). */
export class AnalysisCancelledError extends Error {
  constructor() {
    super('ANALYSIS_CANCELLED');
    this.name = 'AnalysisCancelledError';
  }
}

/** 이벤트 루프 양보(대화 경로 보호 — NFR-DCP2). */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
