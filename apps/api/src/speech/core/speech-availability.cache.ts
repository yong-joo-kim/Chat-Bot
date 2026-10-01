/**
 * [신규 No.32] 공급자 상태 캐시(voice-ai-설계.md §5.1 · DD-123) — **성공 N ms · 실패 N/3 ms**. 만료되면 직전 값을 즉시 돌려주고
 * 호출자가 백그라운드 갱신을 시작한다(`needsRefresh`). 프로세스가 아직 값을 한 번도 갖지 못했으면 `undefined`. 순수 — 시계 주입.
 */
export class SpeechAvailabilityCache {
  private slot: { value: boolean; at: number } | null = null;

  constructor(
    private readonly successTtlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private ttlFor(value: boolean): number {
    return value ? this.successTtlMs : Math.max(1, Math.floor(this.successTtlMs / 3));
  }

  /** 마지막으로 알려진 값(만료 여부 무관). 한 번도 없으면 `undefined`. */
  peek(): boolean | undefined {
    return this.slot?.value;
  }

  needsRefresh(): boolean {
    if (!this.slot) return true;
    return this.now() - this.slot.at >= this.ttlFor(this.slot.value);
  }

  set(value: boolean): void {
    this.slot = { value, at: this.now() };
  }

  /** 인식 요청이 인프라 실패로 끝났을 때 — 즉시 `false`(다음 설정 조회부터 마이크 숨김). */
  markUnavailable(): void {
    this.set(false);
  }
}
