import type { InboxThreadListQuery } from '@chat-bot/shared-types';

/**
 * [신규 No.42] 목록 필터 → Prisma where 절(순수 — Prisma 타입에 의존하지 않는다, 호출부가 캐스트).
 * 유효 상태 판정(§8.2)을 SQL 조건으로 표현한다: `OPEN` = `status=OPEN ∨ (status=PENDING ∧
 * snoozeUntil ≤ now)` · `PENDING` = `status=PENDING ∧ (snoozeUntil IS NULL ∨ snoozeUntil > now)`.
 */
export interface BuildThreadListWhereExtra {
  /** [신규 §9.1] `activeHandoff=true` 필터 — 4번 쿼리 결과로 미리 만든 고객 id 집합. */
  activeHandoffCustomerIds?: string[];
  /** `chatbotIds` 필터 — 관계 필터(추가 쿼리 아님, query 1 where의 일부). */
  chatbotIds?: string[];
}

export function buildThreadListWhere(query: InboxThreadListQuery, now: Date, extra: BuildThreadListWhereExtra = {}): Record<string, unknown> {
  const statuses = query.status && query.status.length > 0 ? query.status : (['OPEN', 'PENDING'] as const);
  const statusOr: Record<string, unknown>[] = [];
  for (const s of statuses) {
    if (s === 'OPEN') {
      statusOr.push({ status: 'OPEN' }, { status: 'PENDING', snoozeUntil: { lte: now } });
    } else if (s === 'PENDING') {
      statusOr.push({ AND: [{ status: 'PENDING' }, { OR: [{ snoozeUntil: null }, { snoozeUntil: { gt: now } }] }] });
    } else {
      statusOr.push({ status: 'CLOSED' });
    }
  }

  const where: Record<string, unknown> = {
    hiddenByMergeId: null,
    OR: statusOr,
  };

  if (query.assignee === 'NONE') where.assigneeUserId = null;
  else if (query.assignee === 'ME') where.assigneeUserId = '__ME__'; // 호출부가 실제 사용자 id로 치환한다.
  else if (query.assignee) where.assigneeUserId = query.assignee;

  if (!query.includeTest) where.customer = { kind: { not: 'TEST' } };
  if (query.customerKinds && query.customerKinds.length > 0) {
    where.customer = { ...((where.customer as object) ?? {}), kind: { in: query.customerKinds } };
  }

  if (query.tagIds && query.tagIds.length > 0) where.tags = { some: { tagId: { in: query.tagIds } } };

  // [코드리뷰 R1 반영 M-3] channelFamily(DEPLOY|RECORD|SIMULATED) — 설계서 §3.1 필드(lastChannelFamily) 기준.
  if (query.channelFamily && query.channelFamily.length > 0) where.lastChannelFamily = { in: query.channelFamily };

  if (query.from || query.to) {
    where.lastActivityAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
  }

  if (extra.chatbotIds && extra.chatbotIds.length > 0) {
    where.customer = { ...((where.customer as object) ?? {}), links: { some: { chatbotId: { in: extra.chatbotIds } } } };
  }

  if (query.activeHandoff) {
    where.customerId = { in: extra.activeHandoffCustomerIds ?? [] };
  }

  return where;
}
