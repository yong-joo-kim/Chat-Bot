import type { Intent, FaqEntry, SimulateResult } from '@chat-bot/shared-types';

/**
 * 규칙기반 의도 매칭(Phase 1 최소 구현).
 * 딥러닝 증강학습(기능요구사항.md No.16, 확장기능)은 범위 밖 — 정확일치/부분일치만 지원한다.
 */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface IntentMatch {
  intentId: string;
  matchedExample: string;
}

export function matchIntent(input: string, intents: Intent[]): IntentMatch | null {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return null;

  let best: IntentMatch | null = null;
  let bestScore = 0;

  for (const intent of intents) {
    for (const example of intent.examples) {
      const normalizedExample = normalize(example);
      if (!normalizedExample) continue;

      let score = 0;
      if (normalizedInput === normalizedExample) {
        score = normalizedExample.length + 1000; // 정확일치 최우선
      } else if (normalizedInput.includes(normalizedExample) || normalizedExample.includes(normalizedInput)) {
        score = Math.min(normalizedInput.length, normalizedExample.length);
      }

      if (score > bestScore) {
        bestScore = score;
        best = { intentId: intent.id, matchedExample: example };
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
  const normalizedInput = normalize(input);
  if (!normalizedInput) return null;

  let best: FaqMatch | null = null;
  let bestScore = 0;

  for (const faq of faqs) {
    const normalizedQuestion = normalize(faq.question);
    let score = 0;
    if (normalizedInput === normalizedQuestion) {
      score = normalizedQuestion.length + 1000;
    } else if (normalizedInput.includes(normalizedQuestion) || normalizedQuestion.includes(normalizedInput)) {
      score = Math.min(normalizedInput.length, normalizedQuestion.length);
    }

    if (score > bestScore) {
      bestScore = score;
      best = { faqId: faq.id, answer: faq.answer };
    }
  }

  return best;
}

const DEFAULT_FALLBACK_RESPONSE = '죄송해요, 잘 이해하지 못했어요. 다른 방식으로 질문해 주시겠어요?';

/** 기능요구사항.md No.10 응답 테스트/시뮬레이션이 호출하는 진입점 */
export function simulate(input: string, intents: Intent[], faqs: FaqEntry[]): SimulateResult {
  const faqMatch = matchFaq(input, faqs);
  if (faqMatch) {
    return { input, matchedFaqId: faqMatch.faqId, response: faqMatch.answer };
  }

  const intentMatch = matchIntent(input, intents);
  if (intentMatch) {
    return {
      input,
      matchedIntentId: intentMatch.intentId,
      response: `[${intentMatch.intentId}] 의도로 매칭되었습니다 (예문: "${intentMatch.matchedExample}")`,
    };
  }

  return { input, response: DEFAULT_FALLBACK_RESPONSE };
}
