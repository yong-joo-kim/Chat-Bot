import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { judgeBand, resolveTurn } from '@chat-bot/dialogue-engine';
import type { DialogueIndex } from '@chat-bot/dialogue-engine';
import type { ChatbotAnswerSetting, DialogueBundle, ProbeTarget } from '@chat-bot/shared-types';
import { normalizeText } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { DialogueBundleService } from '../../dialogue-common/dialogue-bundle.service';
import { AnswerSettingsCacheService } from '../../answer-settings/answer-settings-cache.service';
import { VectorCacheService } from '../../embedding/vector-cache.service';
import type { CachedVectorEntry } from '../../embedding/vector-cache.service';
import { assembleSemanticInput } from '../../embedding/lib/assemble-semantic-input';
import { VersionBundleService } from '../../environment/serving/version-bundle.service';
import { judgeAnswered } from '../../conversation/lib/conversation-log';
import { suggestIntents } from '../../learning/lib/intent-suggest';
import { isLearningCandidate } from '../lib/learning-candidate';
import { AnalysisCancelledError, yieldToEventLoop } from './analysis-cancelled.error';

const YIELD_EVERY = 50;
const SUGGEST_MAX = 3;
const LEXICAL_MIN_SCORE = 0.15;

export interface ProbeItemInput {
  /** 마스킹본 — 대화 엔진에 넣는 문장. */
  readonly text: string;
  readonly vector: Float32Array;
}

export interface ProbeItemResult {
  readonly answered: boolean;
  readonly matchKind: 'INTENT' | 'FAQ' | 'NODE' | null;
  readonly matchId: string | null;
  readonly matchName: string | null;
  readonly band: string;
  readonly score: number | null;
  readonly wouldUseRag: boolean;
  readonly learningCandidate: boolean;
  readonly suggestedIntents: { intentId: string; name: string; score: number; source: 'SEMANTIC' | 'LEXICAL' }[];
}

export type ProbeOutcome =
  | {
      readonly status: 'DONE';
      readonly targetKind: 'LIVE' | 'PROD';
      readonly versionId: string | null;
      readonly versionNo: number | null;
      readonly contentHash: string | null;
      readonly threshold: number;
      readonly items: readonly ProbeItemResult[];
    }
  | {
      readonly status: 'FAILED';
      readonly failureReason: 'TARGET_VERSION_UNREADABLE' | 'INTERNAL_ERROR';
      readonly targetKind: 'LIVE' | 'PROD';
      readonly versionId: string | null;
      readonly versionNo: number | null;
      readonly contentHash: string | null;
      readonly threshold: number | null;
    };

interface ResolvedTarget {
  readonly targetKind: 'LIVE' | 'PROD';
  readonly bundle: DialogueBundle;
  readonly index: DialogueIndex;
  readonly settings: ChatbotAnswerSetting;
  readonly entries: readonly CachedVectorEntry[];
  readonly version: { id: string; versionNo: number; contentHash: string } | null;
}

/**
 * 챗봇 대조(No.21 — 설계서 §9). `TestRunExecutor`를 **호출하지도 고치지도 않는다**(C-5) — 같은 규약(ADR-0030:
 * 기록 0 · 전역 질의 캐시 0 · 번들·색인·벡터 맵 실행당 1회 로드)과 같은 **부품**(`resolveTurn`·
 * `assembleSemanticInput`·`judgeBand`·`VersionBundleService`·벡터 캐시)을 쓴다.
 *
 * 금지(DC-2·DC-3): 대화 로그·`QueryEmbeddingService`·외부 RAG·레거시 API·업무 자동화 호출 0. 발화는 이미 마스킹돼
 * 입구 금지어 판정을 다시 하지 않는다. API 노드는 외부 호출도 목 완결도 하지 않고 **매칭된 노드를 답한 것으로
 * 본다**(R-21). RAG는 "2단계로 넘어갈 발화" 표시만 한다(호출 0).
 */
