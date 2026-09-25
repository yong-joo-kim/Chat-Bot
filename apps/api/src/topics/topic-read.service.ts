import { Injectable } from '@nestjs/common';
import type { TopicImpactPreview, TopicImpactQuery, TopicListResponse } from '@chat-bot/shared-types';
import { TOPIC_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { collectAssetRefs } from '../dialogue-common/lib/asset-ref-graph';
import { toTopicDto } from './topic.mapper';
import { summarizeTopics } from './lib/topic-summary';
import { computeTopicImpact } from './lib/topic-impact';
import { TopicLookupService } from './topic-lookup.service';

/** 목록(자산 수·교차 참조 수) · 영향 미리보기 — `build()` 1회 + 순수 함수(§2.1). */
@Injectable()
export class TopicReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly bundleService: DialogueBundleService,
    private readonly topicLookup: TopicLookupService,
  ) {}

  /** 쿼리 8 고정(`build()` 7 + 토픽 1) — 토픽 수와 무관(D-1). */
  async list(chatbotId: string): Promise<TopicListResponse> {
    await this.scope.assertReadable(chatbotId);
    const [bundle, topics] = await Promise.all([
      this.bundleService.build(chatbotId),
      this.prisma.topic.findMany({ where: { chatbotId }, orderBy: { sortOrder: 'asc' } }),
    ]);

    const refs = collectAssetRefs(bundle);
    const { byTopicId, common } = summarizeTopics(
      bundle,
      topics.map((t) => t.id),
      refs,
    );

    const items = topics.map((t) => {
      const entry = byTopicId.get(t.id)!;
      return { ...toTopicDto(t), counts: entry.counts, outgoingCrossRefs: entry.outgoingCrossRefs, incomingCrossRefs: entry.incomingCrossRefs };
    });

    return {
      items,
      common: { counts: common.counts, outgoingCrossRefs: common.outgoingCrossRefs },
      limit: TOPIC_LIMITS.maxPerChatbot,
    };
  }

  /** 쿼리 10 고정(`build()` 7 + 토픽 1 + 상담 설정 1 + 대기 중 복원 예약 수 1 — NFR-TPP3). */
  async impact(chatbotId: string, topicId: string, query: TopicImpactQuery): Promise<TopicImpactPreview> {
    await this.scope.assertReadable(chatbotId);
    await this.topicLookup.assertTopicInChatbot(chatbotId, topicId);

    const [bundle, topics, handoffSetting, pendingRestoreSchedules] = await Promise.all([
      this.bundleService.build(chatbotId),
      this.prisma.topic.findMany({ where: { chatbotId }, select: { id: true, name: true, enabled: true } }),
      this.prisma.chatbotHandoffSetting.findUnique({ where: { chatbotId }, select: { endButtonNodeId: true } }),
      this.prisma.deploySchedule.count({ where: { chatbotId, action: 'RESTORE_VERSION', status: { in: ['PENDING', 'HELD'] } } }),
    ]);

    const pure = computeTopicImpact(bundle, topics, { handoffEndButtonNodeId: handoffSetting?.endButtonNodeId ?? null }, topicId, query.action);
    return { ...pure, pendingRestoreSchedules };
  }
}
