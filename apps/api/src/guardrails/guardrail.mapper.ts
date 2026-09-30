import type { GuardrailRule as GuardrailRuleRow } from '@prisma/client';
import type { GuardrailRule, GuardrailRuleBody } from '@chat-bot/shared-types';
import { parseExpressions } from './runtime/guardrail-profile.loader';

/** 행 ↔ DTO(표현 JSON 파싱 — 깨진 JSON은 빈 배열). */
export function toRuleDto(row: GuardrailRuleRow, extras: { replacementBannedHit: boolean; recentHits7d: number }): GuardrailRule {
  const expressions = parseExpressions(row.expressions);
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    name: row.name,
    category: row.category as GuardrailRule['category'],
    expressions,
    matchType: row.matchType as GuardrailRule['matchType'],
    appliesTo: row.appliesTo as GuardrailRule['appliesTo'],
    action: row.action as GuardrailRule['action'],
    replacementText: row.replacementText,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    expressionCount: expressions.length,
    replacementBannedHit: extras.replacementBannedHit,
    recentHits7d: extras.recentHits7d,
    updatedByEmail: row.updatedByEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 감사 스냅샷 투영 — 표현·대체 문구 **본문은 담지 않는다**(`expressionCount`·`hasReplacementText` 파생값만,
 * 설계서 §14 · FR-AG1-7).
 */
export function toRuleAuditView(row: GuardrailRuleRow): Record<string, unknown> {
  return {
    name: row.name,
    category: row.category,
    appliesTo: row.appliesTo,
    action: row.action,
    matchType: row.matchType,
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    expressionCount: parseExpressions(row.expressions).length,
    hasReplacementText: !!row.replacementText,
  };
}

export type { GuardrailRuleBody };
