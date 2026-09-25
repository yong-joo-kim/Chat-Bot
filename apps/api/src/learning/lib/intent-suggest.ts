import { normalizeText } from '@chat-bot/shared-types';
import type { IntentSuggestion } from '@chat-bot/shared-types';

/**
 * 추천 의도(J-5, ADR-0019 §4) — 문자 bigram 자카드 유사도. **엔진(`matchIntent`)을 호출하지 않는다**
 * — 미응답 질문은 정의상 정확일치/부분일치 판정을 통과하지 못한 문장이므로 재사용해도 항상 `null`이다.
 * `packages/dialogue-engine`은 수정 0줄. DB·Nest 무의존 순수 함수(NFR-M1).
 */

function toBigrams(text: string): Set<string> {
  const chars = Array.from(text);
  if (chars.length === 0) return new Set();
  if (chars.length === 1) return new Set([chars[0]]);
  const set = new Set<string>();
  for (let i = 0; i < chars.length - 1; i += 1) set.add(chars[i] + chars[i + 1]);
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface SuggestCandidateIntent {
  id: string;
  name: string;
  examples: string[];
  /** [신규 No.22] 값 없음 = 공통. */
  topicId?: string;
}

/**
 * 정규화된 질문 문자열과 후보 의도 집합(의도명 + 예문 전체)의 최고 점수를 산출한다(FR-15-16).
 * `intents`는 요청당 1회 로드해 호출부가 여러 행에 공유해야 한다(NFR-P4, N+1 금지).
 */
export function suggestIntents(
  normalizedQuestion: string,
  intents: SuggestCandidateIntent[],
  opts: { minScore: number; max: number },
): IntentSuggestion[] {
  const questionBigrams = toBigrams(normalizedQuestion);
  const results: IntentSuggestion[] = [];

  for (const intent of intents) {
    let bestScore = 0;
    let bestCandidate = intent.name;
    for (const candidate of [intent.name, ...intent.examples]) {
      const score = jaccard(questionBigrams, toBigrams(normalizeText(candidate)));
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }
    if (bestScore >= opts.minScore) {
      results.push({
        intentId: intent.id,
        intentName: intent.name,
        score: round4(bestScore),
        matchedExample: bestCandidate,
        ...(intent.topicId ? { topicId: intent.topicId } : {}),
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, opts.max);
}
