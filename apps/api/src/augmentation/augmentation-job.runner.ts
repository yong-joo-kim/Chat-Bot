import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { normalizeText } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { VectorCacheService } from '../embedding/vector-cache.service';
import type { TrainingJobTaskResult } from '../training-jobs/training-job.queue';
import { AugmentationProviderFactory } from './providers/augmentation-provider.factory';
import type { SynonymDict } from './lib/rule-variants';
import { resolveAugmentationThresholds } from './lib/augmentation-thresholds';
import { validateCandidates } from './lib/validate-candidates';
import type { AugmentationThresholds, OtherIntentVector } from './lib/validate-candidates';

const DEFAULT_ACCEPT_THRESHOLD = 0.8;
const MAX_RAW_TARGET = 60; // ml-worker /augment 계약 상한(targetCount 1~60)과 정합.
// 시드 폭주 방지(설계서 §10.2). ml-worker `/augment` 계약 상한(`GENERATION_SEEDS_MAX=20`, 초과 400)은 **총 시드 수** 기준이므로
// 의도 이름 1개를 포함해 20개로 맞춘다(K-1 — 예문 20 + 이름 1 = 21이면 예문 많은 의도가 항상 400).
// ⚠ 이 값은 ml-worker `GENERATION_SEEDS_MAX`(`config.py` 기본 20, 환경변수로 변경 가능)와 연동된다 — ml-worker 쪽을 낮추면
// 여기도 같이 낮춰야 하고, 높여도 이 값을 올리기 전에는 효과가 없다(API는 설정을 읽지 않는다).
export const MAX_SEEDS_TOTAL = 20;

export interface AugmentationJobInput {
  readonly chatbotId: string;
  readonly intentId: string;
  readonly requestedCount: number;
  readonly jobId: string;
}

/**
 * No.16 증강 Job 실행 본체(ADR-0025 §3, 설계서 §10). ★ 자산(`Intent`/`Keyword`)에는 **읽기만** 한다
 * — `IntentsService`·`KeywordsService` 심볼을 이 파일에 두지 않는다(DD-96 L1/L3, `asset-write-sealing.spec.ts`
 * 로 강제). 이 클래스가 쓰는 테이블은 `AugmentationSuggestion` 1개뿐이다(제안 저장소).
 */
