import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decodeVector } from './lib/vector-codec';

export interface CachedVectorEntry {
  ownerType: string;
  ownerId: string;
  slotIndex: number;
  vector: Float32Array;
  /** [신규 No.40] 조회 행에 이미 존재하는 컬럼 — `VersionVectorResolver`가 "같은 해시 초안 벡터"
   * 대체에 쓴다(추가 조회 0). */
  textHash: string;
}

export interface CachedVectorSet {
  modelId: string;
  dimension: number;
  entries: CachedVectorEntry[];
  cachedAt: number;
}

/**
 * 챗봇별 벡터 메모리 캐시(§8.5, DD-71). 번들 캐시와 완전히 같은 프로세스에 두지는 않지만
 * (모듈 의존 방향상 `embedding`이 `dialogue-common`을 모른다, DD-85) TTL을 맞춰 동일한 무효화
 * 시점을 흉내낸다 — `DialogueBundleService.invalidate()`가 이 서비스의 `invalidate()`도 함께
 * 호출한다(선택 주입, `dialogue-common.module.ts`).
 */
@Injectable()
export class VectorCacheService {
  private readonly store = new Map<string, CachedVectorSet>();
  private readonly ttlMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async get(chatbotId: string, modelId: string): Promise<CachedVectorSet | null> {
    const cached = this.store.get(chatbotId);
    if (cached && cached.modelId === modelId && Date.now() - cached.cachedAt < this.ttlMs) return cached;

    const rows = await this.prisma.embeddingVector.findMany({ where: { chatbotId, modelId, status: 'READY' } });
    const entries: CachedVectorEntry[] = [];
    for (const row of rows) {
      const vec = decodeVector(row.vector, row.dimension);
      if (!vec) continue; // EX-N1-3 — 파싱 실패 벡터만 제외하고 계속한다(예외 없음).
      entries.push({ ownerType: row.ownerType, ownerId: row.ownerId, slotIndex: row.slotIndex, vector: vec, textHash: row.textHash });
    }
    const result: CachedVectorSet = { modelId, dimension: entries[0]?.vector.length ?? 0, entries, cachedAt: Date.now() };
    this.store.set(chatbotId, result);
    return result;
  }

  invalidate(chatbotId: string): void {
    this.store.delete(chatbotId);
  }
}
