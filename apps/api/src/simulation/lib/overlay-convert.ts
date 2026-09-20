import type { BundleOverlayPatch } from '@chat-bot/dialogue-engine';
import type { DialogueOverlay } from '@chat-bot/shared-types';
import { OVERLAY_LIMITS } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';

/** 요청 본문 전체 1MB 상한(FR-10-21). Nest 전역 body-parser 대신 오버레이 전용 필드에서 확인한다. */
export function assertOverlaySize(overlay: DialogueOverlay | undefined): void {
  if (!overlay) return;
  const size = JSON.stringify(overlay).length;
  if (size > OVERLAY_LIMITS.bodyBytes) {
    throw new ApiException(
      'LIMIT_EXCEEDED',
      400,
      `오버레이 요청 본문은 최대 ${Math.floor(OVERLAY_LIMITS.bodyBytes / (1024 * 1024))}MB까지 허용됩니다.`,
    );
  }
}

/**
 * 검증된 오버레이 DTO(Create*Schema + id)를 엔진의 `mergeOverlay`가 요구하는 완전한 엔터티 배열로
 * 변환한다(§7.5 — zod 검증은 apps/api 책임, 병합은 엔진 책임). `chatbotId`/`createdAt`/`updatedAt`을
 * 이 시점에 채운다. `draft-` 접두 임시 id는 그대로 유지한다(FR-10-19 ②).
 */
export function toBundleOverlayPatch(chatbotId: string, overlay: DialogueOverlay | undefined, now: Date): BundleOverlayPatch {
  if (!overlay) return {};

  return {
    intents: overlay.intents?.map((item) => ({
      id: item.id,
      chatbotId,
      name: item.name,
      description: item.description,
      examples: item.examples ?? [],
      createdAt: now,
      updatedAt: now,
    })),
    keywords: overlay.keywords?.map((item) => ({
      id: item.id,
      chatbotId,
      name: item.name,
      description: item.description,
      synonyms: item.synonyms ?? [],
      createdAt: now,
      updatedAt: now,
    })),
    homonyms: overlay.homonyms?.map((item) => ({
      id: item.id,
      chatbotId,
      word: item.word,
      description: item.description,
      meanings: item.meanings,
      policy: item.policy,
      clarifyPrompt: item.clarifyPrompt,
      defaultMeaningIndex: item.defaultMeaningIndex ?? undefined,
      createdAt: now,
      updatedAt: now,
    })),
    dialogNodes: overlay.dialogNodes?.map((item) => ({
      id: item.id,
      chatbotId,
      name: item.name,
      description: item.description,
      nodeType: item.nodeType,
      matchMode: item.matchMode,
      enabled: item.enabled,
      priority: item.priority,
      intentIds: item.intentIds,
      keywordIds: item.keywordIds,
      contextVariableId: item.contextVariableId,
      outputs: item.outputs,
      createdAt: now,
      updatedAt: now,
    })),
    contexts: overlay.contexts?.map((item) => ({
      id: item.id,
      chatbotId,
      name: item.name,
      description: item.description,
      slots: item.slots,
      completionMessage: item.completionMessage,
      cancelKeywords: item.cancelKeywords ?? ['취소', '그만', '처음으로'],
      sessionTimeoutMinutes: item.sessionTimeoutMinutes ?? 30,
      createdAt: now,
      updatedAt: now,
    })),
    faqs: overlay.faqs?.map((item) => ({
      id: item.id,
      chatbotId,
      category: item.category,
      question: item.question,
      answer: item.answer,
      altQuestions: item.altQuestions ?? [],
      enabled: item.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    })),
    deletedIds: overlay.deletedIds,
  };
}
