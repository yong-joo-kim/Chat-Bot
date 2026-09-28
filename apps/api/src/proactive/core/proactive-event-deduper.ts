import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

/**
 * [신규 No.35] 수집 사건 중복 억제 — **메모리에만**(DB 아님, §5.3). 같은 `(sessionId, ruleId, kind)`는
 * 1회만 센다(FR-PA5-6). 키는 해시(세션 id 원문을 메모리에도 두지 않는다 — PA-10). 상한 50,000
 * (초과 시 가장 오래 등록된 것부터 제거) · TTL 24시간(봉투 최대 수명과 같음, ADR-0009).
 * 인스턴스 로컬 — 다중 인스턴스·재시작에서는 근사(NFR-PAR3).
 */
const MAX_ENTRIES = 50_000;
const TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ProactiveEventDeduper {
  /** 삽입 순서 보존(Map) — 상한 초과 시 첫 키(가장 오래 등록된 것)부터 제거. */
  private readonly seen = new Map<string, number>();

  private keyFor(sessionId: string, ruleId: string, kind: string): string {
    return createHash('sha256').update(`${sessionId}:${ruleId}:${kind}`).digest('hex').slice(0, 32);
  }

  /** `true` = 이미 처리됨(만료 전) — 호출자는 카운터를 올리지 않고 조용히 무시한다. */
  seenBefore(sessionId: string, ruleId: string, kind: string, nowMs: number): boolean {
    const key = this.keyFor(sessionId, ruleId, kind);
    const expiresAt = this.seen.get(key);
    return expiresAt !== undefined && expiresAt > nowMs;
  }

  register(sessionId: string, ruleId: string, kind: string, nowMs: number): void {
    const key = this.keyFor(sessionId, ruleId, kind);
    this.seen.delete(key); // 재삽입 시 최신 위치로 옮겨 만료 재설정(Map 삽입 순서 규칙 이용).
    this.seen.set(key, nowMs + TTL_MS);
    while (this.seen.size > MAX_ENTRIES) {
      const oldestKey = this.seen.keys().next().value;
      if (oldestKey === undefined) break;
      this.seen.delete(oldestKey);
    }
  }

  /** 시험 전용 — 내부 크기 확인(상한 퇴출 검증). */
  size(): number {
    return this.seen.size;
  }
}
