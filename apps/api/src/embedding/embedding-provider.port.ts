/**
 * 1단계(NLU 의미 유사도 매칭)의 임베딩 조달 포트 (FR-N1-1, ADR-0024).
 *
 * 소비자(향후 SemanticMatchService 등)는 이 인터페이스만 알아야 하며, 구현체가
 * apps/ml-worker(HTTP)인지 구독형 배포의 외부 임베딩 API인지 알지 못한다.
 * 구현체 교체 지점은 `EmbeddingProviderFactory`(embedding-provider.factory.ts, 미구현 —
 * 벡터 캐시·DI 바인딩과 함께 backend-implementer가 embedding 모듈을 구성할 때 만든다) 1곳이다.
 *
 * 계약(설계서 §4.2·§8.3):
 * - `embed()`가 반환하는 벡터는 항상 L2 정규화되어 있다(FR-N1-5). 소비자는 내적을
 *   코사인 유사도로 그대로 쓰면 된다 — 다시 정규화하지 않는다.
 * - `kind`는 비대칭 인코딩 모델(prefix가 필요한 모델) 대비다. 프리픽스 규칙 자체는
 *   구현체(ml-worker) 안에 있으며 이 포트의 소비자는 알지 못한다.
 * - `modelId`/`dimension`은 구현체 기동(또는 최초 헬스체크) 시점에 고정된다.
 *   모델이 바뀌면 이 값도 바뀌므로, 저장된 벡터와 다르면 소비자가 저하 모드로 처리한다
 *   (FR-N1-4, EX-N1-2 — 판정은 apps/api의 벡터 캐시 쪽 책임이며 이 포트의 책임이 아니다).
 */
export type EmbeddingKind = 'QUERY' | 'PASSAGE';

export interface EmbeddingProvider {
  /** `<model-name>@<rev>|<prefix-rule>|<norm-rule>` 규약 문자열(DD-69). */
  readonly modelId: string;
  readonly dimension: number;

  /**
   * 텍스트 배열을 L2 정규화된 벡터 배열로 변환한다.
   * 배치 상한(기본 64건)은 구현체가 강제하며, 초과 시 구현체가 예외를 던진다.
   */
  embed(texts: string[], kind: EmbeddingKind): Promise<Float32Array[]>;

  /** 회로차단기·저하 모드 판단에 쓰인다(FR-N1-32). 예외를 던지지 않는다. */
  healthy(): Promise<boolean>;
}

/** 임베딩 서비스가 응답하지 않거나 상태가 비정상일 때 (연결 실패·타임아웃 포함). */
export class EmbeddingProviderUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EmbeddingProviderUnavailableError';
  }
}

/** 응답 스키마가 계약과 다를 때(zod 파싱 실패 등) — 외부 응답을 신뢰하지 않는다(FR-0-42와 같은 원칙). */
export class EmbeddingResponseInvalidError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'EmbeddingResponseInvalidError';
  }
}
