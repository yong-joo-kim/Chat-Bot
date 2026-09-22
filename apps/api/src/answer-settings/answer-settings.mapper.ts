import type { ChatbotAnswerSetting as PrismaChatbotAnswerSetting } from '@prisma/client';
import type { ChatbotAnswerSetting, FallbackPolicy } from '@chat-bot/shared-types';

/** 행이 없으면 전부 기본값이며 두 단계 모두 비활성이다(DD-89) — `chatbotId`만 채워 반환한다. */
export function defaultAnswerSetting(chatbotId: string): ChatbotAnswerSetting {
  const now = new Date();
  return {
    chatbotId,
    semanticEnabled: false,
    acceptThreshold: 0.8,
    lowThreshold: 0.6,
    marginThreshold: 0.05,
    ragEnabled: false,
    ragCompany: null,
    ragCategory: null,
    ragSubcategory: null,
    ragSimilarityThreshold: null,
    fallbackPolicy: 'RAG_FIRST',
    showSources: true,
    ragTimeoutMs: 120_000,
    createdAt: now,
    updatedAt: now,
  };
}

export function toAnswerSettingDto(row: PrismaChatbotAnswerSetting): ChatbotAnswerSetting {
  return {
    chatbotId: row.chatbotId,
    semanticEnabled: row.semanticEnabled,
    acceptThreshold: row.acceptThreshold,
    lowThreshold: row.lowThreshold,
    marginThreshold: row.marginThreshold,
    ragEnabled: row.ragEnabled,
    ragCompany: row.ragCompany,
    ragCategory: row.ragCategory,
    ragSubcategory: row.ragSubcategory,
    ragSimilarityThreshold: row.ragSimilarityThreshold,
    fallbackPolicy: row.fallbackPolicy as FallbackPolicy,
    showSources: row.showSources,
    ragTimeoutMs: row.ragTimeoutMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
