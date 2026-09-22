import { Injectable } from '@nestjs/common';
import { buildDialogueIndex, judgeBand, mergeOverlay, resolveTurn } from '@chat-bot/dialogue-engine';
import type { DialogueTurnResult } from '@chat-bot/dialogue-engine';
import { maskPii } from '@chat-bot/pii-mask';
import {
  isOverlayEmpty,
  type CompareRequestDto,
  type CompareResponse,
  type CompareTurnResult,
  type DialogueBundle,
  type MatchTrace,
  type SimulateRequestDto,
  type SimulateResponse,
} from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { SemanticMatchService } from '../embedding/semantic-match.service';
import { AnswerSettingsCacheService } from '../answer-settings/answer-settings-cache.service';
import { RagHttpClient } from '../rag/rag-http.client';
import { RagGateService } from '../rag/rag-gate.service';
import { judgeRagResponse } from '../rag/lib/judge-rag-response';
import { RagQueryResponseSchema } from '../rag/lib/rag-response.schema';
import { assertOverlaySize, toBundleOverlayPatch } from './lib/overlay-convert';
import { compareDiff } from './lib/compare-diff';
import { computeAssetCounts, enrichNames } from './lib/resolution-enrich';

/**
 * No.10 응답 테스트/시뮬레이션(FR-10-1~31). **읽기 전용** — `ConversationLogService`를 주입하지
 * 않는다(FR-0-21, AC-10-14 — 규약이 아니라 의존성 그래프로 로그 불가를 보장한다).
 * 시뮬레이션은 챗봇 상태와 무관하게 허용한다(FR-10-2) — `assertReadable`만 호출하고
 * `assertWritable`(ARCHIVED 차단)은 호출하지 않는다.
 * FAQ/의도 매칭 고도화 그룹부터 `matchTrace`(1단계 top3·구간 판정)와 `useRag`(명시적일 때만
 * 2단계 직접 호출, FR-N2-3/AC-N2-25)를 추가한다 — 이 경우에도 `ConversationLog`는 적재하지 않는다.
 */
@Injectable()
export class SimulationService {
  constructor(
    private readonly scope: ChatbotScopeService,
    private readonly bundleService: DialogueBundleService,
    private readonly semanticMatch: SemanticMatchService,
    private readonly answerSettingsCache: AnswerSettingsCacheService,
    private readonly ragHttpClient: RagHttpClient,
    private readonly ragGate: RagGateService,
  ) {}

  async simulate(chatbotId: string, dto: SimulateRequestDto): Promise<SimulateResponse> {
    await this.scope.assertReadable(chatbotId);
    assertOverlaySize(dto.overlay);

    const now = new Date();
    const start = Date.now();
    const { bundle: baseBundle, index: baseIndex } = await this.bundleService.getCached(chatbotId);

    const overlayApplied = !!dto.overlay && !isOverlayEmpty(dto.overlay);
    let bundle: DialogueBundle = baseBundle;
    let index = baseIndex;
    if (overlayApplied) {
      const patch = toBundleOverlayPatch(chatbotId, dto.overlay, now);
      bundle = mergeOverlay(baseBundle, patch);
      index = buildDialogueIndex(bundle);
    }

    const settings = await this.answerSettingsCache.get(chatbotId);
    const thresholds = { accept: settings.acceptThreshold, low: settings.lowThreshold, margin: settings.marginThreshold };
    // NODE 버튼은 의미 매칭 후보가 아니다(공개 대화 경로와 동일한 분기, 복제가 아니라 같은 판단 재적용).
    const semanticText = dto.buttonAction?.kind === 'NODE' ? undefined : dto.buttonAction?.kind === 'MESSAGE' ? dto.buttonAction.text : dto.message;
    const semantic =
      settings.semanticEnabled && semanticText !== undefined && semanticText.length > 0
        ? await this.semanticMatch.score(chatbotId, semanticText, bundle, thresholds)
        : undefined;

    const turnInput = dto.buttonAction ? { buttonAction: dto.buttonAction } : { message: dto.message ?? '' };
    const result: DialogueTurnResult = resolveTurn(turnInput, dto.state, bundle, now, { index, semantic });
    const names = enrichNames(bundle, result);

    const matchTrace = semantic
      ? await this.buildMatchTrace(semantic, thresholds, settings, dto.useRag, semanticText)
      : settings.semanticEnabled
        ? ({ band: 'SKIPPED', top3: [], ragUsed: false } as MatchTrace)
        : undefined;

    const elapsedMs = Date.now() - start;

    return {
      input: result.input,
      normalizedInput: result.normalizedInput,
      matchedNodeId: result.matchedNodeId,
      matchedIntentId: result.matchedIntentId,
      matchedFaqId: result.matchedFaqId,
      homonymResolution: result.homonymResolution,
      outputs: result.outputs,
      nextSession: result.nextSession,
      pendingClarify: result.pendingClarify,
      unsupportedOutputs: result.unsupportedOutputs,
      trace: result.trace,
      state: result.nextState,
      stateDiscarded: result.stateDiscarded,
      matchedNodeName: names.matchedNodeName,
      matchedIntentName: names.matchedIntentName,
      matchedFaqQuestion: names.matchedFaqQuestion,
      elapsedMs,
      resolvedAt: now,
      assetCounts: computeAssetCounts(bundle),
      overlayApplied,
      matchTrace,
    };
  }