@Injectable()
export class AugmentationJobRunner {
  private readonly logger = new Logger('AugmentationJobRunner');

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly vectorCache: VectorCacheService,
    private readonly augmentationFactory: AugmentationProviderFactory,
    private readonly config: ConfigService,
  ) {}

  private parseExamples(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private parseSynonyms(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  /** `Keyword.synonyms`·`HomonymDictionary.word`를 조립한다(FR-L1-5 G1 사전). 읽기 전용 — 쓰기는 없다. */
  private async buildSynonymDict(chatbotId: string): Promise<SynonymDict> {
    const [keywords, homonyms] = await Promise.all([
      this.prisma.keyword.findMany({ where: { chatbotId }, select: { name: true, synonyms: true } }),
      this.prisma.homonymDictionary.findMany({ where: { chatbotId }, select: { word: true } }),
    ]);
    const dict = new Map<string, readonly string[]>();
    for (const k of keywords) {
      const syns = this.parseSynonyms(k.synonyms);
      if (syns.length > 0) dict.set(k.name, syns);
    }
    for (const h of homonyms) {
      if (!dict.has(h.word)) dict.set(h.word, []);
    }
    return dict;
  }

  private async loadBannedWords(): Promise<string[]> {
    const rows = await this.prisma.bannedWord.findMany({ where: { enabled: true }, select: { word: true } });
    return rows.map((r) => r.word);
  }

  private async loadAcceptThreshold(chatbotId: string): Promise<number> {
    const setting = await this.prisma.chatbotAnswerSetting.findUnique({ where: { chatbotId }, select: { acceptThreshold: true } });
    return setting?.acceptThreshold ?? DEFAULT_ACCEPT_THRESHOLD;
  }

  async run(input: AugmentationJobInput, onProgress: (p: number) => Promise<void>): Promise<TrainingJobTaskResult> {
    const { chatbotId, intentId, requestedCount, jobId } = input;

    const intent = await this.prisma.intent.findFirst({ where: { id: intentId, chatbotId }, select: { id: true, name: true, examples: true } });
    if (!intent) return { status: 'FAILED', failureReason: 'INTENT_NOT_FOUND' };

    const embeddingProvider = await this.embeddingFactory.getProvider();
    if (!embeddingProvider) return { status: 'FAILED', failureReason: 'EMBEDDING_UNAVAILABLE' };

    const [bannedWords, acceptThreshold, vectorSet, otherIntentRows] = await Promise.all([
      this.loadBannedWords(),
      this.loadAcceptThreshold(chatbotId),
      this.vectorCache.get(chatbotId, embeddingProvider.modelId),
      this.prisma.intent.findMany({ where: { chatbotId, id: { not: intentId } }, select: { id: true, name: true } }),
    ]);
    const intentNameById = new Map(otherIntentRows.map((r) => [r.id, r.name]));

    const seedVectors = (vectorSet?.entries ?? [])
      .filter((e) => e.ownerId === intentId && (e.ownerType === 'INTENT_NAME' || e.ownerType === 'INTENT_EXAMPLE'))
      .map((e) => e.vector);
    const existingExampleVectors = (vectorSet?.entries ?? [])
      .filter((e) => e.ownerId === intentId && e.ownerType === 'INTENT_EXAMPLE')
      .map((e) => e.vector);
    const otherIntentVectors: OtherIntentVector[] = (vectorSet?.entries ?? [])
      .filter((e) => e.ownerId !== intentId && (e.ownerType === 'INTENT_NAME' || e.ownerType === 'INTENT_EXAMPLE'))
      .map((e) => ({ intentId: e.ownerId, intentName: intentNameById.get(e.ownerId) ?? '', vector: e.vector }));

    if (seedVectors.length === 0) {
      // 색인이 아직 안 됐거나(재색인 지연) 벡터가 없다 — 검증 불가이므로 거부한다(DD-93).
      return { status: 'FAILED', failureReason: 'EMBEDDING_UNAVAILABLE' };
    }

    const examples = this.parseExamples(intent.examples);
    // 공백뿐인 예문은 ml-worker가 400으로 거부하므로 제외한다. 최신 예문을 우선(뒤에서 자름) + 의도 이름 1개.
    const usableExamples = examples.filter((e) => e.trim().length > 0);
    // 의도 이름은 생성 시 trim·1자 이상으로 검증되지만(DialogueNameSchema), 공백뿐이면 ml-worker가 400이므로 방어적으로 제외한다.
    const seedTexts = [...usableExamples.slice(-(MAX_SEEDS_TOTAL - 1)), ...(intent.name.trim().length > 0 ? [intent.name] : [])];

    await onProgress(10);

    const provider = this.augmentationFactory.getProvider({
      getSynonyms: () => this.buildSynonymDict(chatbotId),
      bannedWords,
    });

    const rawTarget = Math.min(MAX_RAW_TARGET, Math.max(1, requestedCount) * 3);
    const candidates = await provider.generate({ seeds: seedTexts, targetCount: rawTarget, locale: 'ko' });

    await onProgress(40);

    if (candidates.length === 0) {
      return {
        status: 'PARTIAL',
        resultSummary: { generated: 0, accepted: 0, rejected: {}, providerId: provider.providerId },
      };
    }

    let candidateVectors: Float32Array[];
    try {
      candidateVectors = await embeddingProvider.embed([...candidates], 'PASSAGE');
    } catch (e) {
      this.logger.warn(`후보 임베딩 실패 — Job 실패로 처리: chatbotId=${chatbotId} intentId=${intentId} error=${e instanceof Error ? e.message : 'unknown'}`);
      return { status: 'FAILED', failureReason: 'EMBEDDING_UNAVAILABLE' };
    }

    await onProgress(70);

    // `modelId → 기본값` 매핑(DD-94)에 인스턴스 단위 환경변수 오버라이드를 얹는다(개발명세서 §5.1) —
    // 챗봇별 설정으로는 노출하지 않는다는 원칙은 그대로다(오버라이드는 서버 배포 단위다).
    const base = resolveAugmentationThresholds(embeddingProvider.modelId);
    const thresholds: AugmentationThresholds = {
      keepMin: this.config.get<number>('AUGMENTATION_KEEP_MIN') ?? base.keepMin,
      keepMax: this.config.get<number>('AUGMENTATION_KEEP_MAX') ?? base.keepMax,
      noveltyMax: this.config.get<number>('AUGMENTATION_NOVELTY_MAX') ?? base.noveltyMax,
      acceptThreshold,
    };

    const { accepted, rejected } = validateCandidates({
      candidates: [...candidates],
      candidateVectors,
      seedVectors,
      existingExampleVectors,
      otherIntentVectors,
      bannedWords,
      thresholds,
    });

    let insertedCount = 0;
    for (const c of accepted) {
      try {
        await this.prisma.augmentationSuggestion.create({
          data: {
            chatbotId,
            intentId,
            text: c.text,
            textNormalized: normalizeText(c.text),
            similarityToSeed: c.similarityToSeed,
            conflictIntentId: c.conflictIntentId,
            conflictScore: c.conflictScore,
            providerId: provider.providerId,
            modelId: embeddingProvider.modelId,
            jobId,
          },
        });
        insertedCount += 1;
      } catch (e) {
        // @@unique([intentId, textNormalized]) 충돌 — 재제안 흡수(EX-L1-11). 그 외 오류는 경고만 남기고 계속한다.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) {
          this.logger.warn(`제안 저장 실패(계속 진행): chatbotId=${chatbotId} intentId=${intentId} error=${e instanceof Error ? e.message : 'unknown'}`);
        }
      }
    }

    await onProgress(95);

    return {
      status: insertedCount > 0 ? 'SUCCEEDED' : 'PARTIAL',
      resultSummary: {
        generated: candidates.length,
        accepted: insertedCount,
        rejected,
        providerId: provider.providerId,
      },
    };
  }
}
