import { Injectable } from '@nestjs/common';
import type { HandoffSettings } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { toHandoffSettingsDto } from './handoff.mapper';

interface CacheEntry {
  value: HandoffSettings;
  cachedAt: number;
}

/**
 * 챗봇별 상담 설정 전용 메모리 캐시(TTL 30초 + 즉시 무효화, §3.1 — `AnswerSettingsCacheService`와
 * 같은 형식). 상담이 꺼진 챗봇의 공개 대화는 캐시 적중 시 추가 DB 조회 0(NFR-CSP1).
 */
@Injectable()
export class HandoffSettingsCacheService {
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(chatbotId: string): Promise<HandoffSettings> {
    const cached = this.store.get(chatbotId);
    if (cached && Date.now() - cached.cachedAt < this.ttlMs) return cached.value;

    const row = await this.prisma.chatbotHandoffSetting.findUnique({ where: { chatbotId } });
    const value = toHandoffSettingsDto(chatbotId, row);
    this.store.set(chatbotId, { value, cachedAt: Date.now() });
    return value;
  }

  invalidate(chatbotId: string): void {
    this.store.delete(chatbotId);
  }
}
