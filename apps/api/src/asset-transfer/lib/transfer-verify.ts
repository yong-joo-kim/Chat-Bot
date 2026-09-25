import { collectUuidLeaves } from '../../dialogue-common/lib/asset-ref-graph';
import type { TransferPlan } from './transfer-plan';

export interface TransferViolation {
  rule: string;
  detail: string;
}

/**
 * 적재 전 최종 검증(topic-system-설계.md §9.5 ⑤, FR-0-135) — 위반이 1건이라도 있으면 적재하지 않는다.
 * ① 계획의 모든 JSON·컬럼에 원본 id 잔존 0 ② 조인·contextVariableId·노드 참조·설문 참조가 전부 계획
 * 안의 새 id ③ 새 id 중복 0 ④ 시스템 노드 topicId = null.
 */
export function verifyTransferPlan(plan: TransferPlan): TransferViolation[] {
  const violations: TransferViolation[] = [];

  // ③ 새 id 중복 0
  const allNewIds: string[] = [
    ...plan.topics.map((t) => t.id),
    ...plan.surveys.map((s) => s.id),
    ...plan.intents.map((i) => i.id),
    ...plan.keywords.map((k) => k.id),
    ...plan.homonyms.map((h) => h.id),
    ...plan.contexts.map((c) => c.id),
    ...plan.faqs.map((f) => f.id),
    ...plan.nodes.map((n) => n.id),
  ];
  const seen = new Set<string>();
  for (const id of allNewIds) {
    if (seen.has(id)) violations.push({ rule: 'DUPLICATE_NEW_ID', detail: id });
    seen.add(id);
  }

  const newIdSet = seen;

  // ① 원본 id 잔존 0 — JSON 필드(outputs·meanings·slots)를 스캔한다.
  const scanNoSourceLeak = (label: string, id: string, value: unknown): void => {
    for (const leaf of collectUuidLeaves(value)) {
      if (plan.sourceIdSet.has(leaf) && !newIdSet.has(leaf)) {
        violations.push({ rule: 'SOURCE_ID_LEAK', detail: `${label}(${id}): ${leaf}` });
      }
    }
  };
  for (const n of plan.nodes) scanNoSourceLeak('node.outputs', n.id, n.outputs);
  for (const h of plan.homonyms) scanNoSourceLeak('homonym.meanings', h.id, h.meanings);
  for (const c of plan.contexts) scanNoSourceLeak('context.slots', c.id, c.slots);

  // ② 컬럼 참조가 전부 계획 안의 새 id
  const nodeIds = new Set(plan.nodes.map((n) => n.id));
  const contextIds = new Set(plan.contexts.map((c) => c.id));
  for (const n of plan.nodes) {
    if (n.contextVariableId && !contextIds.has(n.contextVariableId)) {
      violations.push({ rule: 'DANGLING_CONTEXT_REF', detail: n.id });
    }
  }
  for (const pair of plan.nodeIntentPairs) {
    if (!nodeIds.has(pair.nodeId) || !plan.intents.some((i) => i.id === pair.intentId)) {
      violations.push({ rule: 'DANGLING_NODE_INTENT_PAIR', detail: `${pair.nodeId}::${pair.intentId}` });
    }
  }
  for (const pair of plan.nodeKeywordPairs) {
    if (!nodeIds.has(pair.nodeId) || !plan.keywords.some((k) => k.id === pair.keywordId)) {
      violations.push({ rule: 'DANGLING_NODE_KEYWORD_PAIR', detail: `${pair.nodeId}::${pair.keywordId}` });
    }
  }

  // ④ 시스템 노드 topicId = null
  for (const n of plan.nodes) {
    if ((n.nodeType === 'START' || n.nodeType === 'FALLBACK') && n.topicId !== null) {
      violations.push({ rule: 'SYSTEM_NODE_TOPIC_NOT_NULL', detail: n.id });
    }
  }

  return violations;
}
