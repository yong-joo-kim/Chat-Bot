import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { computeSessionRef } from './lib/session-ref';

interface CacheEntry {
  sessionId: string;
  expiresAt: number;
}

const CACHE_MAX_SIZE = 5000;
const CACHE_TTL_MS = 30 * 60_000;

/**
 * `sessionRef → sessionId` 역해석(§10.2) — ① `HandoffSession(chatbotId, sessionRef)` 인덱스 조회
 * ② 없으면 활성 창 내 `ConversationLog`의 `distinct sessionId`를 해시 비교. 창 밖이고 상담 이력도
 * 없으면 `404`다.
 *
 * [코드리뷰 1회차 Medium #5] 결과는 파생값(정합성 근거 아님)이지만 재계산 비용(챗봇당 최대 5,000
 * 세션 스캔)이 커서 NFR-CSP2(대화 보기 P95 150ms)를 못 지킬 수 있다 — 인스턴스 로컬 LRU
 * (5,000건·TTL 30분, `QueryEmbeddingService`와 같은 형식)로 캐시한다. `computeSessionRef`는
 * 순수 해시라 매핑이 시간에 따라 바뀌지 않으므로 캐시가 stale해질 위험이 없다.
 */
@Injectable()
export class SessionRefResolverService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsCache: HandoffSettingsCacheService,
  ) {}

  async resolve(chatbotId: string, sessionRef: string): Promise<string> {
    const cacheKey = `${chatbotId}:${sessionRef}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached); // LRU touch(재삽입으로 최신화)
      return cached.sessionId;
    }

    const fromThread = await this.prisma.handoffSession.findFirst({ where: { chatbotId, sessionRef }, select: { sessionId: true } });
    if (fromThread) {
      this.store(cacheKey, fromThread.sessionId);
      return fromThread.sessionId;
    }

    const settings = await this.settingsCache.get(chatbotId);
    const windowStart = new Date(Date.now() - settings.activeWindowMinutes * 60_000);
    const distinctSessions = await this.prisma.conversationLog.findMany({
      where: { chatbotId, createdAt: { gte: windowStart }, sessionId: { not: null } },
      select: { sessionId: true },
      distinct: ['sessionId'],
      take: 5000,
    });
    for (const row of distinctSessions) {
      const sid = row.sessionId as string;
      if (computeSessionRef(chatbotId, sid) === sessionRef) {
        this.store(cacheKey, sid);
        return sid;
      }
    }

    throw new ApiException('NOT_FOUND', 404, '요청하신 세션을 찾을 수 없습니다.');
  }

  private store(cacheKey: string, sessionId: string): void {
    this.cache.set(cacheKey, { sessionId, expiresAt: Date.now() + CACHE_TTL_MS });
    while (this.cache.size > CACHE_MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }
}
