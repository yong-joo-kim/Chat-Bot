import type { SemanticMatchInput, SemanticRankedCandidate } from '@chat-bot/shared-types';

/**
 * 1단계(NLU 의미 유사도) 3구간 판정 — J-4, ADR-0021. **판정 함수는 이 1곳뿐**이며
 * 엔진(`resolver.ts`) · `apps/api`의 임계값 미리보기(FR-N3-5) · 시뮬레이터(FR-N3-10)가
 * 전부 이 함수를 공유한다(NFR-M2, AC-N3-9) — 복제하면 "미리보기에서는 확정인데 실제로는
 * 되묻기"인 불일치가 생긴다.
 *
 * DB·네트워크·시간에 무의존한 순수 함수다(NFR-M1). `ranked`는 이미 점수 내림차순 +
 * 결정론적 타이브레이크(FAQ→INTENT, id asc)가 적용된 상태로 주입된다(FR-N1-10 — 조립은
 * `apps/api`의 `SemanticMatchService` 책임).
 */
export type SemanticBand =
  | { kind: 'CONFIRMED'; candidate: SemanticRankedCandidate }
  | { kind: 'AMBIGUOUS'; candidates: readonly SemanticRankedCandidate[] }
  | { kind: 'FAILED' };

export function judgeBand(
  ranked: readonly SemanticRankedCandidate[],
  thresholds: SemanticMatchInput['thresholds'],
): SemanticBand {
  if (ranked.length === 0) return { kind: 'FAILED' };

  const s1 = ranked[0].score;
  if (s1 < thresholds.low) return { kind: 'FAILED' };

  // 후보가 1건뿐이면 되묻지 않고 확정한다(FR-N1-13) — 되묻는 비용이 이득보다 크다.
  if (ranked.length === 1) return { kind: 'CONFIRMED', candidate: ranked[0] };

  const s2 = ranked[1].score;
  const marginOk = s1 - s2 >= thresholds.margin;
  if (s1 >= thresholds.accept && marginOk) return { kind: 'CONFIRMED', candidate: ranked[0] };

  // 모호 구간 — 최대 3건만 제시한다(FR-N1-13, EX-N1-11).
  return { kind: 'AMBIGUOUS', candidates: ranked.slice(0, 3) };
}
