import type { MaskedUtteranceText } from '../lib/prepare-utterances';

/**
 * 묶음 이름 제안 포트(No.21 — 설계서 §16.2, FR-DC8). **Nest·Prisma 무의존** — `packages/llm-provider` 승격이
 * 필요해지는 날(같은 생성 연산을 쓰는 두 번째 소비자 또는 cloud 구현이 필요한 두 번째 소비자 — ADR-0047 §8)
 * 그대로 옮길 수 있는 형태로 둔다.
 *
 * 구현은 2개뿐이다: `local`(ml-worker `/cluster-label` HTTP — 출구 파일) · `mock`(시험). **cloud 구현을 두지 않는다**
 * (FR-0-292 — 외부 LLM API로 발화를 보내는 경로 0).
 */
export interface ClusterNameSuggestInput {
  /** 묶음 대표 키워드(1~20, 각 ≤30자). */
  readonly keywords: readonly string[];
  /** 마스킹된 대표 발화(0~5) — 브랜드 타입이라 마스킹을 건너뛴 문장은 넘길 수 없다. */
  readonly samples: readonly MaskedUtteranceText[];
}

export interface ClusterNameSuggester {
  readonly suggesterId: 'local' | 'mock';
  /** 실패·시간 초과·응답 이상 = `null`(예외를 던지지 않는다). */
  suggest(input: ClusterNameSuggestInput, signal: AbortSignal): Promise<string | null>;
}
