import { Injectable } from '@nestjs/common';
import type { IntentClassifierModel as PrismaClassifierModel } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface SaveClassifierModelInput {
  readonly chatbotId: string;
  readonly modelId: string;
  readonly dimension: number;
  readonly classIds: readonly string[];
  readonly weights: string; // base64(Float32Array), classifier/lib/model-codec.ts로 인코딩된 값
  readonly bias: string;
  readonly classCount: number;
  readonly sampleCount: number;
  readonly accuracy: number | null;
  readonly intentCountAtTrain: number;
  readonly exampleCountAtTrain: number;
}

/**
 * `IntentClassifierModel` 저장소(ADR-0027 §6) — 챗봇당 1행, **원자적 1회 upsert**(학습 중 서버가 죽어도
 * 반쯤 쓰인 모델이 남지 않는다). 이 저장소는 `IntentsService`·`KeywordsService`를 알지 못한다(읽기 전용
 * Prisma 접근뿐 — 설계서 §9.2 "classifier는 intents/keywords 서비스를 주입하지 않는다").
 */
@Injectable()
export class ClassifierModelRepository {
  constructor(private readonly prisma: PrismaService) {}

  async find(chatbotId: string): Promise<PrismaClassifierModel | null> {
    return this.prisma.intentClassifierModel.findUnique({ where: { chatbotId } });
  }

  async save(input: SaveClassifierModelInput): Promise<PrismaClassifierModel> {
    const data = {
      modelId: input.modelId,
      dimension: input.dimension,
      classIds: JSON.stringify(input.classIds),
      weights: input.weights,
      bias: input.bias,
      classCount: input.classCount,
      sampleCount: input.sampleCount,
      accuracy: input.accuracy,
      intentCountAtTrain: input.intentCountAtTrain,
      exampleCountAtTrain: input.exampleCountAtTrain,
      trainedAt: new Date(),
    };
    return this.prisma.intentClassifierModel.upsert({
      where: { chatbotId: input.chatbotId },
      create: { chatbotId: input.chatbotId, ...data },
      update: data,
    });
  }

  parseClassIds(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
}
