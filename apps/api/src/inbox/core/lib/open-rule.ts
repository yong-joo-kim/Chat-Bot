import type { InboxThreadStatus } from '@chat-bot/shared-types';

/**
 * [신규 No.42] 재열림 규칙(§8.1 · R-15) — 고객 쪽 사건(상담 시작·경고 도달)은 `CLOSED`·`PENDING`
 * → `OPEN`, 상담원 쪽 사건(수동 기록·직접 열기)은 `CLOSED` → `OPEN`만(`PENDING`은 유지 — 직원이
 * 메모를 남겼다고 보류가 풀리지 않는다). 순수 함수(시각 무관 — 유효 상태는 호출부가 이미 판정해 넘긴다).
 */
export type ThreadOpenTrigger = 'SIGNAL' | 'MANUAL';

export function shouldReopen(effectiveStatus: InboxThreadStatus, trigger: ThreadOpenTrigger): boolean {
  if (effectiveStatus === 'OPEN') return false;
  if (trigger === 'SIGNAL') return effectiveStatus === 'CLOSED' || effectiveStatus === 'PENDING';
  return effectiveStatus === 'CLOSED';
}
