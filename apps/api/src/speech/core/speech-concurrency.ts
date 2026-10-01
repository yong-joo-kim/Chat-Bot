/**
 * [신규 No.32] 비대기 세마포어(voice-ai-설계.md §5.3 9단계 · DD-122) — **대기열 0**: 자리가 없으면 즉시 `null`을 돌려준다
 * (초과 요청은 `503 SPEECH_BUSY`). 반환된 해제 함수는 여러 번 불러도 한 번만 반납한다. 순수 — Nest·DB 무의존.
 */
export class NonBlockingSemaphore {
  private inUse = 0;

  constructor(private readonly max: number) {}

  tryAcquire(): (() => void) | null {
    if (this.inUse >= this.max) return null;
    this.inUse += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse -= 1;
    };
  }

  get active(): number {
    return this.inUse;
  }
}
