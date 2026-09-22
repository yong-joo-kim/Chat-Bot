import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingProvider } from './embedding-provider.port';
import { HttpEmbeddingProvider } from './providers/http-embedding.provider';

/**
 * `EmbeddingProvider` 구현체 교체 지점 1곳(FR-N1-1). `EMBEDDING_BASE_URL` 미설정 시 `undefined`를
 * 반환한다 — 그 경우 1단계는 비활성이며 시스템은 현행 규칙 매칭으로 정상 기동한다(FR-0-46, AC-N4-1).
 *
 * 연결에 실패해도(ml-worker가 아직 기동 전 등) API 부팅을 막지 않는다 — 대신 저하 모드로 흡수하고
 * 쿨다운(기본 10초) 후 다음 호출에서 재시도한다(FR-0-44, EX-N1-1).
 */
@Injectable()
export class EmbeddingProviderFactory {
  private readonly logger = new Logger('EmbeddingProviderFactory');
  private provider: EmbeddingProvider | undefined;
  private lastAttemptAt = 0;
  private readonly retryCooldownMs = 10_000;

  constructor(private readonly config: ConfigService) {}

  async getProvider(): Promise<EmbeddingProvider | undefined> {
    if (this.provider) return this.provider;

    const baseUrl = this.config.get<string>('EMBEDDING_BASE_URL');
    if (!baseUrl) return undefined;

    if (Date.now() - this.lastAttemptAt < this.retryCooldownMs) return undefined;
    this.lastAttemptAt = Date.now();

    try {
      const timeoutMs = this.config.get<number>('EMBEDDING_TIMEOUT_MS') ?? 300;
      this.provider = await HttpEmbeddingProvider.connect(baseUrl, { timeoutMs });
      this.logger.log(`임베딩 서비스 연결됨: modelId=${this.provider.modelId} dimension=${this.provider.dimension}`);
      return this.provider;
    } catch (e) {
      this.logger.warn(`임베딩 서비스 연결 실패 — 저하 모드로 진행합니다: ${e instanceof Error ? e.message : 'unknown'}`);
      return undefined;
    }
  }
}
