import { normalizeText } from '@chat-bot/shared-types';

export interface AltQuestionDedupeResult {
  altQuestions: string[];
  deduplicatedCount: number;
}

/** `question` 자신 및 정규화 중복을 제거한 대체 질문 집합(FR-9-3). */
export function dedupeAltQuestions(altQuestions: string[], question: string): AltQuestionDedupeResult {
  const seen = new Set<string>([normalizeText(question)]);
  const result: string[] = [];
  let deduplicatedCount = 0;
  for (const alt of altQuestions) {
    const norm = normalizeText(alt);
    if (!norm || seen.has(norm)) {
      deduplicatedCount += 1;
      continue;
    }
    seen.add(norm);
    result.push(alt.trim());
  }
  return { altQuestions: result, deduplicatedCount };
}

export interface ExistingFaqTexts {
  id: string;
  question: string;
  altQuestions: string[];
}

/** `question`+`altQuestions` 정규화 집합이 다른 FAQ와 겹치는지 판정한다(FR-9-4, AC-9-2). */
export function findDuplicateFaqOwner(
  currentId: string | undefined,
  question: string,
  altQuestions: string[],
  others: ExistingFaqTexts[],
): ExistingFaqTexts | null {
  const terms = new Set([question, ...altQuestions].map(normalizeText));
  for (const other of others) {
    if (other.id === currentId) continue;
    const otherTerms = new Set([other.question, ...other.altQuestions].map(normalizeText));
    for (const t of terms) {
      if (otherTerms.has(t)) return other;
    }
  }
  return null;
}
