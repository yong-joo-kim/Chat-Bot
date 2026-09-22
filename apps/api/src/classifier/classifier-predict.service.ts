import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IntentClassifierModel as PrismaClassifierModel } from '@prisma/client';
import type { IntentClassifierStatus } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { decodeVector } from '../embedding/lib/vector-codec';
import { TrainingJobService } from '../training-jobs/training-job.service';
import { ClassifierModelRepository } from './classifier-model.repository';
import { predictProbabilities } from './lib/logistic-regression';
import { judgeClassifierStale } from './lib/stale-judge';

export interface ClassifierPrediction {
  readonly intentId: string;
  readonly intentName: string;
  readonly score: number;
}

interface UsableModel {
  readonly model: PrismaClassifierModel;
  readonly weights: Float32Array;
  readonly bias: Float32Array;
  readonly classIds: string[];
}

/**
 * No.23 (B) 경량 분류기의 **유일한 소비자 경로**(ADR-0027 §2/§12.4) — 미응답 큐의 추천 의도 산출에만
 * 쓰인다. `packages/dialogue-engine`·`resolveTurn()`은 이 서비스를 알지 못한다(엔진 심볼 0건,
 * `asset-write-sealing.spec.ts` S-6이 함께 단언). `IntentsService`·`KeywordsService`를 주입받지 않는다
 * (읽기 전용 Prisma 접근뿐 — 설계서 §9.2).
 */
@Injectable()
export class ClassifierPredictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly jobs: TrainingJobService,
    private readonly repo: ClassifierModelRepository,
  ) {}

  private parseExamples(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private async loadUsableModel(chatbotId: string): Promise<UsableModel | null> {
    const model = await this.repo.find(chatbotId);
    if (!model) return null;
    const provider = await this.embeddingFactory.getProvider();
    if (!provider || provider.modelId !== model.modelId) return null; // MODEL_CHANGED — 즉시 사용 중지(FR-L2-21 ①)

    const weights = decodeVector(model.weights, model.classCount * model.dimension);
    const bias = decodeVector(model.bias, model.classCount);
    if (!weights || !bias) return null;

    return { model, weights, bias, classIds: this.repo.parseClassIds(model.classIds) };
  }

  /** `GET .../intent-classifier/status`(FR-L2-23) — 5상태 배지의 데이터 소스. */
  async getStatus(chatbotId: string): Promise<IntentClassifierStatus> {
    const activeJob = await this.jobs.findActive(chatbotId, 'CLASSIFIER_TRAIN');
    const model = await this.repo.find(chatbotId);

    if (activeJob) {
      return { state: 'TRAINING', classCount: model?.classCount ?? 0, sampleCount: model?.sampleCount ?? 0, stale: false, staleReasons: [] };
    }

    if (!model) {
      const latestJob = await this.jobs.findLatest(chatbotId, 'CLASSIFIER_TRAIN');
      const state = latestJob?.status === 'FAILED' ? 'FAILED' : 'NONE';
      return { state, classCount: 0, sampleCount: 0, stale: false, staleReasons: [] };
    }

    const provider = await this.embeddingFactory.getProvider();
    const intents = await this.prisma.intent.findMany({ where: { chatbotId }, select: { examples: true } });
    const currentIntentCount = intents.length;
    const currentExampleCount = intents.reduce((sum, i) => sum + this.parseExamples(i.examples).length, 0);

    const judge = judgeClassifierStale({
      trainedModelId: model.modelId,
      currentModelId: provider?.modelId,
      intentCountAtTrain: model.intentCountAtTrain,
      currentIntentCount,
      exampleCountAtTrain: model.exampleCountAtTrain,
      currentExampleCount,
    });

    return {
      state: 'READY',
      modelId: model.modelId,
      trainedAt: model.trainedAt,
      classCount: model.classCount,
      sampleCount: model.sampleCount,
      accuracy: model.accuracy ?? undefined,
      stale: judge.stale,
      staleReasons: [...judge.reasons],
    };
  }

  /**
   * 추천 의도 배치 산출(FR-L2-27/30) — 목록 요청당 배치 1회. `CLASSIFIER_ENABLED=false`·모델
   * 없음·`MODEL_CHANGED`(입력 공간 다름)·임베딩 실패 등 **어느 경우든 `null`을 반환**하며,
   * 호출부(`learning`)는 `null`이면 기존 bigram(LEXICAL)으로 폴백한다(AC-L2-15, 오류가 아니라 폴백).
   */
  async predictBatch(
    chatbotId: string,
    questions: readonly { id: string; text: string }[],
  ): Promise<Map<string, ClassifierPrediction[]> | null> {
    if (questions.length === 0) return new Map();
    if (!(this.config.get<boolean>('CLASSIFIER_ENABLED') ?? false)) return null;

    const usable = await this.loadUsableModel(chatbotId);
    if (!usable) return null;

    const provider = await this.embeddingFactory.getProvider();
    if (!provider) return null;

    let vectors: Float32Array[];
    try {
      vectors = await provider.embed(
        questions.map((q) => q.text),
        'QUERY',
      );
    } catch {
      return null;
    }

    const intents = await this.prisma.intent.findMany({ where: { chatbotId, id: { in: usable.classIds } }, select: { id: true, name: true } });
    const nameById = new Map(intents.map((i) => [i.id, i.name]));
    const minProbability = this.config.get<number>('CLASSIFIER_MIN_PROBABILITY') ?? 0.15;

    const result = new Map<string, ClassifierPrediction[]>();
    questions.forEach((q, idx) => {
      const vector = vectors[idx];
      if (!vector) {
        result.set(q.id, []);
        return;
      }
      const probs = predictProbabilities(vector, usable.weights, usable.bias, usable.classIds.length, usable.model.dimension);
      const ranked = usable.classIds
        .map((intentId, i) => ({ intentId, intentName: nameById.get(intentId), score: probs[i] }))
        .filter((r): r is ClassifierPrediction => r.intentName !== undefined && r.score >= minProbability) // 삭제된 의도 제외(EX-L2-12)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      result.set(q.id, ranked);
    });

    return result;
  }
}
