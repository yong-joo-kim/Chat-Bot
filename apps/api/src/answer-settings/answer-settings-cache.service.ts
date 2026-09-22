import { Injectable } from '@nestjs/common';
import type { ChatbotAnswerSetting } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { defaultAnswerSetting, toAnswerSettingDto } from './answer-settings.mapper';

interface CacheEntry {
  value: ChatbotAnswerSetting;
  cachedAt: number;
}

/**
 * 챗봇별 답변 설정 메모리 캐시(TTL + 즉시 무효화, §7.1). 대화 턴마다 DB를 왕복하지 않기 위함이다.
 * 저장 즉시 다음 턴부터 적용되어야 하므로(FR-N1-30) `invalidate()`가 TTL을 기다리지 않는다.
 */
@Injectable()
export class AnswerSettingsCacheService {
  private readonly store = new Map<string, CacheEntry>();
  private readonly ttlMs = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(chatbotId: string): Promise<ChatbotAnswerSetting> {
    const cached = this.store.get(chatbotId);
    if (cached && Date.now() - cached.cachedAt < this.ttlMs) return cached.value;

    const row = await this.prisma.chatbotAnswerSetting.findUnique({ where: { chatbotId } });
    const value = row ? toAnswerSettingDto(row) : defaultAnswerSetting(chatbotId);
    this.store.set(chatbotId, { value, cachedAt: Date.now() });
    return value;
  }

  invalidate(chatbotId: string): void {
    this.store.delete(chatbotId);
  }
}
