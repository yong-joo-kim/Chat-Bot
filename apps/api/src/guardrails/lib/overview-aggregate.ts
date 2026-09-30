import type { GuardrailAction, GuardrailCategory, GuardrailOverview, GuardrailPiiKind } from '@chat-bot/shared-types';

/**
 * 이벤트·로그 집계 → 현황 DTO 조각(설계서 §8.4) — 순수 함수. 합계 = 이벤트 합(AC-AG5-2 — 같은
 * groupBy 결과에서 파생한다).
 */

export interface EventGroupRow {
  stage: 'INBOUND' | 'OUTBOUND';
  kind: 'RULE' | 'PII' | 'ERROR';
  appliedAction: 'MONITOR' | 'REPLACE' | 'NO_RAG' | 'MASK' | 'FALLBACK';
  effect: 'CHANGED' | 'NONE';
  decisive: boolean;
  count: number;
}

export interface RuleGroupRow {
  ruleId: string;
  ruleName: string | null;
  category: string | null;
  stage: 'INBOUND' | 'OUTBOUND';
  effect: 'CHANGED' | 'NONE';
  count: number;
}

export interface PiiGroupRow {
  piiKind: string;
  /** 그 종류가 가려진 답(턴) 수 = 이벤트 행 수. */
  answers: number;
  /** 가려진 개수 합. */
  count: number;
}

export interface CurrentRuleInfo {
  id: string;
  name: string;
  category: GuardrailCategory;
  action: GuardrailAction;
  enabled: boolean;
}

export interface OverviewAggregateInput {
  eventGroups: readonly EventGroupRow[];
  ruleGroups: readonly RuleGroupRow[];
  piiGroups: readonly PiiGroupRow[];
  currentRules: readonly CurrentRuleInfo[];
  /** 기간 내 RAG가 답한 대화 기록 수(`answeredByRag=true`). */
  answeredByRagCount: number;
  /** 기간 내 `guardrailStage='OUTBOUND'` 대화 기록 수(대체 + 폴백). */
  outboundStagedCount: number;
}

type Aggregate = Pick<GuardrailOverview, 'totals' | 'rules' | 'pii' | 'rag'>;

function sum(rows: readonly EventGroupRow[], predicate: (r: EventGroupRow) => boolean): number {
  return rows.reduce((acc, r) => (predicate(r) ? acc + r.count : acc), 0);
}

const PII_KINDS: readonly GuardrailPiiKind[] = ['RRN', 'CARD', 'ACCOUNT', 'PHONE', 'EMAIL'];

export function aggregateOverview(input: OverviewAggregateInput): Aggregate {
  const g = input.eventGroups;
  const ruleDecisive = (r: EventGroupRow) => r.kind === 'RULE' && r.decisive;

  const inboundHits = sum(g, (r) => ruleDecisive(r) && r.stage === 'INBOUND');
  const outboundHits = sum(g, (r) => ruleDecisive(r) && r.stage === 'OUTBOUND');
  const replaced = sum(g, (r) => ruleDecisive(r) && r.appliedAction === 'REPLACE');
  const noRag = sum(g, (r) => ruleDecisive(r) && r.appliedAction === 'NO_RAG');
  const monitored = sum(g, (r) => ruleDecisive(r) && r.appliedAction === 'MONITOR');
  const maskedAnswers = sum(g, (r) => r.kind === 'PII' && r.decisive && r.appliedAction === 'MASK');
  const errorFallbacks = sum(g, (r) => (r.kind === 'ERROR' && r.appliedAction === 'FALLBACK') || (r.kind === 'PII' && r.decisive && r.appliedAction === 'FALLBACK'));

  const outboundReplaced = sum(g, (r) => ruleDecisive(r) && r.stage === 'OUTBOUND' && r.appliedAction === 'REPLACE');

  // 규칙별 표 — 같은 규칙 id의 행을 합친다(이름이 바뀐 경우 첫 스냅샷 이름을 쓰되, 현재 규칙이 있으면 현재 이름).
  const currentById = new Map(input.currentRules.map((r) => [r.id, r]));
  const merged = new Map<string, { name: string; category: string | null; inbound: number; outbound: number; changed: number }>();
  for (const row of input.ruleGroups) {
    const slot = merged.get(row.ruleId) ?? { name: row.ruleName ?? '(이름 없음)', category: row.category, inbound: 0, outbound: 0, changed: 0 };
    if (row.stage === 'INBOUND') slot.inbound += row.count;
    else slot.outbound += row.count;
    if (row.effect === 'CHANGED') slot.changed += row.count;
    merged.set(row.ruleId, slot);
  }
  const rules: Aggregate['rules'] = [...merged.entries()]
    .map(([ruleId, slot]) => {
      const current = currentById.get(ruleId);
      return {
        ruleId,
        ruleName: current?.name ?? slot.name,
        category: (current?.category ?? slot.category ?? null) as GuardrailCategory | null,
        currentAction: current?.action ?? null,
        currentEnabled: current?.enabled ?? null,
        deleted: !current,
        inboundHits: slot.inbound,
        outboundHits: slot.outbound,
        changedHits: slot.changed,
      };
    })
    .sort((a, b) => b.inboundHits + b.outboundHits - (a.inboundHits + a.outboundHits) || a.ruleName.localeCompare(b.ruleName));

  const pii: Aggregate['pii'] = PII_KINDS.flatMap((kind) => {
    const row = input.piiGroups.find((p) => p.piiKind === kind);
    return row ? [{ kind, answers: row.answers, count: row.count }] : [];
  });

  const fallbackOnError = Math.max(0, input.outboundStagedCount - outboundReplaced);
  const denominator = input.answeredByRagCount + outboundReplaced + fallbackOnError;

  return {
    totals: { inboundHits, outboundHits, replaced, noRag, monitored, maskedAnswers, errorFallbacks },
    rules,
    pii,
    rag: {
      delivered: input.answeredByRagCount,
      replaced: outboundReplaced,
      masked: maskedAnswers,
      fallbackOnError,
      replacedRatio: denominator === 0 ? null : outboundReplaced / denominator,
    },
  };
}
