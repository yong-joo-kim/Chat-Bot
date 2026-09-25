import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingProviderFactory } from '../embedding-provider.factory';
import { encodeVector } from '../lib/vector-codec';
import { TextVectorCacheService } from './text-vector.cache';

const CHUNK_SIZE = 500;
const EMBED_BATCH_SIZE = 64;

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * [신규 No.40] ★ `EmbeddingTextVector` 쓰기 유일 파일(C-2, §8.4) — 문장 해시 주소 벡터 보존 저장소.
 * 원문 텍스트는 인자일 뿐 저장하지 않는다. `EmbeddingVector`(슬롯 테이블)·색인기는 무변경.
 */
@Injectable()
export class EmbeddingTextVectorService {
  private readonly logger = new Logger('EmbeddingTextVectorService');
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: EmbeddingProviderFactory,
    private readonly textVectorCache: TextVectorCacheService,
  ) {}

  /**
   * 보존한다 — 추가 임베딩 호출 0(정상 경로, §8.4). ① 복사 단계(동기): 슬롯 테이블에 이미 있는
   * 같은 해시의 READY 벡터를 복사한다. ② 임베딩 단계(백그라운드·단일 비행·챗봇당 1개): ①에서도
   * 없는 해시만 새로 임베딩한다.
   */
  async pin(chatbotId: string, modelId: string, slots: ReadonlyArray<{ textHash: string; text: string }>): Promise<void> {
    const uniqueHashes = Array.from(new Set(slots.map((s) => s.textHash)));
    if (uniqueHashes.length === 0) return;

    const existing = await this.findExistingHashes(chatbotId, modelId, uniqueHashes);
    const missing = uniqueHashes.filter((h) => !existing.has(h));
    if (missing.length === 0) return;

    const copied = await this.copyFromSlotTable(chatbotId, modelId, missing);
    if (copied > 0) this.textVectorCache.invalidate(chatbotId);

    const stillMissing = await this.findMissingHashes(chatbotId, modelId, missing);
    if (stillMissing.length === 0) return;

    const textByHash = new Map(slots.map((s) => [s.textHash, s.text]));
    void this.embedMissingSingleFlight(chatbotId, modelId, stillMissing, textByHash);
  }

  private async findExistingHashes(chatbotId: string, modelId: string, hashes: readonly string[]): Promise<Set<string>> {
    const set = new Set<string>();
    for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
      const chunk = hashes.slice(i, i + CHUNK_SIZE);
      const rows = await this.prisma.embeddingTextVector.findMany({ where: { chatbotId, modelId, textHash: { in: chunk } }, select: { textHash: true } });
      rows.forEach((r) => set.add(r.textHash));
    }
    return set;
  }

  private async findMissingHashes(chatbotId: string, modelId: string, hashes: readonly string[]): Promise<string[]> {
    const existing = await this.findExistingHashes(chatbotId, modelId, hashes);
    return hashes.filter((h) => !existing.has(h));
  }

  /** ① 복사 단계 — 슬롯 테이블(같은 chatbotId·modelId·textHash·READY)에서 벡터를 복사한다. */
  private async copyFromSlotTable(chatbotId: string, modelId: string, hashes: readonly string[]): Promise<number> {
    let copiedTotal = 0;
    for (let i = 0; i < hashes.length; i += CHUNK_SIZE) {
      const chunk = hashes.slice(i, i + CHUNK_SIZE);
      const rows = await this.prisma.embeddingVector.findMany({
        where: { chatbotId, modelId, textHash: { in: chunk }, status: 'READY' },
        select: { textHash: true, dimension: true, vector: true },
      });
      const byHash = new Map(rows.map((r) => [r.textHash, r]));
      if (byHash.size === 0) continue;

      const data = Array.from(byHash.values()).map((r) => ({ chatbotId, modelId, textHash: r.textHash, dimension: r.dimension, vector: r.vector }));
      try {
        const result = await this.prisma.embeddingTextVector.createMany({ data });
        copiedTotal += result.count;
      } catch (e) {
        if (!isUniqueConstraintViolation(e)) throw e;
        // 경합(다른 요청이 먼저 복사) — 해당 청크를 재조회해 아직 없는 것만 1개씩 재시도한다(SQLite는 skipDuplicates 미지원).
        const stillMissing = await this.findMissingHashes(chatbotId, modelId, [...byHash.keys()]);
        for (const hash of stillMissing) {
          const row = byHash.get(hash);
          if (!row) continue;
          try {
            await this.prisma.embeddingTextVector.create({ data: { chatbotId, modelId, textHash: row.textHash, dimension: row.dimension, vector: row.vector } });
            copiedTotal += 1;
          } catch (e2) {
            if (!isUniqueConstraintViolation(e2)) throw e2;
          }
        }
      }
    }
    return copiedTotal;
  }

  /** ② 임베딩 단계(백그라운드·단일 비행·챗봇당 1개) — provider 없음/실패는 흡수한다(경고: 챗봇 id·건수만). */
  private embedMissingSingleFlight(chatbotId: string, modelId: string, hashes: readonly string[], textByHash: ReadonlyMap<string, string>): Promise<void> {
    const key = `${chatbotId}:${modelId}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.embedMissing(chatbotId, modelId, hashes, textByHash).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  private async embedMissing(chatbotId: string, modelId: string, hashes: readonly string[], textByHash: ReadonlyMap<string, string>): Promise<void> {
    const provider = await this.providerFactory.getProvider();
    if (!provider || provider.modelId !== modelId) return; // 흡수 — 다음 트리거에서 재시도
    if (hashes.length === 0) return;

    let embeddedCount = 0;
    for (let i = 0; i < hashes.length; i += EMBED_BATCH_SIZE) {
      const batchHashes = hashes.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batchHashes.map((h) => textByHash.get(h) ?? '').filter((t) => t.length > 0);
      if (texts.length === 0) continue;
      try {
        const vectors = await provider.embed(texts, 'PASSAGE');
        const data = batchHashes
          .map((hash, idx) => ({ hash, text: textByHash.get(hash), vector: vectors[idx] }))
          .filter((v): v is { hash: string; text: string; vector: Float32Array } => !!v.text && !!v.vector)
          .map((v) => ({ chatbotId, modelId, textHash: v.hash, dimension: provider.dimension, vector: encodeVector(v.vector) }));
        if (data.length > 0) {
          await this.prisma.embeddingTextVector.createMany({ data });
          embeddedCount += data.length;
        }
      } catch (e) {
        if (!isUniqueConstraintViolation(e)) {
          this.logger.warn(`보존 저장소 임베딩 실패(흡수 — 다음 트리거에서 재시도): chatbotId=${chatbotId} count=${batchHashes.length}`);
        }
      }
    }
    if (embeddedCount > 0) this.textVectorCache.invalidate(chatbotId);
  }

  /** GC — 보호 버전 슬롯 해시 합집합 밖 행을 지운다(현재 모델 외 행 포함). */
  async retainOnly(chatbotId: string, keep: ReadonlyMap<string, ReadonlySet<string>>): Promise<void> {
    const rows = await this.prisma.embeddingTextVector.findMany({ where: { chatbotId }, select: { id: true, modelId: true, textHash: true } });
    const toDelete = rows.filter((r) => !(keep.get(r.modelId)?.has(r.textHash) ?? false)).map((r) => r.id);
    if (toDelete.length === 0) return;
    for (let i = 0; i < toDelete.length; i += CHUNK_SIZE) {
      await this.prisma.embeddingTextVector.deleteMany({ where: { id: { in: toDelete.slice(i, i + CHUNK_SIZE) } } });
    }
    this.textVectorCache.invalidate(chatbotId);
  }

  /** 모드 끄기(§5.4) — 보존 저장소 전부 삭제(모드 꺼진 챗봇 = 0행 불변식). */
  async purgeChatbot(chatbotId: string): Promise<void> {
    await this.prisma.embeddingTextVector.deleteMany({ where: { chatbotId } });
    this.textVectorCache.invalidate(chatbotId);
  }
}
