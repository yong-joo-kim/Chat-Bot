import type { DecompositionSpan, DecompositionSpanRole } from '@chat-bot/shared-types';

const ROLE_CYCLE: DecompositionSpanRole[] = ['ENTITY_CANDIDATE', 'INTENT_SIGNAL', 'IGNORED'];

/** 칩 역할 순환(§5.4) — `ENTITY_CANDIDATE → INTENT_SIGNAL → IGNORED → ENTITY_CANDIDATE`. */
export function cycleRole(role: DecompositionSpanRole): DecompositionSpanRole {
  const idx = ROLE_CYCLE.indexOf(role);
  return ROLE_CYCLE[(idx + 1) % ROLE_CYCLE.length];
}

/**
 * `spanIndex`번째 스팬을 원문 기준 절대 위치 `at`에서 둘로 나눈다(§5.4 경계 편집).
 * `at`은 해당 스팬 내부의 경계여야 한다(`span.start < at < span.end`) — 아니면 원본을 그대로 반환한다.
 * 두 조각 모두 원래 역할을 유지한다(관리자가 이후 역할 순환으로 조정한다).
 */
export function splitSpanAt(spans: DecompositionSpan[], spanIndex: number, at: number): DecompositionSpan[] {
  const span = spans[spanIndex];
  if (!span || at <= span.start || at >= span.end) return spans;
  const left: DecompositionSpan = { ...span, end: at, text: span.text.slice(0, at - span.start), matchedKeyword: undefined };
  const right: DecompositionSpan = { ...span, start: at, text: span.text.slice(at - span.start), matchedKeyword: undefined };
  return [...spans.slice(0, spanIndex), left, right, ...spans.slice(spanIndex + 1)];
}

/**
 * 인접한 두 스팬(`indexA`, `indexA+1`)을 하나로 합친다. 합친 스팬의 역할은 왼쪽 스팬의 역할을
 * 유지한다(§5.4). `matchedKeyword`는 두 조각 중 하나만 매칭됐던 경우라도 신뢰할 수 없으므로 비운다.
 */
export function mergeSpans(spans: DecompositionSpan[], indexA: number): DecompositionSpan[] {
  const a = spans[indexA];
  const b = spans[indexA + 1];
  if (!a || !b) return spans;
  const merged: DecompositionSpan = { start: a.start, end: b.end, text: a.text + b.text, role: a.role, matchedKeyword: undefined };
  return [...spans.slice(0, indexA), merged, ...spans.slice(indexA + 2)];
}

export const DECOMPOSITION_ROLE_CYCLE = ROLE_CYCLE;
