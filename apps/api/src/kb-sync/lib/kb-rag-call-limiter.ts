import { ConfigService } from '@nestjs/config';

/** DI 토큰 — `kb-sync.module.ts`가 `ConfigService`의 `KB_RAG_CALLS_PER_MIN`으로 1개만 생성해 등록한다. */
export const KB_RAG_CALL_LIMITER = Symbol('KB_RAG_CALL_LIMITER');

export function createKbRagCallLimiter(config: ConfigService): KbRagCallLimiter {
  return new KbRagCallLimiter(config.get<number>('KB_RAG_CALLS_PER_MIN') ?? 30);
}

/**
 * [신규 No.43 — 항목④ · §5.8 · NFR-KBP3] 인스턴스별 토큰 버킷 — 적재(`ingest`) + 작업 조회
 * (`taskStatus`) + 상태 확인(`status`) 호출 합계를 분당 `KB_RAG_CALLS_PER_MIN`으로 제한한다(질의
 * 전용 동시성·회로 서비스와는 완전히 별도 — 제약 ⑫, 방어 이중화). 직전 60초 슬라이딩 윈도 방식이라
 * 고정 타이머 없이 `now`만으로 순수하게 판정할 수 있다(테스트 용이성 — 실시각 sleep 불필요).
 */
export class KbRagCallLimiter {
  private readonly callTimestampsMs: number[] = [];

  constructor(private readonly limitPerMinute: number) {}

  /** 호출 가능하면 이번 호출 시각을 버킷에 기록하고 true, 한도 초과면 기록하지 않고 false. */
  tryAcquire(now: Date): boolean {
    const nowMs = now.getTime();
    const windowStartMs = nowMs - 60_000;
    while (this.callTimestampsMs.length > 0 && this.callTimestampsMs[0] <= windowStartMs) {
      this.callTimestampsMs.shift();
    }
    if (this.callTimestampsMs.length >= this.limitPerMinute) return false;
    this.callTimestampsMs.push(nowMs);
    return true;
  }
}
