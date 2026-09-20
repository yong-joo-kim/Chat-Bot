import { Injectable } from '@nestjs/common';
import { buildDialogueIndex, mergeOverlay, resolveTurn } from '@chat-bot/dialogue-engine';
import type { DialogueTurnResult } from '@chat-bot/dialogue-engine';
import {
  isOverlayEmpty,
  type CompareRequestDto,
  type CompareResponse,
  type CompareTurnResult,
  type DialogueBundle,
  type SimulateRequestDto,
  type SimulateResponse,
} from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { assertOverlaySize, toBundleOverlayPatch } from './lib/overlay-convert';
import { compareDiff } from './lib/compare-diff';
import { computeAssetCounts, enrichNames } from './lib/resolution-enrich';

/**
 * No.10 응답 테스트/시뮬레이션(FR-10-1~31). **읽기 전용** — `ConversationLogService`를 주입하지
 * 않는다(FR-0-21, AC-10-14 — 규약이 아니라 의존성 그래프로 로그 불가를 보장한다).
 * 시뮬레이션은 챗봇 상태와 무관하게 허용한다(FR-10-2) — `assertReadable`만 호출하고
 * `assertWritable`(ARCHIVED 차단)은 호출하지 않는다.
 */
@Injectable()
export class SimulationService {
  constructor(
    private readonly scope: ChatbotScopeService,
    private readonly bundleService: DialogueBundleService,
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

    const turnInput = dto.buttonAction ? { buttonAction: dto.buttonAction } : { message: dto.message ?? '' };
    const result: DialogueTurnResult = resolveTurn(turnInput, dto.state, bundle, now, { index });
    const elapsedMs = Date.now() - start;
    const names = enrichNames(bundle, result);

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
    };
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
