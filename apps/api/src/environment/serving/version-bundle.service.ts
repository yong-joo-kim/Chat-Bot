import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildDialogueIndex } from '@chat-bot/dialogue-engine';
import type { DialogueIndex } from '@chat-bot/dialogue-engine';
import type { ChatbotAnswerSetting, ChatbotSnapshotProfile, DialogueBundle, Survey, SurveyQuestion } from '@chat-bot/shared-types';
import { defaultAnswerSetting } from '../../answer-settings/answer-settings.mapper';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { VersionPayloadReader } from '../../versions/read/version-payload.reader';
import { hydrateForServing } from '../../versions/lib/snapshot-serving';
import { normalizeSnapshotTopics } from '../../versions/lib/snapshot-topic-normalize';
import { deriveSemanticSlots } from '../../embedding/lib/semantic-slots';
import type { SemanticSlot } from '../../embedding/lib/semantic-slots';
import { filterInactiveTopicAssets } from '../../dialogue-common/lib/topic-bundle-filter';
import type { CachedServingBundle, VersionServingBundleCache } from '../../dialogue-common/version-serving-bundle.cache';
import { EmbeddingProviderFactory } from '../../embedding/embedding-provider.factory';
import { VersionVectorResolver } from '../../embedding/version-vectors/version-vector.resolver';
import type { SemanticMatchVectorSource } from '../../embedding/semantic-match.service';
import { EnvironmentCacheEvents } from '../../common/events/environment-cache.events';
import { VersionCoreCache } from './version-core.cache';
import type { VersionCore } from './version-core.cache';

/** [신규 No.40] §7.6 — 버전 읽기 실패(내부 오류). 호출자가 폴백 턴/422/FAILED 등으로 변환한다. */
export class ServingVersionUnavailableError extends Error {}

export interface VersionBundleResult {
  bundle: DialogueBundle;
  index: DialogueIndex;
  settings: ChatbotAnswerSetting;
  profile: ChatbotSnapshotProfile;
  slots: SemanticSlot[];
  /** [신규 No.40] 이미 리졸버로 조립된 의미 매칭 벡터 소스(제공자 없거나 대상이 없으면 undefined). */
  semanticSource?: SemanticMatchVectorSource;
  version: { id: string; versionNo: number; contentHash: string; createdAt: Date; legacyTiebreak: boolean };
}

function safeParseArray<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * [신규 No.40] ★ C-3 — 버전 번들 서빙(§7.5). export는 이 클래스 1개(`EnvironmentServingModule`).
 * 공개 대화·시뮬레이터·TC·상담 힌트·학습현황이 이 서비스만 주입받는다(포인터 쓰기 경로 DI 그래프
 * 밖 — ADR-0025 봉인 L1 방식).
 */
