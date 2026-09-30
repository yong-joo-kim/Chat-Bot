import type { UtteranceApplyExcludeReason } from '@chat-bot/shared-types';

/**
 * 선택 발화 → 의도 예문 반영 계획(No.21 — 설계서 §15.1, FR-DC7). DB·Nest 무의존 순수 함수.
 *
 * 판정 순서(첫 번째로 걸린 사유로 제외):
 *  1 이 분석의 발화가 아님 → `NOT_FOUND`
 *  2 이미 반영됨 → `ALREADY_APPLIED`
 *  3 금지어 포함 → `BANNED_WORD`(서버에서 항상 제외 — 마스킹된 `***`가 예문에 들어가는 것을 막는다, R-4)
 *  4 길이 > 200 → `TOO_LONG`
 *  5 대상 의도에 같은 정규화 예문 → `DUPLICATE_IN_TARGET`
 *  6 다른 의도에 같은 정규화 예문 → `DUPLICATE_IN_OTHER_INTENT`(+ 의도 이름 — 기존 서비스는 경고이지만 이 경로는 제외, R-5)
 *  7 포함 후 예문 수 > 상한 → 넘는 분(정렬 순서 뒤쪽)부터 `TARGET_LIMIT`
 *  — 마스킹 표식 포함 발화는 **포함하되 경고**(`MASK_TOKEN`)
 */

export interface PlanUtterance {
  readonly id: string;
  readonly seq: number;
  readonly text: string;
  readonly textNormalized: string;
  readonly hasBannedWord: boolean;
  readonly hasMaskToken: boolean;
  readonly applied: boolean;
}

export interface ApplyPlanInput {
  /** 요청 순서 그대로(중복은 이 함수가 제거한다). */
  readonly requestedIds: readonly string[];
  /** 이 분석에 속한 발화(요청 id 중 찾은 것만). */
  readonly found: ReadonlyMap<string, PlanUtterance>;
  /** 대상 의도의 현재 예문(정규화) — 새 의도면 빈 집합. */
  readonly targetExamplesNormalized: ReadonlySet<string>;
  /** 대상 의도의 현재 예문 수. */
  readonly targetExampleCount: number;
  /** 다른 의도들의 정규화 예문 → 의도 이름(대상 의도는 제외해서 넘긴다). */
  readonly otherIntentExamples: ReadonlyMap<string, string>;
  readonly maxChars: number;
  readonly maxExamples: number;
}

export interface ApplyPlanIncluded {
  readonly utteranceId: string;
  readonly text: string;
  readonly warnings: ('MASK_TOKEN')[];
}

export interface ApplyPlanExcluded {
  readonly utteranceId: string;
  readonly reason: UtteranceApplyExcludeReason;
  readonly conflictIntentName?: string;
}

export interface ApplyPlan {
  /** 반영 순서(= `seq` 오름차순). */
  readonly included: readonly ApplyPlanIncluded[];
  readonly excluded: readonly ApplyPlanExcluded[];
  readonly resultingExampleCount: number;
}

export function planApply(input: ApplyPlanInput): ApplyPlan {
  const excluded: ApplyPlanExcluded[] = [];
  const candidates: PlanUtterance[] = [];
  const seen = new Set<string>();

  for (const id of input.requestedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const u = input.found.get(id);
    if (!u) {
      excluded.push({ utteranceId: id, reason: 'NOT_FOUND' });
      continue;
    }
    if (u.applied) {
      excluded.push({ utteranceId: id, reason: 'ALREADY_APPLIED' });
      continue;
    }
    if (u.hasBannedWord) {
      excluded.push({ utteranceId: id, reason: 'BANNED_WORD' });
      continue;
    }
    if ([...u.text].length > input.maxChars) {
      excluded.push({ utteranceId: id, reason: 'TOO_LONG' });
      continue;
    }
    if (input.targetExamplesNormalized.has(u.textNormalized)) {
      excluded.push({ utteranceId: id, reason: 'DUPLICATE_IN_TARGET' });
      continue;
    }
    const conflict = input.otherIntentExamples.get(u.textNormalized);
    if (conflict !== undefined) {
      excluded.push({ utteranceId: id, reason: 'DUPLICATE_IN_OTHER_INTENT', conflictIntentName: conflict });
      continue;
    }
    candidates.push(u);
  }

  // 정렬 순서(seq) — 상한 초과 시 뒤쪽부터 잘린다.
  candidates.sort((a, b) => a.seq - b.seq);
  const room = Math.max(0, input.maxExamples - input.targetExampleCount);
  const included: ApplyPlanIncluded[] = [];
  for (const u of candidates) {
    if (included.length >= room) {
      excluded.push({ utteranceId: u.id, reason: 'TARGET_LIMIT' });
      continue;
    }
    included.push({ utteranceId: u.id, text: u.text, warnings: u.hasMaskToken ? ['MASK_TOKEN'] : [] });
  }

  return { included, excluded, resultingExampleCount: input.targetExampleCount + included.length };
}
