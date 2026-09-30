import { Injectable } from '@nestjs/common';
import { EmbeddingProviderFactory } from '../../embedding/embedding-provider.factory';
import type { EmbeddingProvider } from '../../embedding/embedding-provider.port';

/**
 * ★ 임베딩 공급원 **교체 지점 1곳**(No.21 — 설계서 §8.6 · R-8). 기본 구현은 대화 경로와 같은
 * `EmbeddingProviderFactory`(같은 ml-worker)를 그대로 돌려준다. 분석 전용 ml-worker 프로세스로 분리하는 날
 * (부하 게이트 결과에 따라 — 출구 호스트·거버넌스 기동 검사·데이터 지도를 함께 설계) 이 파일만 바꾼다.
 *
 * ⚠ 이 서비스는 `QueryEmbeddingService`(전역 질의 임베딩 캐시)를 주입하지 않는다 — 5,000문장이 운영 캐시를
 * 밀어내지 않게(ADR-0030 §2 · DC-2).
 */
@Injectable()
export class AnalysisEmbeddingSource {
  /** 마지막으로 연결된 제공자의 modelId — 네트워크 확인 없이 `staleModel` 판정에 쓴다(L-3). */
  private lastModelId: string | undefined;

  constructor(private readonly factory: EmbeddingProviderFactory) {}

  /** 알려진 현재 modelId(연결된 적이 없으면 undefined). 네트워크 호출 0. */
  knownModelId(): string | undefined {
    return this.lastModelId;
  }

  /** 연결 가능한 임베딩 제공자. 없으면 `undefined`(호출부가 503 `EMBEDDING_UNAVAILABLE`로 변환). */
  async get(): Promise<EmbeddingProvider | undefined> {
    const provider = await this.factory.getProvider();
    if (provider) this.lastModelId = provider.modelId;
    return provider;
  }
}
