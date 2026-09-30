import { detect } from '../../banned-words/lib/banned-word-filter';
import type { CompiledDict, RuleRef } from './compile-profile';
import { compareHits, pickStrongest } from './strongest-action';
import type { InboundAction, RuleHit } from './types';

export interface EvaluationResult {
  action: InboundAction;
  hits: RuleHit[];
  replacementText?: string;
  decisiveRuleId?: string;
}

/**
 * ★ 판정 교체 지점(NFR-AGM2) — (텍스트, 컴파일된 사전) → 적중·최종 동작·대체 문구·결정 규칙.
 * 사전이 비어 있으면 정규화조차 하지 않고 즉시 `PASS`(FR-AG2-6). 금지어 `detect()`를 import만 한다(AG-18).
 */
export function evaluateRules(text: string, dict: CompiledDict): EvaluationResult {
  if (dict.entries.length === 0) return { action: 'PASS', hits: [] };

  const matches = detect(text, dict.entries);
  if (matches.length === 0) return { action: 'PASS', hits: [] };

  // 규칙당 1회(같은 규칙이 여러 표현으로 걸려도 적중 1건) — 적중 표현 목록을 모은다.
  const byRule = new Map<string, { ref: RuleRef; matched: string[] }>();
  for (const entry of matches) {
    for (const ref of dict.refs.get(entry) ?? []) {
      const slot = byRule.get(ref.ruleId) ?? { ref, matched: [] };
      if (!slot.matched.includes(ref.expression)) slot.matched.push(ref.expression);
      byRule.set(ref.ruleId, slot);
    }
  }
  if (byRule.size === 0) return { action: 'PASS', hits: [] };

  const sorted = [...byRule.values()].sort((a, b) => compareHits(a.ref, b.ref));
  const hits: RuleHit[] = sorted.map(({ ref, matched }) => ({
    ruleId: ref.ruleId,
    ruleName: ref.ruleName,
    category: ref.category,
    action: ref.action,
    sortOrder: ref.sortOrder,
    matched,
  }));

  const strongest = pickStrongest(hits);
  if (!strongest) return { action: 'PASS', hits };

  const result: EvaluationResult = { action: strongest.action, hits, decisiveRuleId: strongest.decisive.ruleId };
  if (strongest.action === 'REPLACE') {
    const decisiveRef = sorted.find((s) => s.ref.ruleId === strongest.decisive.ruleId)!.ref;
    result.replacementText = decisiveRef.replacementText ?? undefined;
  }
  return result;
}
