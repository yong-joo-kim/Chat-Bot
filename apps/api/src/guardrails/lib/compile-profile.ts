import { normalizeText } from '@chat-bot/shared-types';
import type { GuardrailAction } from '@chat-bot/shared-types';
import type { BannedWordEntry } from '../../banned-words/lib/banned-word-filter';
import type { GuardrailRuleRow } from './types';

/**
 * 규칙 → 금지어 `detect()`가 그대로 먹는 사전으로 컴파일한다(설계서 §4.3 · C-1 · AG-18).
 * `detect()`는 입력 사전의 항목 객체를 그대로 돌려주므로, 항목 객체를 키로 하는 역참조 맵으로
 * 적중 규칙을 되찾는다 — 금지어 파일은 수정하지 않는다. `policy`는 `detect()`가 읽지 않는 자리채움 상수다.
 */

export interface RuleRef {
  ruleId: string;
  ruleName: string;
  category: GuardrailRuleRow['category'];
  action: GuardrailAction;
  sortOrder: number;
  createdAtMs: number;
  replacementText: string | null;
  /** 이 규칙이 적은 원문 표현(시험하기 화면 표시용). */
  expression: string;
}

export interface CompiledDict {
  entries: BannedWordEntry[];
  refs: Map<BannedWordEntry, RuleRef[]>;
}

export interface CompiledProfile {
  inbound: CompiledDict;
  outbound: CompiledDict;
  /** 출구 `REPLACE` 규칙이 하나라도 있는가(판정 예외 시 폴백 여부 판단 — §6.3). */
  hasOutboundReplace: boolean;
}

function emptyDict(): CompiledDict {
  return { entries: [], refs: new Map() };
}

export function emptyProfile(): CompiledProfile {
  return { inbound: emptyDict(), outbound: emptyDict(), hasOutboundReplace: false };
}

interface Builder {
  dict: CompiledDict;
  index: Map<string, BannedWordEntry>;
}

export function compileProfile(rules: readonly GuardrailRuleRow[]): CompiledProfile {
  const inbound: Builder = { dict: emptyDict(), index: new Map() };
  const outbound: Builder = { dict: emptyDict(), index: new Map() };
  let hasOutboundReplace = false;

  for (const rule of rules) {
    const stages: Array<[Builder, 'INBOUND' | 'OUTBOUND']> = [];
    if (rule.appliesTo === 'INBOUND' || rule.appliesTo === 'BOTH') stages.push([inbound, 'INBOUND']);
    if (rule.appliesTo === 'OUTBOUND' || rule.appliesTo === 'BOTH') stages.push([outbound, 'OUTBOUND']);

    for (const [target, stage] of stages) {
      // 출구에서 NO_RAG는 의미가 없다(저장 시 거부 — 방어적으로 기록만으로 취급).
      const action: GuardrailAction = stage === 'OUTBOUND' && rule.action === 'NO_RAG' ? 'MONITOR' : rule.action;
      if (stage === 'OUTBOUND' && action === 'REPLACE') hasOutboundReplace = true;
      for (const expression of rule.expressions) {
        const wordNormalized = normalizeText(expression);
        if (!wordNormalized) continue;
        const key = `${rule.matchType}|${wordNormalized}`;
        let entry = target.index.get(key);
        if (!entry) {
          entry = { word: expression, wordNormalized, matchType: rule.matchType, policy: 'WARN' };
          target.index.set(key, entry);
          target.dict.entries.push(entry);
          target.dict.refs.set(entry, []);
        }
        const refs = target.dict.refs.get(entry)!;
        if (!refs.some((r) => r.ruleId === rule.id)) {
          refs.push({
            ruleId: rule.id,
            ruleName: rule.name,
            category: rule.category,
            action,
            sortOrder: rule.sortOrder,
            createdAtMs: rule.createdAt.getTime(),
            replacementText: rule.replacementText,
            expression,
          });
        }
      }
    }
  }

  return { inbound: inbound.dict, outbound: outbound.dict, hasOutboundReplace };
}
