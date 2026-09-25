import { Injectable } from '@nestjs/common';
import type { DialogueBundle, MatchingThresholds, SemanticMatchInput } from '@chat-bot/shared-types';
import { QueryEmbeddingService } from './query-embedding.service';
import { VectorCacheService } from './vector-cache.service';
import { assembleSemanticInput } from './lib/assemble-semantic-input';
import type { AssembleVectorEntry } from './lib/assemble-semantic-input';

/** [신규 No.40] 벡터 소스 — 미지정 = 현행 경로(초안 벡터 캐시). `VERSION`은 버전 슬롯 리졸버 결과다. */
export type SemanticMatchVectorSource = { kind: 'VERSION'; entries: readonly AssembleVectorEntry[]; modelId: string };

/**
 * 1단계 점수 맵 조립(§3 파이프라인 ③④, ADR-0020) — `apps/api`가 턴마다 계산해
 * `ResolveOptions.semantic`으로 주입하는 값을 만든다. 엔진은 이 결과를 읽기만 한다.
 * 질의 임베딩은 턴당 정확히 1회이며(NFR-P7), 그 벡터를 FAQ·의도 두 점수 맵에 공유한다.
 *
 * 조립부는 `embedding/lib/assemble-semantic-input.ts` 순수 함수로 추출했다(ADR-0030 §2) —
 * 검증/품질 고도화(No.19/20)의 대량 실행기가 실행 로컬 벡터로 **같은 함수**를 호출해 랭킹·
 * 타이브레이크 규칙을 복제하지 않는다(NFR-VM2). 이 서비스는 여전히 대화 경로 전용이며
 * `QueryEmbeddingService`(운영 캐시)를 그대로 쓴다 — 동작 변경은 없다.
 */
@Injectable()
export class SemanticMatchService {
  constructor(
    private readonly queryEmbedding: QueryEmbeddingService,
    private readonly vectorCache: VectorCacheService,
  ) {}

  /**
   * `semanticEnabled=false`이거나 임베딩/색인이 준비되지 않았으면 `undefined`를 반환한다 —
   * 그 경우 엔진은 `semantic` 미주입 상태(저하 모드)로 동작한다(FR-0-44).
   */
  async score(
    chatbotId: string,
    text: string,
    bundle: DialogueBundle,
    thresholds: MatchingThresholds,
    source?: SemanticMatchVectorSource,
  ): Promise<SemanticMatchInput | undefined> {
    const embedded = await this.queryEmbedding.embed(text);
    if (!embedded) return undefined;
    if (embedded.vector.length !== embedded.dimension) return undefined;

    // [신규 No.40] 버전 경로 — 질의 임베딩은 그대로(턴당 1회), 후보 벡터만 버전 슬롯 기준.
    if (source) {
      if (source.entries.length === 0) return undefined;
      return assembleSemanticInput(embedded.vector, source.entries, bundle, thresholds, source.modelId);
    }

    const vectors = await this.vectorCache.get(chatbotId, embedded.modelId);
    if (!vectors || vectors.entries.length === 0) return undefined;

    return assembleSemanticInput(embedded.vector, vectors.entries, bundle, thresholds, embedded.modelId);
  }
}
