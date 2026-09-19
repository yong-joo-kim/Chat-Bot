import { normalizeText } from '@chat-bot/shared-types';

export interface ExampleDedupeResult {
  examples: string[];
  deduplicatedCount: number;
}

/** 정규화 기준 dedupe. 첫 등장 원문을 보존한다(FR-6-5, 오류가 아니다). */
export function dedupeExamples(examples: string[]): ExampleDedupeResult {
  const seen = new Set<string>();
  const result: string[] = [];
  let deduplicatedCount = 0;
  for (const example of examples) {
    const norm = normalizeText(example);
    if (!norm) continue;
    if (seen.has(norm)) {
      deduplicatedCount += 1;
      continue;
    }
    seen.add(norm);
    result.push(example.trim());
  }
  return { examples: result, deduplicatedCount };
}

/** 예문 단건 추가/삭제 병합(FR-6-10). remove는 정규화 기준 비교로 매칭한다. */
export function mergeExampleMutation(current: string[], add: string[] = [], remove: string[] = []): ExampleDedupeResult {
  const removeSet = new Set(remove.map(normalizeText));
  const kept = current.filter((ex) => !removeSet.has(normalizeText(ex)));
  return dedupeExamples([...kept, ...add]);
}
