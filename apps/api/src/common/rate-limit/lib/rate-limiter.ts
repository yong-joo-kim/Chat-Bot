/**
 * 고정 윈도 카운터(순수 함수, DD-23/§8.6). `@nestjs/throttler`를 도입하지 않는 이유는
 * `quality-channel-설계.md` §8.6 참고 — 서로 다른 키(session/IP)를 동시에 적용해야 하는
 * 정책이 단순 순수 함수로 20줄 남짓에 표현된다.
 */
export interface WindowEntry {
  windowStartMs: number;
  count: number;
}

export interface ConsumeResult {
  allowed: boolean;
  entry: WindowEntry;
  retryAfterSec: number;
}

export function consume(entry: WindowEntry | undefined, now: number, limit: number, windowMs: number): ConsumeResult {
  if (!entry || now - entry.windowStartMs >= windowMs) {
    const fresh: WindowEntry = { windowStartMs: now, count: 1 };
    return { allowed: true, entry: fresh, retryAfterSec: 0 };
  }

  if (entry.count < limit) {
    const next: WindowEntry = { windowStartMs: entry.windowStartMs, count: entry.count + 1 };
    return { allowed: true, entry: next, retryAfterSec: 0 };
  }

  const retryAfterMs = entry.windowStartMs + windowMs - now;
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return { allowed: false, entry, retryAfterSec };
}
