import { Injectable } from '@nestjs/common';
import { normalizeText } from '@chat-bot/shared-types';
import type { BundleOverlayPatch } from '@chat-bot/dialogue-engine';
import type { DialogueBundle } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

export interface OverlayVectorTarget {
  intentId: string;
  slotIndex: number;
  text: string;
}

export interface AugmentationOverlayResult {
  patch: BundleOverlayPatch;
  vectorTargets: OverlayVectorTarget[];
  excludedSuggestionCount: number;
}

const MAX_OVERLAY_INTENTS = 20; // No.10과 동일한 종류별 상한(OVERLAY_LIMITS.perKind)

/**
 * M2 오버레이 소스 `AUGMENTATION_SUGGESTIONS` 합성(FR-V2-9~15, §6.5) — **읽기 전용**.
 * `AugmentationModule`을 import하지 않고 `AugmentationSuggestion`을 **Prisma로 직접 읽는다**
 * (import하면 승격 유일 지점인 `AugmentationAcceptService`가 이 모듈의 DI 그래프에 들어와
 * ADR-0025 봉인이 약해진다 — `ClassifierTrainingService`가 `IntentsService`를 주입하지 않는 선례와 동일).
 * `AugmentationSuggestion`에 쓰기는 **0건**이다 — `status`/`updatedAt`이 변하지 않는다(NFR-VS3).
 */
@Injectable()
export class TestRunOverlayBuilder {
  constructor(private readonly prisma: PrismaService) {}

  async build(chatbotId: string, bundle: Pick<DialogueBundle, 'intents'>, suggestionIds: readonly string[], currentModelId: string | undefined): Promise<AugmentationOverlayResult> {
    const rows = await this.prisma.augmentationSuggestion.findMany({ where: { id: { in: [...suggestionIds] }, chatbotId } });
    const rowById = new Map(rows.map((r) => [r.id, r] as const));

    let excludedSuggestionCount = 0;
    const byIntent = new Map<string, string[]>();
    for (const id of suggestionIds) {
      const row = rowById.get(id);
      const stale = !row || row.status !== 'PENDING' || (currentModelId !== undefined && row.modelId !== currentModelId);
      if (stale) {
        excludedSuggestionCount += 1;
        continue;
      }
      const list = byIntent.get(row.intentId) ?? [];
      list.push(row.text);
      byIntent.set(row.intentId, list);
    }

    const patchIntents: NonNullable<BundleOverlayPatch['intents']> = [];
    const vectorTargets: OverlayVectorTarget[] = [];
    const now = new Date();

    for (const [intentId, texts] of byIntent) {
      if (patchIntents.length >= MAX_OVERLAY_INTENTS) {
        excludedSuggestionCount += texts.length;
        continue;
      }
      const intent = bundle.intents.find((i) => i.id === intentId);
      if (!intent) {
        excludedSuggestionCount += texts.length; // 대상 의도가 이미 삭제됨 — 조용히 제외한다.
        continue;
      }
      const seen = new Set(intent.examples.map((e) => normalizeText(e)));
      const nextExamples = [...intent.examples];
      for (const text of texts) {
        const norm = normalizeText(text);
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        vectorTargets.push({ intentId, slotIndex: nextExamples.length, text });
        nextExamples.push(text);
      }
      patchIntents.push({
        id: intent.id,
        chatbotId,
        name: intent.name,
        description: intent.description,
        examples: nextExamples,
        createdAt: intent.createdAt,
        updatedAt: now,
      });
    }

    return { patch: { intents: patchIntents }, vectorTargets, excludedSuggestionCount };
  }
}