@Injectable()
export class UtteranceProbeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bundleService: DialogueBundleService,
    private readonly answerSettingsCache: AnswerSettingsCacheService,
    private readonly vectorCache: VectorCacheService,
    private readonly versionBundles: VersionBundleService,
    private readonly config: ConfigService,
  ) {}

  /** 대상 해석(§9.1) — 작업 시작 시 1회. 환경 모드 켜짐 ∧ SERVING이면 운영 버전, 그 외는 라이브 번들. */
  async resolveTarget(chatbotId: string, target: ProbeTarget, modelId: string): Promise<ResolvedTarget | { unreadable: true; versionId: string }> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } });
    const prodVersionId = chatbot?.prodVersionId ?? null;

    if (target === 'SERVING' && prodVersionId) {
      try {
        const s = await this.versionBundles.get(chatbotId, prodVersionId, { topics: 'ACTIVE_ONLY' });
        return {
          targetKind: 'PROD',
          bundle: s.bundle,
          index: s.index,
          settings: s.settings,
          entries: (s.semanticSource?.entries ?? []).map((e) => ({ ...e, textHash: '' })),
          version: { id: s.version.id, versionNo: s.version.versionNo, contentHash: s.version.contentHash },
        };
      } catch {
        return { unreadable: true, versionId: prodVersionId };
      }
    }

    const live = await this.bundleService.getCached(chatbotId);
    const settings = await this.answerSettingsCache.get(chatbotId);
    const cached = settings.semanticEnabled ? await this.vectorCache.get(chatbotId, modelId) : undefined;
    return { targetKind: 'LIVE', bundle: live.bundle, index: live.index, settings, entries: cached?.entries ?? [], version: null };
  }

  /**
   * 발화별 대조. `items[i]`는 임베딩 단계에서 이미 얻은 벡터를 갖는다(추가 임베딩 호출 0). `now`는 작업 시작 시각
   * 1개로 고정한다(재현성). 취소가 관측되면 `AnalysisCancelledError`.
   */
  async probe(input: {
    chatbotId: string;
    target: ProbeTarget;
    scoreThreshold: number | null;
    modelId: string;
    items: readonly ProbeItemInput[];
    now: Date;
    isCancelled: () => boolean;
    onProgress?: (fraction: number) => void;
  }): Promise<ProbeOutcome> {
    let resolved: Awaited<ReturnType<UtteranceProbeService['resolveTarget']>>;
    try {
      resolved = await this.resolveTarget(input.chatbotId, input.target, input.modelId);
    } catch {
      return { status: 'FAILED', failureReason: 'INTERNAL_ERROR', targetKind: 'LIVE', versionId: null, versionNo: null, contentHash: null, threshold: null };
    }
    if ('unreadable' in resolved) {
      // 운영 번들을 읽지 못하면 대조만 실패로 둔다(R-20 — 초안으로 대체하지 않는다).
      return { status: 'FAILED', failureReason: 'TARGET_VERSION_UNREADABLE', targetKind: 'PROD', versionId: resolved.versionId, versionNo: null, contentHash: null, threshold: null };
    }

    const { bundle, index, settings, entries } = resolved;
    const thresholds = { accept: settings.acceptThreshold, low: settings.lowThreshold, margin: settings.marginThreshold };
    const threshold = input.scoreThreshold ?? settings.acceptThreshold;
    const ragPossible = settings.ragEnabled && !!settings.ragCompany && !!this.config.get<string>('RAG_BASE_URL');
    const semanticOn = settings.semanticEnabled && entries.length > 0;
    const lexicalPool = bundle.intents.map((i) => ({ id: i.id, name: i.name, examples: i.examples ?? [], ...(i.topicId ? { topicId: i.topicId } : {}) }));
    const nameOf = {
      INTENT: new Map(bundle.intents.map((i) => [i.id, i.name])),
      FAQ: new Map(bundle.faqs.map((f) => [f.id, f.question])),
      NODE: new Map(bundle.dialogNodes.map((n) => [n.id, n.name])),
    };

    try {
      const out: ProbeItemResult[] = [];
      for (let i = 0; i < input.items.length; i += 1) {
        if (i % YIELD_EVERY === 0) {
          if (input.isCancelled()) throw new AnalysisCancelledError();
          if (i > 0) {
            input.onProgress?.(i / input.items.length);
            await yieldToEventLoop();
          }
        }
        const item = input.items[i];
        const semantic = semanticOn ? assembleSemanticInput(item.vector, entries as CachedVectorEntry[], bundle, thresholds, input.modelId) : undefined;
        const result = resolveTurn({ message: item.text }, undefined, bundle, input.now, { index, semantic, surveyPreview: true });

        // API 노드(`result.apiCall`)는 외부 호출도 목 완결도 하지 않는다 — 폴백 동봉본의 trace(`API_FIXED_NOTICE`)와 무관하게
        // 매칭된 노드를 답한 것으로 본다(R-21 · FR-DC5-6).
        const answered = result.apiCall ? true : judgeAnswered(result.trace);
        const matchKind = result.matchedNodeId ? 'NODE' : result.matchedFaqId ? 'FAQ' : result.matchedIntentId ? 'INTENT' : null;
        const matchId = result.matchedNodeId ?? result.matchedFaqId ?? result.matchedIntentId ?? null;
        const matchName = matchKind && matchId ? (nameOf[matchKind].get(matchId) ?? null) : null;

        const band = semantic ? judgeBand(semantic.ranked, thresholds).kind : 'SKIPPED';
        const score = semantic ? (semantic.ranked[0]?.score ?? null) : null;

        let suggestedIntents: ProbeItemResult['suggestedIntents'] = [];
        if (semantic) {
          const seen = new Set<string>();
          for (const r of semantic.ranked) {
            if (r.kind !== 'INTENT' || seen.has(r.id) || r.score < settings.lowThreshold) continue;
            seen.add(r.id);
            suggestedIntents.push({ intentId: r.id, name: nameOf.INTENT.get(r.id) ?? '', score: round4(r.score), source: 'SEMANTIC' });
            if (suggestedIntents.length >= SUGGEST_MAX) break;
          }
        } else {
          suggestedIntents = suggestIntents(normalizeText(item.text), lexicalPool, { minScore: LEXICAL_MIN_SCORE, max: SUGGEST_MAX }).map((s) => ({
            intentId: s.intentId,
            name: s.intentName,
            score: s.score,
            source: 'LEXICAL' as const,
          }));
        }

        out.push({
          answered,
          matchKind,
          matchId,
          matchName,
          band,
          score,
          wouldUseRag: band === 'FAILED' && ragPossible,
          learningCandidate: isLearningCandidate({ answered, top1Score: score, threshold }),
          suggestedIntents,
        });
      }
      return {
        status: 'DONE',
        targetKind: resolved.targetKind,
        versionId: resolved.version?.id ?? null,
        versionNo: resolved.version?.versionNo ?? null,
        contentHash: resolved.version?.contentHash ?? null,
        threshold,
        items: out,
      };
    } catch (e) {
      if (e instanceof AnalysisCancelledError) throw e;
      return {
        status: 'FAILED',
        failureReason: 'INTERNAL_ERROR',
        targetKind: resolved.targetKind,
        versionId: resolved.version?.id ?? null,
        versionNo: resolved.version?.versionNo ?? null,
        contentHash: resolved.version?.contentHash ?? null,
        threshold,
      };
    }
  }
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}