  /**
   * 시뮬레이터 결과 패널의 매칭 근거(FR-N3-10, AC-N3-7) — 엔진과 동일한 `judgeBand`를 재사용한다
   * (NFR-M2). `useRag: true`이고 1단계가 실패(FAILED) 구간일 때만 `RagHttpClient`를 **직접**
   * 호출한다 — `ConversationLog`/`RagCallLog`는 남기지 않는다(FR-N2-3, AC-N2-25).
   */
  private async buildMatchTrace(
    semantic: NonNullable<Awaited<ReturnType<SemanticMatchService['score']>>>,
    thresholds: { accept: number; low: number; margin: number },
    settings: Awaited<ReturnType<AnswerSettingsCacheService['get']>>,
    useRag: boolean,
    questionText: string | undefined,
  ): Promise<MatchTrace> {
    const band = judgeBand(semantic.ranked, thresholds);
    const top3 = semantic.ranked.slice(0, 3).map((c) => ({ kind: c.kind, id: c.id, label: c.matchedText, score: c.score }));

    let ragUsed = false;
    let ragLatencyMs: number | undefined;
    let ragSourceCount: number | undefined;

    const canTryRag = useRag && band.kind === 'FAILED' && settings.ragEnabled && !!settings.ragCompany && this.ragHttpClient.isConfigured() && !!questionText;

    if (canTryRag && this.ragGate.tryAcquire()) {
      const ragStart = Date.now();
      try {
        const maskedQuestion = maskPii(questionText as string).maskedText;
        const httpResult = await this.ragHttpClient.query(
          {
            question: maskedQuestion,
            company: settings.ragCompany as string,
            category: settings.ragCategory ?? undefined,
            subcategory: settings.ragSubcategory ?? undefined,
            similarityThreshold: settings.ragSimilarityThreshold ?? undefined,
          },
          settings.ragTimeoutMs,
        );
        if (!httpResult.networkError && httpResult.httpStatus === 200) {
          const parsed = RagQueryResponseSchema.safeParse(httpResult.body);
          if (parsed.success) {
            const judgement = judgeRagResponse(parsed.data);
            this.ragGate.recordSuccess();
            if (judgement.ok) {
              ragUsed = true;
              ragSourceCount = judgement.response.source_info?.total_sources;
            }
          } else {
            this.ragGate.recordFailure();
          }
        } else {
          this.ragGate.recordFailure();
        }
      } finally {
        this.ragGate.release();
        ragLatencyMs = Date.now() - ragStart;
      }
    }

    return { band: band.kind, top3, ragUsed, ragLatencyMs, ragSourceCount };
  }

  async compare(chatbotId: string, dto: CompareRequestDto): Promise<CompareResponse> {
    await this.scope.assertReadable(chatbotId);
    if (isOverlayEmpty(dto.overlay)) {
      throw new ApiException('NO_CHANGES_TO_COMPARE', 400, '비교할 변경 내용이 없습니다.');
    }
    assertOverlaySize(dto.overlay);

    const now = new Date();
    const start = Date.now();
    const { bundle: bundleA, index: indexA } = await this.bundleService.getCached(chatbotId);
    const patch = toBundleOverlayPatch(chatbotId, dto.overlay, now);
    const bundleB = mergeOverlay(bundleA, patch);
    const indexB = buildDialogueIndex(bundleB);

    let stateA: unknown = dto.initialState;
    let stateB: unknown = dto.initialState;
    const turns: CompareResponse['turns'] = [];
    let same = 0;

    dto.messages.forEach((message, i) => {
      const a = resolveTurn({ message }, stateA, bundleA, now, { index: indexA });
      stateA = a.nextState;
      const b = resolveTurn({ message }, stateB, bundleB, now, { index: indexB });
      stateB = b.nextState;

      const diff = compareDiff(a, b);
      if (diff.status === 'SAME') same += 1;

      turns.push({
        index: i,
        message,
        a: toCompareTurnResult(bundleA, a),
        b: toCompareTurnResult(bundleB, b),
        diff,
      });
    });

    return {
      turns,
      summary: { total: turns.length, same, different: turns.length - same },
      elapsedMs: Date.now() - start,
      resolvedAt: now,
    };
  }
}

function toCompareTurnResult(bundle: DialogueBundle, result: DialogueTurnResult): CompareTurnResult {
  const names = enrichNames(bundle, result);
  return {
    outputs: result.outputs,
    matchedNodeId: result.matchedNodeId,
    matchedNodeName: names.matchedNodeName,
    matchedIntentId: result.matchedIntentId,
    matchedFaqId: result.matchedFaqId,
    unsupportedOutputs: result.unsupportedOutputs,
    trace: result.trace,
  };
}
