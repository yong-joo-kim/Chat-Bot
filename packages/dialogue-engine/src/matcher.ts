import type { DialogueBundle, DialogueResolution, FaqEntry, Intent, SimulateResult } from '@chat-bot/shared-types';
import { normalizeText } from './normalize';
import { matchFaqEntry } from './faq';
import { resolveResponse } from './resolver';
import { DEFAULT_FALLBACK_RESPONSE } from './constants';
import type { DialogueIndex } from './dialogue-index';

/**
 * 규칙기반 의도 매칭(Phase 1 최소 구현, ADR-0008로 하위호환 유지).
 * 딥러닝 증강학습(기능요구사항.md No.16, 확장기능)은 범위 밖 — 정확일치/부분일치만 지원한다.
 */

export interface IntentMatch {
  intentId: string;
  matchedExample: string;
}

export interface MatchIntentOptions {
  /** 동음이의어 보정 등으로 확정된 의도를 동점 시가 아니라 확정적으로 우선 선택한다(§7.3 S2). */
  boostIntentIds?: string[];
  /** 사전 구축한 인덱스 재사용(FR-E-10). 대량 예문에서 반복 정규화를 피한다. */
  index?: DialogueIndex;
  /**
   * true면 부분 문자열 포함 매칭을 평가하지 않는다(DD-73, ADR-0020) — `ResolveOptions.semantic`이
   * 주입된 턴(1단계 활성)에서 쓴다. 그 턴의 "의미 유사도 점수"는 `apps/api`가 조립한
   * `SemanticMatchInput.ranked`를 통해 `resolver.ts`가 별도로 판정하므로(`judgeBand`), 이 옵션이
   * true일 때 이 함수는 **정확일치 전용 검사기**가 된다 — 반환값이 있다면 항상 정확일치다.
   * 미지정(기본 false)이면 기존 동작(정확일치+부분일치)과 바이트 단위로 동일하다(AC-N1-3).
   */
  exactOnly?: boolean;
}

const BOOST_SCORE = 100_000;

export function matchIntent(input: string, intents: Intent[], options?: MatchIntentOptions): IntentMatch | null {
  const normalizedInput = normalizeText(input);
  if (!normalizedInput) return null;

  const boostSet = new Set(options?.boostIntentIds ?? []);
  const exactOnly = options?.exactOnly ?? false;
  let best: IntentMatch | null = null;
  let bestScore = 0;

  const consider = (intentId: string, norm: string, original: string): void => {
    if (!norm) return;
    let score = 0;
    if (normalizedInput === norm) {
      score = norm.length + 1000;
    } else if (!exactOnly && (normalizedInput.includes(norm) || norm.includes(normalizedInput))) {
      score = Math.min(normalizedInput.length, norm.length);
    } else {
      return;
    }
    if (boostSet.has(intentId)) score += BOOST_SCORE;
    if (score > bestScore) {
      bestScore = score;
      best = { intentId, matchedExample: original };
    }
  };

  if (options?.index) {
    for (const entry of options.index.examplePartial) {
      consider(entry.intentId, entry.norm, entry.original);
    }
  } else {
    for (const intent of intents) {
      for (const example of intent.examples) {
        consider(intent.id, normalizeText(example), example);
      }
    }
  }

  return best;
}

export interface FaqMatch {
  faqId: string;
  answer: string;
}

export function matchFaq(input: string, faqs: FaqEntry[]): FaqMatch | null {
  const normalizedInput = normalizeText(input);
  const result = matchFaqEntry(normalizedInput, faqs);
  return result ? { faqId: result.faqId, answer: result.answer } : null;
}

function toSimulateResult(resolution: DialogueResolution): SimulateResult {
  const firstText = resolution.outputs.find((o) => o.type === 'TEXT');
  const response = firstText && firstText.type === 'TEXT' ? firstText.payload.text : DEFAULT_FALLBACK_RESPONSE;
  return {
    input: resolution.input,
    matchedIntentId: resolution.matchedIntentId,
    matchedFaqId: resolution.matchedFaqId,
    response,
  };
}

/**
 * 기능요구사항.md No.10 응답 테스트/시뮬레이션이 호출하는 진입점.
 * @deprecated No.10 Phase에서 `resolveResponse`로 대체 예정 — 신규 호출부는 `resolveResponse`를 쓴다(ADR-0008).
 * `dialogNodes`가 빈 배열이므로 항상 FAQ → 의도 순서가 재현되어 기존 테스트가 그대로 통과한다.
 */
export function simulate(input: string, intents: Intent[], faqs: FaqEntry[], now: Date = new Date()): SimulateResult {
  const bundle: DialogueBundle = { intents, faqs, keywords: [], homonyms: [], dialogNodes: [], contexts: [] };
  return toSimulateResult(resolveResponse(input, null, bundle, now));
}
