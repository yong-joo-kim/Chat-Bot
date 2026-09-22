import type { FaqCategory, FaqEntry } from '@chat-bot/shared-types';
import { jaccard, normalizeText, tokenize } from './normalize';

export interface FaqMatchResult {
  faqId: string;
  answer: string;
  matchedText: string;
}

export interface MatchFaqEntryOptions {
  /**
   * true면 부분 문자열 포함 매칭을 평가하지 않는다(DD-73, ADR-0020) — 반환값이 있다면 항상 정확일치다.
   * 미지정(기본 false)이면 기존 동작(정확일치+부분일치)과 바이트 단위로 동일하다(AC-N1-3).
   */
  exactOnly?: boolean;
}

/** FAQ `question` + `altQuestions`를 동등하게 취급해 매칭한다(FR-9-3). `enabled=false`는 제외(FR-9-7). */
export function matchFaqEntry(normalizedInput: string, faqs: FaqEntry[], options?: MatchFaqEntryOptions): FaqMatchResult | null {
  if (!normalizedInput) return null;
  const exactOnly = options?.exactOnly ?? false;
  let best: FaqMatchResult | null = null;
  let bestScore = 0;

  for (const faq of faqs) {
    if (faq.enabled === false) continue;
    const candidates = [faq.question, ...(faq.altQuestions ?? [])];
    for (const candidate of candidates) {
      const norm = normalizeText(candidate);
      if (!norm) continue;
      let score = 0;
      if (normalizedInput === norm) {
        score = norm.length + 1000;
      } else if (!exactOnly && (normalizedInput.includes(norm) || norm.includes(normalizedInput))) {
        score = Math.min(normalizedInput.length, norm.length);
      }
      if (score > bestScore) {
        bestScore = score;
        best = { faqId: faq.id, answer: faq.answer, matchedText: candidate };
      }
    }
  }
  return best;
}

export interface FaqSuggestionResult {
  id: string;
  question: string;
  category: FaqCategory;
  score: number;
  matchedBy: 'PREFIX' | 'CONTAINS' | 'TOKEN';
}

/**
 * 규칙 기반 FAQ 유사 후보(FR-9-5). 정확 일치는 `DUPLICATE_FAQ`의 영역이므로 후보에서 제외한다.
 * 점수 = 접두 일치 > 부분 문자열 포함 > 토큰 자카드(≥0.5) 중 최댓값.
 */
export function suggestSimilarFaqs(q: string, faqs: FaqEntry[], limit = 5): FaqSuggestionResult[] {
  const normQ = normalizeText(q);
  if (!normQ) return [];
  const tokensQ = tokenize(normQ);

  const results: FaqSuggestionResult[] = [];
  for (const faq of faqs) {
    const candidates = [faq.question, ...(faq.altQuestions ?? [])];
    let bestForFaq: FaqSuggestionResult | null = null;
    for (const candidate of candidates) {
      const norm = normalizeText(candidate);
      if (!norm || norm === normQ) continue;

      let score = 0;
      let matchedBy: FaqSuggestionResult['matchedBy'] | null = null;
      if (norm.startsWith(normQ) || normQ.startsWith(norm)) {
        const ratio = Math.min(norm.length, normQ.length) / Math.max(norm.length, normQ.length);
        score = 0.9 + 0.1 * ratio;
        matchedBy = 'PREFIX';
      } else if (norm.includes(normQ) || normQ.includes(norm)) {
        const ratio = Math.min(norm.length, normQ.length) / Math.max(norm.length, normQ.length);
        score = 0.7 * ratio;
        matchedBy = 'CONTAINS';
      } else {
        const j = jaccard(tokensQ, tokenize(norm));
        if (j >= 0.5) {
          score = 0.5 + (0.4 * (j - 0.5)) / 0.5;
          matchedBy = 'TOKEN';
        }
      }

      if (matchedBy && (!bestForFaq || score > bestForFaq.score)) {
        bestForFaq = { id: faq.id, question: faq.question, category: faq.category, score, matchedBy };
      }
    }
    if (bestForFaq) results.push(bestForFaq);
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
