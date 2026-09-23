import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiErrorCode, AugmentationAcceptRequestDto, AugmentationAcceptResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException, ApiExceptionBody } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { VectorCacheService } from '../embedding/vector-cache.service';
import { cosineSimilarity } from '../embedding/lib/cosine';
import { IntentsService } from '../intents/intents.service';
import { LearningApplyService } from '../learning/learning-apply.service';
import { VersionCaptureService } from '../versions/capture/version-capture.service';
import { resolveAugmentationThresholds } from './lib/augmentation-thresholds';

/**
 * ★ No.16 자산 승격의 **유일한 지점**(ADR-0025 §5 L2/L3) — 이 파일 밖 어디에서도
 * `IntentsService.applyLearningExample()`을 증강 경로로 호출하지 않는다(`asset-write-sealing.spec.ts`
 * 가 저장소 전체를 스캔해 이를 단언한다).
 */
@Injectable()
export class AugmentationAcceptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly vectorCache: VectorCacheService,
    private readonly intentsService: IntentsService,
    private readonly learningApply: LearningApplyService,
    private readonly config: ConfigService,
    private readonly versionCapture: VersionCaptureService,
  ) {}

  private toFailure(id: string, e: unknown): { id: string; code: ApiErrorCode; message: string } {
    if (e instanceof ApiException) {
      const body = e.getResponse() as ApiExceptionBody;
      return { id, code: body.code, message: body.message };
    }
    return { id, code: 'INTERNAL_ERROR', message: e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.' };
  }

  async accept(chatbotId: string, intentId: string, dto: AugmentationAcceptRequestDto): Promise<AugmentationAcceptResponse> {
    await this.scope.assertWritable(chatbotId);

    const rows = await this.prisma.augmentationSuggestion.findMany({
      where: { id: { in: dto.suggestionIds }, chatbotId, intentId },
    });
    const rowById = new Map(rows.map((r) => [r.id, r]));

    const embeddingProvider = await this.embeddingFactory.getProvider();
    const ttlDays = this.config.get<number>('AUGMENTATION_SUGGESTION_TTL_DAYS') ?? 7;
    const ttlMs = ttlDays * 86_400_000;
    const now = Date.now();

    const failed: { id: string; code: ApiErrorCode; message: string }[] = [];
    const candidateIds: string[] = [];

    // ① 소유권·상태·stale 사전 판정(DD-95 §6) — 임베딩 호출 전에 걸러낸다.
    for (const id of dto.suggestionIds) {
      const row = rowById.get(id);
      if (!row) {
        failed.push({ id, code: 'NOT_FOUND', message: '해당 제안을 찾을 수 없습니다.' });
        continue;
      }
      if (row.status !== 'PENDING') {
        failed.push({ id, code: 'SUGGESTION_EXPIRED', message: '이미 처리된 제안입니다.' });
        continue;
      }
      const stale = (embeddingProvider && row.modelId !== embeddingProvider.modelId) || now - row.createdAt.getTime() > ttlMs;
      if (stale) {
        failed.push({ id, code: 'SUGGESTION_EXPIRED', message: '이 제안은 오래되어 승인할 수 없습니다. 새로 생성해 주세요.' });
        continue;
      }
      candidateIds.push(id);
    }

    // ② 승인 시점 재검증(DD-112) — 신규성 코사인 재계산. 배치 1회 임베딩으로 조달한다.
    const noveltyExcluded = new Set<string>();
    if (embeddingProvider && candidateIds.length > 0) {
      try {
        const cache = await this.vectorCache.get(chatbotId, embeddingProvider.modelId);
        const baselineVectors = (cache?.entries ?? [])
          .filter((e) => e.ownerId === intentId && e.ownerType === 'INTENT_EXAMPLE')
          .map((e) => e.vector);
        const texts = candidateIds.map((id) => rowById.get(id)!.text);
        const vectors = await embeddingProvider.embed(texts, 'PASSAGE');
        const noveltyMax = resolveAugmentationThresholds(embeddingProvider.modelId).noveltyMax;
        const pool = [...baselineVectors];
        candidateIds.forEach((id, i) => {
          const vec = vectors[i];
          const maxSim = pool.reduce((max, v) => Math.max(max, cosineSimilarity(vec, v)), -1);
          if (maxSim >= noveltyMax) {
            noveltyExcluded.add(id);
            failed.push({ id, code: 'SUGGESTION_EXPIRED', message: '승인 시점 기준으로 이미 유사한 예문이 있어 추가하지 않았습니다.' });
          } else {
            pool.push(vec); // 같은 요청 내 다른 승인 건과도 중복되지 않게 즉시 반영한다.
          }
        });
      } catch {
        // 재검증 실패는 승인을 막지 않는다 — 생성 시점에 이미 검증을 통과한 제안이다(best-effort).
      }
    }

    // [신규 No.25] 증강 승인 직전 자동 스냅샷(§6.4 훅 #7) — fail-open, 편입 대상이 1건 이상일 때만.
    // 재검증(②) 뒤·편입 루프 앞: 재검증은 임베딩 호출(수 초)을 포함해, 그 사이의 다른 편집이 스냅샷에
    // 반영되도록 편입 직전에 둔다. `Intent.examples`에는 증강 표시가 없어 이 스냅샷이 승인 후
    // 되돌리기의 유일한 안전망이다(J-3).
    const acceptTargetCount = candidateIds.filter((id) => !noveltyExcluded.has(id)).length;
    const autoSnapshot =
      acceptTargetCount > 0
        ? await this.versionCapture.captureAuto(chatbotId, 'BEFORE_AUGMENT_ACCEPT', { targetId: intentId, itemCount: acceptTargetCount })
        : undefined;

    const succeededIntentIds: string[] = [];
    let succeededCount = 0;
    let linkedNodeCount = 0;

    for (const id of candidateIds) {
      if (noveltyExcluded.has(id)) continue;
      const row = rowById.get(id)!;
      try {
        const applied = await this.intentsService.applyLearningExample(
          chatbotId,
          { intentId },
          row.text,
          { auditSummary: `증강 예문 반영 (${dto.suggestionIds.length}건)`, deferBundleInvalidate: true },
        );
        await this.prisma.augmentationSuggestion.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
        succeededCount += 1;
        succeededIntentIds.push(applied.intentId);
        linkedNodeCount = applied.linkedNodeCount;
      } catch (e) {
        failed.push(this.toFailure(id, e));
      }
    }

    // ★ K-2 — 요청당 정확히 1회. 성공 건이 있을 때만 호출한다(No.15 bulkResolve와 동일 규약).
    let appliedImmediately = true;
    if (succeededIntentIds.length > 0) {
      const applyResult = await this.learningApply.applyLearning({
        chatbotId,
        intentIds: succeededIntentIds,
        reason: 'AUGMENTATION_ACCEPT',
        resolvedCount: succeededIntentIds.length,
      });
      appliedImmediately = applyResult.appliedImmediately;
    }

    return { succeeded: succeededCount, failed, appliedImmediately, linkedNodeCount, autoSnapshot };
  }
}
