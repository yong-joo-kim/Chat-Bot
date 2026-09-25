import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decodeVector } from '../lib/vector-codec';

export interface TextVectorSet {
  modelId: string;
  byHash: Map<string, Float32Array>;
  cachedAt: number;
}

/**
 * [신규 No.40] `(chatbotId, modelId)` → `textHash → vector` 맵(TTL 60초, §8.2). `pin()` 직후
 * `invalidate()`로 즉시 무효화한다. 보존 저장소(`EmbeddingTextVector`) 전용 — 슬롯 벡터 캐시
 * (`VectorCacheService`)와는 완전히 분리된 인스턴스다.
 */
@Injectable()
export class TextVectorCacheService {
  private readonly store = new Map<string, TextVectorSet>();
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(chatbotId: string, modelId: string): Promise<TextVectorSet> {
    const cached = this.store.get(chatbotId);
    if (cached && cached.modelId === modelId && Date.now() - cached.cachedAt < this.ttlMs) return cached;

    const rows = await this.prisma.embeddingTextVector.findMany({ where: { chatbotId, modelId } });
    const byHash = new Map<string, Float32Array>();
    for (const row of rows) {
      const vec = decodeVector(row.vector, row.dimension);
      if (vec) byHash.set(row.textHash, vec);
    }
    const result: TextVectorSet = { modelId, byHash, cachedAt: Date.now() };
    this.store.set(chatbotId, result);
    return result;
  }

  invalidate(chatbotId: string): void {
    this.store.delete(chatbotId);
  }
}
