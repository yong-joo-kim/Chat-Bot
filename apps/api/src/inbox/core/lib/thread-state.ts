import type { InboxThreadStatus } from '@chat-bot/shared-types';

/** [신규 No.42] 상태 쓰기 패치(§8.2) — 사람의 명시적 상태 변경 요청을 행 데이터로 바꾼다(순수). */
export interface ThreadStatePatch {
  status: InboxThreadStatus;
  snoozeUntil: Date | null;
  closedAt: Date | null;
}

export function computeThreadStatePatch(next: { status: InboxThreadStatus; snoozeUntil?: Date }, now: Date): ThreadStatePatch {
  if (next.status === 'CLOSED') return { status: 'CLOSED', snoozeUntil: null, closedAt: now };
  if (next.status === 'PENDING') return { status: 'PENDING', snoozeUntil: next.snoozeUntil ?? null, closedAt: null };
  return { status: 'OPEN', snoozeUntil: null, closedAt: null };
}
