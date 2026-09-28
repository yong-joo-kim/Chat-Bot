import { Injectable } from '@nestjs/common';

/** 다른 요청이 이 호스트를 쥐고 있을 때(`acquire` ~ `release` 사이) 다시 확인하기까지의 대기 — 짧게 끊어 확인한다. */
const BUSY_POLL_MS = 50;

/**
 * [신규 No.43] 호스트별 속도 제한(§6.8) — 인스턴스 메모리(K-5, 다중 인스턴스에서는 근사). 호스트당
 * 동시 연결 1 · 간격 = max(소스 간격, robots `Crawl-delay`).
 *
 * [pass 6 · RG-17] 조각 안에서 요청 간격을 **기다리며(sleep) 계속** 처리하도록 남은 지연(`msUntilReady`)과 시계·대기(`now`·`sleep`)를 이 클래스가 가진다.
 * 시험은 `now`·`sleep` 필드를 가짜 시계로 바꿔 끼운다(운영은 실시계) — 시각을 다루는 다른 코드는 없다.
 */
@Injectable()
export class KbHostPacer {
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly busyHosts = new Set<string>();

  /** 현재 시각(ms) — 조각 기한 비교와 호스트 간격 계산이 같은 시계를 쓴다. */
  now: () => number = () => Date.now();
  /** 대기(ms) — 시험은 가짜 시계를 앞으로 돌리는 함수로 바꾼다. */
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** 이 호스트에 지금 요청을 보내도 되는지(간격·동시 연결 1 모두 충족). */
  isReady(host: string, now: number): boolean {
    return this.msUntilReady(host, now) <= 0;
  }

  /** 이 호스트에 요청을 보낼 수 있을 때까지 남은 시간(ms) — 0이면 지금 가능. 다른 요청이 호스트를 쥐고 있으면 잠깐(50ms) 뒤 다시 확인하도록 돌려준다. */
  msUntilReady(host: string, now: number): number {
    if (this.busyHosts.has(host)) return BUSY_POLL_MS;
    const next = this.nextAllowedAt.get(host) ?? 0;
    return Math.max(0, next - now);
  }

  acquire(host: string): void {
    this.busyHosts.add(host);
  }

  release(host: string, now: number, intervalMs: number): void {
    this.busyHosts.delete(host);
    this.nextAllowedAt.set(host, now + intervalMs);
    // [pass 6 · RG-20⑦] 오래 안 쓴(다음 가능 시각이 이미 지난) 호스트 항목은 정리한다 — 메모리 맵이 호스트 수만큼 영구히 자라지 않게.
    if (this.nextAllowedAt.size > 500) {
      for (const [h, at] of this.nextAllowedAt) if (at <= now && !this.busyHosts.has(h)) this.nextAllowedAt.delete(h);
    }
  }
}
