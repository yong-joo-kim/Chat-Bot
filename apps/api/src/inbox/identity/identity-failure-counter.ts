import { Injectable, Logger } from '@nestjs/common';
import type { IdentityFailureReason } from '@chat-bot/shared-types';

const HOUR_MS = 3_600_000;
const RING_HOURS = 24;
const WARN_THROTTLE_MS = 10 * 60_000;

interface HourBucket {
  hourKey: number;
  verified: number;
  failures: Partial<Record<IdentityFailureReason, number>>;
}

/**
 * [신규 No.42] (챗봇, 사유)별 1시간 버킷 24개 링(인스턴스 로컬 — §6.6 · K-5). 값·`sub`·이름·지문은
 * 담지 않는다(O-7) — 챗봇 id·사유 코드·건수만.
 */
@Injectable()
export class IdentityFailureCounter {
  private readonly logger = new Logger('IdentityFailureCounter');
  private readonly buckets = new Map<string, HourBucket[]>();
  private readonly lastWarnAt = new Map<string, number>();

  private hourKeyOf(now: Date): number {
    return Math.floor(now.getTime() / HOUR_MS);
  }

  private bucketFor(chatbotId: string, now: Date): HourBucket {
    const key = this.hourKeyOf(now);
    let list = this.buckets.get(chatbotId);
    if (!list) {
      list = [];
      this.buckets.set(chatbotId, list);
    }
    const cutoff = key - RING_HOURS;
    while (list.length > 0 && list[0].hourKey <= cutoff) list.shift();
    let bucket = list.find((b) => b.hourKey === key);
    if (!bucket) {
      bucket = { hourKey: key, verified: 0, failures: {} };
      list.push(bucket);
    }
    return bucket;
  }

  recordSuccess(chatbotId: string, now: Date = new Date()): void {
    this.bucketFor(chatbotId, now).verified += 1;
  }

  recordFailure(chatbotId: string, reason: IdentityFailureReason, now: Date = new Date()): void {
    const bucket = this.bucketFor(chatbotId, now);
    bucket.failures[reason] = (bucket.failures[reason] ?? 0) + 1;
    this.maybeWarn(chatbotId, reason, now);
  }

  private maybeWarn(chatbotId: string, reason: IdentityFailureReason, now: Date): void {
    const key = `${chatbotId}:${reason}`;
    const last = this.lastWarnAt.get(key) ?? 0;
    if (now.getTime() - last < WARN_THROTTLE_MS) return;
    this.lastWarnAt.set(key, now.getTime());
    const total = this.stats24h(chatbotId, now).failures[reason] ?? 0;
    this.logger.warn(`식별 실패: chatbotId=${chatbotId} reason=${reason} count24h=${total}`);
  }

  stats24h(chatbotId: string, now: Date = new Date()): { verified: number; failures: Record<IdentityFailureReason, number> } {
    const key = this.hourKeyOf(now);
    const cutoff = key - RING_HOURS;
    const list = (this.buckets.get(chatbotId) ?? []).filter((b) => b.hourKey > cutoff);
    const failures: Record<IdentityFailureReason, number> = {
      MALFORMED: 0,
      SIGNATURE: 0,
      EXPIRED: 0,
      NOT_YET_VALID: 0,
      TTL_TOO_LONG: 0,
      SECRET_MISSING: 0,
      CONFLICT: 0,
    };
    let verified = 0;
    for (const b of list) {
      verified += b.verified;
      for (const [reason, count] of Object.entries(b.failures)) {
        failures[reason as IdentityFailureReason] += count ?? 0;
      }
    }
    return { verified, failures };
  }
}
