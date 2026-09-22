import { Injectable } from '@nestjs/common';
import type { WindowEntry } from './lib/rate-limiter';
import { consume } from './lib/rate-limiter';

/**
 * 레이트리밋 저장소 인터페이스(ADR-0007 `ImportStagingStore` 패턴 3회차). 단일 인스턴스 전제이며
 * 다중 인스턴스 전환 시 교체 지점은 이 인터페이스 1곳이다(§8.6).
 */
export interface RateLimitStore {
  consume(key: string, now: number, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number };
}

@Injectable()
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly entries = new Map<string, WindowEntry>();
  private lastSweep = 0;

  consume(key: string, now: number, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
    this.sweepIfDue(now, windowMs);
    const result = consume(this.entries.get(key), now, limit, windowMs);
    this.entries.set(key, result.entry);
    return { allowed: result.allowed, retryAfterSec: result.retryAfterSec };
  }

  /** 만료된 항목을 지연 정리한다(윈도 10개 경과마다) — 메모리 누수 방지, 매 요청 스캔은 피한다. */
  private sweepIfDue(now: number, windowMs: number): void {
    if (now - this.lastSweep < windowMs * 10) return;
    this.lastSweep = now;
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartMs >= windowMs * 2) this.entries.delete(key);
    }
  }
}
