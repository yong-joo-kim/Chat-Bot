import { Injectable } from '@nestjs/common';
import { INBOX_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { computeSessionRef } from '../../handoff/lib/session-ref';
import { InboxLruCache } from '../identity/lib/session-identity-cache';

/**
 * [신규 No.42] `sessionRef` → `sessionId` 역해석(§7.2 — 제약 ③). 조회 순서: ① `CustomerLink` ②
 * `HandoffSession` ③ 최근 24시간 로그의 distinct `sessionId`(최대 5,000)를 `computeSessionRef()`로
 * 대조. 해시 함수는 `handoff/lib/session-ref.ts` 1벌이며 이 조회 쿼리만 인박스 소유다.
 */
@Injectable()
export class SessionRefLookupService {
  private readonly cache = new InboxLruCache<string>(5_000, 30 * 60_000);

  constructor(private readonly prisma: PrismaService) {}

  async resolve(chatbotId: string, sessionRef: string): Promise<string | null> {
    const cacheKey = `${chatbotId}:${sessionRef}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const link = await this.prisma.customerLink.findFirst({ where: { chatbotId, sessionRef }, select: { sessionId: true } });
    if (link) {
      this.cache.set(cacheKey, link.sessionId);
      return link.sessionId;
    }

    const handoff = await this.prisma.handoffSession.findFirst({ where: { chatbotId, sessionRef }, select: { sessionId: true } });
    if (handoff) {
      this.cache.set(cacheKey, handoff.sessionId);
      return handoff.sessionId;
    }

    const since = new Date(Date.now() - INBOX_LIMITS.manualLinkLookbackHours * 60 * 60_000);
    const logs = await this.prisma.conversationLog.findMany({
      where: { chatbotId, createdAt: { gte: since } },
      distinct: ['sessionId'],
      select: { sessionId: true },
      take: 5000,
    });
    for (const row of logs) {
      if (!row.sessionId) continue;
      if (computeSessionRef(chatbotId, row.sessionId) === sessionRef) {
        this.cache.set(cacheKey, row.sessionId);
        return row.sessionId;
      }
    }
    return null;
  }
}