@Injectable()
export class VersionBundleService {
  private readonly logger = new Logger('VersionBundleService');
  private readonly l2InFlight = new Map<string, Promise<CachedServingBundle>>();
  private readonly negativeCache = new Map<string, number>();
  private readonly negativeCacheMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payloadReader: VersionPayloadReader,
    private readonly coreCache: VersionCoreCache,
    private readonly embeddingProviderFactory: EmbeddingProviderFactory,
    private readonly versionVectorResolver: VersionVectorResolver,
    // [신규 No.40 — §7.3] L2 합성 캐시(dialogue-common 공유 인스턴스) — `DialogueBundleService.invalidate()`
    // 1곳에서 무효화된다(AC-EN2-3/4, 토픽·설문 편집 즉시 반영).
    @Inject('VersionServingBundleCache') private readonly l2Cache: VersionServingBundleCache,
    // [신규 No.40 R1 — M-1] 버전 삭제(`versions`)·운영 전환/롤백(`environment/core`)이 이 클래스를
    // 직접 import하지 않고도(§2.2 경계) L1/L2를 비울 수 있게 하는 전역 이벤트 구독.
    private readonly cacheEvents: EnvironmentCacheEvents,
  ) {
    this.cacheEvents.onVersionDeleted((versionId) => this.invalidateVersion(versionId));
    this.cacheEvents.onChatbotPointerChanged((chatbotId) => this.invalidateChatbot(chatbotId));
  }

  /** L1만 — 이름 조회·미리보기·getConfig용. 버전 소속 검사(교차 챗봇 = 404). */
  async getCore(versionId: string, chatbotId: string): Promise<VersionCore> {
    const cached = this.coreCache.get(versionId);
    if (cached) {
      if (cached.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 버전을 찾을 수 없습니다.');
      return cached;
    }

    const negExpires = this.negativeCache.get(versionId);
    if (negExpires && negExpires > Date.now()) {
      throw new ServingVersionUnavailableError(`버전을 읽을 수 없습니다(음성 캐시): ${versionId}`);
    }

    const versionRow = await this.prisma.chatbotVersion.findUnique({
      where: { id: versionId },
      select: { chatbotId: true, versionNo: true, contentHash: true, createdAt: true },
    });
    if (!versionRow || versionRow.chatbotId !== chatbotId) {
      throw new ApiException('NOT_FOUND', 404, '요청하신 버전을 찾을 수 없습니다.');
    }

    try {
      const loaded = await this.payloadReader.loadStrict(versionId);
      const topics = await this.prisma.topic.findMany({ where: { chatbotId }, select: { id: true } });
      const normalized = normalizeSnapshotTopics(loaded.envelope, new Set(topics.map((t) => t.id))).envelope;
      const served = hydrateForServing(normalized, chatbotId);
      const slots = deriveSemanticSlots(served.bundle);

      const core: VersionCore = {
        chatbotId,
        versionId,
        versionNo: versionRow.versionNo,
        contentHash: versionRow.contentHash,
        createdAt: versionRow.createdAt,
        bundle: served.bundle,
        answerSetting: served.answerSetting ?? defaultAnswerSetting(chatbotId),
        profile: served.profile,
        legacyTiebreak: served.legacyTiebreak,
        slots,
      };
      this.coreCache.set(versionId, core);
      this.negativeCache.delete(versionId);
      return core;
    } catch (e) {
      if (e instanceof ApiException) {
        this.negativeCache.set(versionId, Date.now() + this.negativeCacheMs);
        this.logger.warn(`버전 본문 읽기 실패(음성 캐시 30초): chatbotId=${chatbotId} versionId=${versionId} code=${(e.getResponse() as { code?: string }).code}`);
        throw new ServingVersionUnavailableError(`버전을 읽을 수 없습니다: ${versionId}`);
      }
      this.negativeCache.set(versionId, Date.now() + this.negativeCacheMs);
      throw new ServingVersionUnavailableError(`버전 서빙 준비 실패: ${versionId}`);
    }
  }

  async get(chatbotId: string, versionId: string, opts: { topics: 'ACTIVE_ONLY' | 'ALL' }): Promise<VersionBundleResult> {
    const core = await this.getCore(versionId, chatbotId);

    const key = `${chatbotId}:${versionId}:${opts.topics}`;
    const cached = this.l2Cache.get(key);
    const composed = cached ?? (await this.composeSingleFlight(chatbotId, key, core, opts.topics));

    let semanticSource: SemanticMatchVectorSource | undefined;
    if (core.slots.length > 0) {
      const provider = await this.embeddingProviderFactory.getProvider();
      if (provider) {
        const resolution = await this.versionVectorResolver.resolve(chatbotId, provider.modelId, core.slots);
        if (resolution.entries.length > 0) semanticSource = { kind: 'VERSION', entries: resolution.entries, modelId: provider.modelId };
      }
    }

    return {
      bundle: composed.bundle,
      index: composed.index,
      settings: core.answerSetting,
      profile: core.profile,
      slots: core.slots,
      semanticSource,
      version: { id: core.versionId, versionNo: core.versionNo, contentHash: core.contentHash, createdAt: core.createdAt, legacyTiebreak: core.legacyTiebreak },
    };
  }

  private async composeSingleFlight(chatbotId: string, key: string, core: VersionCore, topicMode: 'ACTIVE_ONLY' | 'ALL'): Promise<CachedServingBundle> {
    const inflight = this.l2InFlight.get(key);
    if (inflight) return inflight;

    const task = this.composeAndCache(chatbotId, key, core, topicMode).finally(() => this.l2InFlight.delete(key));
    this.l2InFlight.set(key, task);
    return task;
  }

  private async composeAndCache(chatbotId: string, key: string, core: VersionCore, topicMode: 'ACTIVE_ONLY' | 'ALL'): Promise<CachedServingBundle> {
    const [surveyRows, disabledTopics] = await Promise.all([
      this.prisma.survey.findMany({ where: { chatbotId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.topic.findMany({ where: { chatbotId, enabled: false }, select: { id: true } }),
    ]);
    const surveys: Survey[] = surveyRows.map((row) => ({
      id: row.id,
      chatbotId: row.chatbotId,
      name: row.name,
      description: row.description ?? undefined,
      status: row.status as Survey['status'],
      activeFrom: row.activeFrom ?? undefined,
      activeTo: row.activeTo ?? undefined,
      introMessage: row.introMessage ?? undefined,
      completionMessage: row.completionMessage,
      cancelKeywords: safeParseArray<string>(row.cancelKeywords),
      sessionTimeoutMinutes: row.sessionTimeoutMinutes,
      questions: safeParseArray<SurveyQuestion>(row.questions),
      structureVersion: row.structureVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    const withSurveys: DialogueBundle = { ...core.bundle, surveys };
    const bundle = topicMode === 'ACTIVE_ONLY' ? filterInactiveTopicAssets(withSurveys, new Set(disabledTopics.map((t) => t.id))) : withSurveys;
    const index = buildDialogueIndex(bundle);
    const composed: CachedServingBundle = { bundle, index, cachedAt: Date.now() };
    this.l2Cache.set(key, composed);
    return composed;
  }

  /** 켜기·전환·롤백·승격 커밋 직후 fire-and-forget(§7.3 NFR-ENP3). */
  warm(chatbotId: string, versionId: string): void {
    this.get(chatbotId, versionId, { topics: 'ACTIVE_ONLY' }).catch(() => {
      // 예열 실패는 무시한다 — 다음 실제 요청이 다시 시도한다.
    });
  }

  /** 버전 삭제·모드 끄기·전환 시 해당 챗봇 항목 전부 제거. */
  invalidateChatbot(chatbotId: string): void {
    this.l2Cache.invalidateChatbot(chatbotId);
    this.coreCache.invalidateChatbot(chatbotId);
  }

  invalidateVersion(versionId: string): void {
    this.coreCache.invalidate(versionId);
  }
}
