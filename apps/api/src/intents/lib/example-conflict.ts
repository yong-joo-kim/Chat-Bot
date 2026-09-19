import { normalizeText } from '@chat-bot/shared-types';
import type { ExampleConflict } from '@chat-bot/shared-types';

export interface OtherIntentExamples {
  id: string;
  name: string;
  examples: string[];
}

/** 예문 교차 충돌 산출(FR-6-7). 저장은 허용하되 경고 목록만 반환한다(차단 아님). */
export function findExampleConflicts(
  currentIntentId: string | undefined,
  examples: string[],
  others: OtherIntentExamples[],
): ExampleConflict[] {
  const conflicts: ExampleConflict[] = [];
  const normalizedExamples = examples.map(normalizeText);

  for (const other of others) {
    if (other.id === currentIntentId) continue;
    const otherNorm = new Set(other.examples.map(normalizeText));
    examples.forEach((example, i) => {
      if (otherNorm.has(normalizedExamples[i])) {
        conflicts.push({ example, intentId: other.id, intentName: other.name });
      }
    });
  }
  return conflicts;
}
