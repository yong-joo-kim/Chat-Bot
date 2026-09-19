import { normalizeText } from '@chat-bot/shared-types';

export interface SynonymDedupeResult {
  synonyms: string[];
  deduplicatedCount: number;
}

/** 키워드 내부 동의어 정규화 기준 dedupe(FR-6-15). */
export function dedupeSynonyms(synonyms: string[]): SynonymDedupeResult {
  const seen = new Set<string>();
  const result: string[] = [];
  let deduplicatedCount = 0;
  for (const s of synonyms) {
    const norm = normalizeText(s);
    if (!norm) continue;
    if (seen.has(norm)) {
      deduplicatedCount += 1;
      continue;
    }
    seen.add(norm);
    result.push(s.trim());
  }
  return { synonyms: result, deduplicatedCount };
}

export interface OtherKeywordTerms {
  id: string;
  name: string;
  synonyms: string[];
}

/**
 * 동의어 교차 충돌 판정(FR-6-16). 키워드는 값→개념 사전이라 모호성을 허용하지 않는다 — 충돌 시 첫 건을 반환한다.
 */
export function findSynonymConflict(
  currentKeywordId: string | undefined,
  name: string,
  synonyms: string[],
  others: OtherKeywordTerms[],
): { conflictKeywordName: string; term: string } | null {
  const terms = [name, ...synonyms].map(normalizeText);
  for (const other of others) {
    if (other.id === currentKeywordId) continue;
    const otherTerms = new Set([other.name, ...other.synonyms].map(normalizeText));
    for (const t of terms) {
      if (otherTerms.has(t)) return { conflictKeywordName: other.name, term: t };
    }
  }
  return null;
}
