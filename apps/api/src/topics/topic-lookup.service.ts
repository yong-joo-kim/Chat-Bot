import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';

export interface TopicLookupEntry {
  id: string;
  name: string;
  enabled: boolean;
}

/**
 * [export] 토픽 존재·소속 검증 + id→{name,enabled} 맵(topic-system-설계.md §2.1).
 * `TopicsModule`이 내보내는 **유일한** provider다 — 토픽 쓰기(`topics.service.ts`)·자산 소속 일괄
 * 쓰기(`topic-assignment.service.ts`)·분리는 모듈 밖에서 주입할 수 없다.
 */
@Injectable()
export class TopicLookupService {
  constructor(private readonly prisma: PrismaService) {}

  /** 없음·다른 챗봇 → `404 INVALID_REFERENCE`(§5.2). */
  async assertTopicInChatbot(chatbotId: string, topicId: string): Promise<void> {
    const row = await this.prisma.topic.findFirst({ where: { id: topicId, chatbotId }, select: { id: true } });
    if (!row) {
      throw new ApiException('INVALID_REFERENCE', 404, '선택한 토픽을 찾을 수 없습니다.', [{ field: 'topicId', message: topicId }]);
    }
  }

  async listForChatbot(chatbotId: string): Promise<TopicLookupEntry[]> {
    return this.prisma.topic.findMany({
      where: { chatbotId },
      select: { id: true, name: true, enabled: true },
      orderBy: [{ sortOrder: 'asc' }],
    });
  }

  async mapForChatbot(chatbotId: string): Promise<Map<string, TopicLookupEntry>> {
    const rows = await this.listForChatbot(chatbotId);
    return new Map(rows.map((r) => [r.id, r]));
  }
}
