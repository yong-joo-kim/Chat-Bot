import { toKstDayBucket } from '@chat-bot/shared-types';
import type { GuardrailAppliedAction, GuardrailEffect, GuardrailEventKind, GuardrailPiiKind, GuardrailStage } from '@chat-bot/shared-types';
import type { GuardrailEventContext, InboundVerdict, OutboundVerdict } from './types';

/**
 * 판정 → 이벤트 행 목록(설계서 §8.1) — **문장 0**: 규칙 표현(`matched`)·대체 문구·답 본문은 행에 싣지 않는다.
 * 순수 함수(DB·Nest 무의존). 규칙 이름·분류는 스냅샷(규칙이 삭제돼도 이벤트가 남는다).
 */
export interface GuardrailEventRow {
  chatbotId: string;
  messageId: string;
  stage: GuardrailStage;
  kind: GuardrailEventKind;
  ruleId: string | null;
  ruleName: string | null;
  category: string | null;
  ruleAction: string | null;
  appliedAction: GuardrailAppliedAction;
  decisive: boolean;
  effect: GuardrailEffect;
  piiKind: GuardrailPiiKind | null;
  piiCount: number | null;
  errorCode: string | null;
  dayBucket: string;
}

function base(ctx: GuardrailEventContext, stage: GuardrailStage): Pick<GuardrailEventRow, 'chatbotId' | 'messageId' | 'stage' | 'dayBucket'> {
  return { chatbotId: ctx.chatbotId, messageId: ctx.messageId, stage, dayBucket: toKstDayBucket(ctx.now) };
}

/**
 * 입구 이벤트 — 적중 규칙마다 1행. `NO_RAG`의 결정 규칙 효과는 이 턴이 원래 RAG를 탈 수 있었는지
 * (`ragEligible`)에 따라 `CHANGED`/`NONE`(어차피 안 탈 턴이면 바뀐 게 없다).
 */
export function buildInboundEvents(ctx: GuardrailEventContext, verdict: InboundVerdict, ragEligible: boolean): GuardrailEventRow[] {
  if (verdict.action === 'PASS' || verdict.hits.length === 0) return [];
  const applied = verdict.action as GuardrailAppliedAction;
  return verdict.hits.map((hit) => {
    const decisive = hit.ruleId === verdict.decisiveRuleId;
    let effect: GuardrailEffect = 'NONE';
    if (decisive) {
      if (verdict.action === 'REPLACE') effect = 'CHANGED';
      else if (verdict.action === 'NO_RAG') effect = ragEligible ? 'CHANGED' : 'NONE';
    }
    return {
      ...base(ctx, 'INBOUND'),
      kind: 'RULE' as const,
      ruleId: hit.ruleId,
      ruleName: hit.ruleName,
      category: hit.category,
      ruleAction: hit.action,
      appliedAction: applied,
      decisive,
      effect,
      piiKind: null,
      piiCount: null,
      errorCode: null,
    };
  });
}

/**
 * 출구 이벤트 — 규칙 적중마다 1행 + 개인정보 종류마다 1행(첫 행만 `decisive=true` — 턴 수 집계용) + 오류 1행.
 * `PASS`이고 오류·적중이 없으면 빈 배열.
 */
export function buildOutboundEvents(ctx: GuardrailEventContext, verdict: OutboundVerdict): GuardrailEventRow[] {
  const rows: GuardrailEventRow[] = [];

  for (const hit of verdict.hits) {
    const decisive = hit.ruleId === verdict.decisiveRuleId;
    const replaced = verdict.kind === 'REPLACE';
    rows.push({
      ...base(ctx, 'OUTBOUND'),
      kind: 'RULE',
      ruleId: hit.ruleId,
      ruleName: hit.ruleName,
      category: hit.category,
      ruleAction: hit.action,
      appliedAction: replaced ? 'REPLACE' : 'MONITOR',
      decisive,
      effect: replaced && decisive ? 'CHANGED' : 'NONE',
      piiKind: null,
      piiCount: null,
      errorCode: null,
    });
  }

  const piiKinds = Object.entries(verdict.piiCounts).filter(([, n]) => (n ?? 0) > 0) as Array<[GuardrailPiiKind, number]>;
  piiKinds.forEach(([piiKind, count], i) => {
    rows.push({
      ...base(ctx, 'OUTBOUND'),
      kind: 'PII',
      ruleId: null,
      ruleName: null,
      category: null,
      ruleAction: null,
      appliedAction: verdict.kind === 'FALLBACK' ? 'FALLBACK' : 'MASK',
      decisive: i === 0,
      effect: 'CHANGED',
      piiKind,
      piiCount: count,
      errorCode: null,
    });
  });

  const fellBackOnError = verdict.kind === 'FALLBACK' && verdict.fallbackReason !== 'PII_ONLY';
  if (fellBackOnError || verdict.errorCode) {
    rows.push({
      ...base(ctx, 'OUTBOUND'),
      kind: 'ERROR',
      ruleId: null,
      ruleName: null,
      category: null,
      ruleAction: null,
      appliedAction: fellBackOnError ? 'FALLBACK' : 'MONITOR',
      decisive: false,
      effect: fellBackOnError ? 'CHANGED' : 'NONE',
      piiKind: null,
      piiCount: null,
      errorCode: verdict.errorCode ?? verdict.fallbackReason ?? 'UNKNOWN',
    });
  }

  return rows;
}
