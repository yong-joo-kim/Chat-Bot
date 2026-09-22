import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IntentClassifierTrainResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { decodeVector } from '../embedding/lib/vector-codec';
import { TrainingJobService } from '../training-jobs/training-job.service';
import { TrainingJobQueue, TrainingJobTaskResult } from '../training-jobs/training-job.queue';
import { trainMultinomialLogistic, predictProbabilities, LogisticRegressionSample } from './lib/logistic-regression';
import { ClassifierModelRepository } from './classifier-model.repository';
import { encodeClassifierVector } from './lib/model-codec';

const MAX_MODEL_BYTES_DEFAULT = 8_388_608;
const HOLDOUT_MIN_SAMPLES = 50;
const HOLDOUT_RATIO = 0.2;

interface TrainingSample {
  readonly vector: Float32Array;
  readonly intentId: string;
}

@Injectable()
export class ClassifierTrainingService {
  private readonly logger = new Logger('ClassifierTrainingService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly config: ConfigService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly jobs: TrainingJobService,
    private readonly queue: TrainingJobQueue,
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

  /** 학습 데이터 수집(FR-L2-14/15) — 재임베딩 0, 이미 저장된 `EmbeddingVector`만 읽는다. */
  private async collectSamples(
    chatbotId: string,
    modelId: string,
  ): Promise<{ samples: TrainingSample[]; classIds: string[]; totalIntentCount: number; totalExampleCount: number }> {
    const [vectors, intents] = await Promise.all([
      this.prisma.embeddingVector.findMany({
        where: { chatbotId, modelId, status: 'READY', ownerType: { in: ['INTENT_NAME', 'INTENT_EXAMPLE'] } },
        orderBy: { id: 'asc' }, // 결정론 규약 — 샘플 순서를 고정한다(ADR-0027 §1).
        select: { ownerId: true, vector: true, dimension: true },
      }),
      this.prisma.intent.findMany({ where: { chatbotId }, select: { id: true, examples: true } }),
    ]);

    const totalExampleCount = intents.reduce((sum, i) => sum + this.parseExamples(i.examples).length, 0);

    const byIntent = new Map<string, Float32Array[]>();
    for (const v of vectors) {
      const vec = decodeVector(v.vector, v.dimension);
      if (!vec) continue;
      const arr = byIntent.get(v.ownerId) ?? [];
      arr.push(vec);
      byIntent.set(v.ownerId, arr);
    }

    const minPerClass = this.config.get<number>('CLASSIFIER_MIN_PER_CLASS') ?? 3;
    const classIds = [...byIntent.keys()].filter((id) => (byIntent.get(id)?.length ?? 0) >= minPerClass).sort();

    const samples: TrainingSample[] = [];
    for (const intentId of classIds) {
      for (const vec of byIntent.get(intentId) ?? []) samples.push({ vector: vec, intentId });
    }

    return { samples, classIds, totalIntentCount: intents.length, totalExampleCount };
  }

  async train(chatbotId: string): Promise<IntentClassifierTrainResponse> {
    await this.scope.assertWritable(chatbotId);

    const active = await this.jobs.findActive(chatbotId, 'CLASSIFIER_TRAIN');
    if (active) {
      throw new ApiException('AUGMENTATION_IN_PROGRESS', 409, '이 챗봇에 대한 분류기 학습이 이미 진행 중입니다. 완료 후 다시 시도해 주세요.');
    }

    const provider = await this.embeddingFactory.getProvider();
    if (!provider) {
      throw new ApiException(
        'AUGMENTATION_UNAVAILABLE',
        503,
        '임베딩 서비스를 사용할 수 없어 분류기를 학습할 수 없습니다. 임베딩 서비스 연결을 확인한 뒤 다시 시도해 주세요.',
      );
    }

    const { samples, classIds } = await this.collectSamples(chatbotId, provider.modelId);
    const minSamples = this.config.get<number>('CLASSIFIER_MIN_SAMPLES') ?? 20;
    const minClasses = this.config.get<number>('CLASSIFIER_MIN_CLASSES') ?? 2;
    if (samples.length < minSamples || classIds.length < minClasses) {
      throw new ApiException(
        'CLASSIFIER_INSUFFICIENT_DATA',
        422,
        `학습에 필요한 최소 데이터가 부족합니다(의도 ${minClasses}개 이상 · 총 예문 ${minSamples}건 이상 필요, 현재 의도 ${classIds.length}개 · 예문 ${samples.length}건). 추천은 기존 방식(bigram)으로 계속 동작합니다.`,
      );
    }

    const job = await this.jobs.create(chatbotId, 'CLASSIFIER_TRAIN');
    this.queue.enqueue(job.id, (ctx) => this.runTraining(chatbotId, provider.modelId, provider.dimension, ctx.onProgress));

    return { jobId: job.id, status: 'QUEUED' };
  }

  private async runTraining(
    chatbotId: string,
    modelId: string,
    dimension: number,
    onProgress: (p: number) => Promise<void>,
  ): Promise<TrainingJobTaskResult> {
    const startedAt = Date.now();
    const { samples, classIds, totalIntentCount, totalExampleCount } = await this.collectSamples(chatbotId, modelId);
    const minSamples = this.config.get<number>('CLASSIFIER_MIN_SAMPLES') ?? 20;
    const minClasses = this.config.get<number>('CLASSIFIER_MIN_CLASSES') ?? 2;
    if (samples.length < minSamples || classIds.length < minClasses) {
      return { status: 'FAILED', failureReason: 'INSUFFICIENT_DATA' };
    }

    await onProgress(20);

    const classIndexOf = new Map(classIds.map((id, i) => [id, i]));
    const toRegressionSamples = (rows: TrainingSample[]): LogisticRegressionSample[] =>
      rows.map((r) => ({ vector: r.vector, classIndex: classIndexOf.get(r.intentId)! }));

    const countPerClass = new Map<string, number>();
    for (const s of samples) countPerClass.set(s.intentId, (countPerClass.get(s.intentId) ?? 0) + 1);
    const classWeights = classIds.map((id) => samples.length / (classIds.length * (countPerClass.get(id) ?? 1)));

    // 홀드아웃 정확도(FR-L2-*, §12.2) — 샘플 50건 이상일 때만. 클래스별 앞쪽 80%를 학습, 뒤쪽 20%를 평가한다
    // (결정론 규약 — 셔플하지 않는다). 최종 저장 모델은 항상 전체 데이터로 재학습한다.
    let accuracy: number | null = null;
    if (samples.length >= HOLDOUT_MIN_SAMPLES) {
      const trainRows: TrainingSample[] = [];
      const testRows: TrainingSample[] = [];
      for (const id of classIds) {
        const rows = samples.filter((s) => s.intentId === id);
        const cut = Math.max(1, Math.floor(rows.length * (1 - HOLDOUT_RATIO)));
        trainRows.push(...rows.slice(0, cut));
        testRows.push(...rows.slice(cut));
      }
      if (testRows.length > 0) {
        const holdoutModel = await trainMultinomialLogistic({
          samples: toRegressionSamples(trainRows),
          classCount: classIds.length,
          dimension,
          classWeights,
        });
        let correct = 0;
        for (const row of testRows) {
          const probs = predictProbabilities(row.vector, holdoutModel.weights, holdoutModel.bias, classIds.length, dimension);
          let bestIdx = 0;
          for (let i = 1; i < probs.length; i++) if (probs[i] > probs[bestIdx]) bestIdx = i;
          if (classIds[bestIdx] === row.intentId) correct += 1;
        }
        accuracy = testRows.length > 0 ? correct / testRows.length : null;
      }
    }

    await onProgress(60);

    const finalModel = await trainMultinomialLogistic({
      samples: toRegressionSamples(samples),
      classCount: classIds.length,
      dimension,
      classWeights,
    });

    await onProgress(85);

    const weightsB64 = encodeClassifierVector(finalModel.weights);
    const biasB64 = encodeClassifierVector(finalModel.bias);
    const maxBytes = this.config.get<number>('CLASSIFIER_MAX_MODEL_BYTES') ?? MAX_MODEL_BYTES_DEFAULT;
    const approxBytes = Buffer.byteLength(weightsB64, 'base64') + Buffer.byteLength(biasB64, 'base64');
    if (approxBytes > maxBytes) {
      return { status: 'FAILED', failureReason: 'MODEL_TOO_LARGE' };
    }

    await this.repo.save({
      chatbotId,
      modelId,
      dimension,
      classIds,
      weights: weightsB64,
      bias: biasB64,
      classCount: classIds.length,
      sampleCount: samples.length,
      accuracy,
      intentCountAtTrain: totalIntentCount,
      exampleCountAtTrain: totalExampleCount,
    });

    return {
      status: 'SUCCEEDED',
      resultSummary: { classCount: classIds.length, sampleCount: samples.length, accuracy, elapsedMs: Date.now() - startedAt },
    };
  }
}
