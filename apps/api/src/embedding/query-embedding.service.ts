import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeText } from '@chat-bot/dialogue-engine';
import { EmbeddingProviderFactory } from './embedding-provider.factory';

interface CacheEntry {
  vector: Float32Array;
  expiresAt: number;
}

/**
 * 질의 임베딩 경로(§8.4) — 턴당 정확히 1회(FR-N1-6, NFR-P7). 정규화 문자열 키 LRU 캐시
 * (기본 1,000건·TTL 10분) + 회로차단기(연속 5회 실패 → 30초 open, FR-N1-32)를 둔다.
 * 실패는 전부 `null`로 수렴한다 — 예외를 던지지 않는다(저하 모드, FR-0-44).
 */
@Injectable()
export class QueryEmbeddingService {
  private readonly logger = new Logger('QueryEmbeddingService');
  private readonly cache = new Map<string, CacheEntry>();
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  constructor(
    private readonly providerFactory: EmbeddingProviderFactory,
    private readonly config: ConfigService,
  ) {}

  /** 정규화되지 않은 원문 질의를 받아 정규화 후 임베딩한다. 실패/회로open/미설정 시 `null`. */
  async embed(text: string): Promise<{ vector: Float32Array; modelId: string; dimension: number } | null> {
    const norm = normalizeText(text);
    if (norm.length < 2) return null; // EX-N1-6 — 단문은 의미 매칭을 시도하지 않는다.

    if (Date.now() < this.circuitOpenUntil) return null;

    const provider = await this.providerFactory.getProvider();
    if (!provider) return null;

    const cached = this.cache.get(norm);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(norm);
      this.cache.set(norm, cached); // LRU touch(재삽입으로 최신화)
      return { vector: cached.vector, modelId: provider.modelId, dimension: provider.dimension };
    }

    try {
      const [vector] = await provider.embed([norm], 'QUERY');
      this.consecutiveFailures = 0;
      this.storeInCache(norm, vector);
      return { vector, modelId: provider.modelId, dimension: provider.dimension };
    } catch (e) {
      this.consecutiveFailures += 1;
      const threshold = this.config.get<number>('EMBEDDING_CIRCUIT_FAILURE_THRESHOLD') ?? 5;
      if (this.consecutiveFailures >= threshold) {
        this.circuitOpenUntil = Date.now() + 30_000;
        this.logger.warn(`임베딩 질의 연속 실패 ${this.consecutiveFailures}회 — 30초간 회로를 차단합니다(저하 모드).`);
      }
      return null;
    }
  }

  async providerHealthy(): Promise<boolean> {
    const provider = await this.providerFactory.getProvider();
    if (!provider) return false;
    try {
      return await provider.healthy();
    } catch {
      return false;
    }
  }

  private storeInCache(norm: string, vector: Float32Array): void {
    const maxSize = this.config.get<number>('EMBEDDING_CACHE_SIZE') ?? 1000;
    const ttlMs = this.config.get<number>('EMBEDDING_CACHE_TTL_MS') ?? 600_000;
    this.cache.set(norm, { vector, expiresAt: Date.now() + ttlMs });
    while (this.cache.size > maxSize) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
  }
}
