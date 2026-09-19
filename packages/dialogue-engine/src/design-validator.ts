import type { DesignIssue, DesignValidationReport, DialogNode, DialogueBundle } from '@chat-bot/shared-types';
import { UNSUPPORTED_OUTPUT_TYPES } from '@chat-bot/shared-types';

/** 노드가 다른 노드를 가리키는 참조(이동/버튼) — 순환 검사·고아 노드 판정·`incomingCount` 산출에 공용으로 쓰인다. */
export function getOutgoingNodeRefs(node: DialogNode): { moveTargets: string[]; buttonTargets: string[] } {
  const moveTargets: string[] = [];
  const buttonTargets: string[] = [];
  for (const output of node.outputs) {
    if (output.type === 'DIALOG_MOVE') moveTargets.push(output.payload.targetNodeId);
    if (output.type === 'BUTTON') {
      for (const b of output.payload.buttons) if (b.action === 'NODE') buttonTargets.push(b.value);
    }
    if (output.type === 'CARD' && output.payload.buttons) {
      for (const b of output.payload.buttons) if (b.action === 'NODE') buttonTargets.push(b.value);
    }
  }
  return { moveTargets, buttonTargets };
}

/** "이 노드로 들어오는 참조" 개수(FR-5-11 `incomingCount`, ORPHAN_NODE 판정 공용). */
export function computeIncomingCounts(nodes: DialogNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const { moveTargets, buttonTargets } = getOutgoingNodeRefs(node);
    for (const targetId of [...moveTargets, ...buttonTargets]) {
      counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
    }
  }
  return counts;
}

/** `DIALOG_MOVE`만으로 구성된 방향 그래프에서 DFS로 사이클을 찾는다(FR-5-18). */
function findMoveCycles(nodes: DialogNode[]): string[][] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(
      node.id,
      node.outputs.filter((o) => o.type === 'DIALOG_MOVE').map((o) => o.payload.targetNodeId),
    );
  }

  const state = new Map<string, 'WHITE' | 'GRAY' | 'BLACK'>();
  nodes.forEach((n) => state.set(n.id, 'WHITE'));
  const cycles: string[][] = [];
  const seenCycleKeys = new Set<string>();
  const stack: string[] = [];

  function dfs(nodeId: string): void {
    state.set(nodeId, 'GRAY');
    stack.push(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (!nodeMap.has(next)) continue; // 끊어진 참조는 BROKEN_REFERENCE가 별도로 보고한다
      const nextState = state.get(next);
      if (nextState === 'GRAY') {
        const idx = stack.indexOf(next);
        const cyclePath = [...stack.slice(idx), next];
        const key = [...new Set(cyclePath)].sort().join('|');
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key);
          cycles.push(cyclePath.map((id) => nodeMap.get(id)?.name ?? id));
        }
      } else if (nextState === 'WHITE') {
        dfs(next);
      }
    }
    stack.pop();
    state.set(nodeId, 'BLACK');
  }

  for (const node of nodes) {
    if (state.get(node.id) === 'WHITE') dfs(node.id);
  }
  return cycles;
}

function conditionSignature(node: DialogNode): string {
  const intents = [...node.intentIds].sort().join(',');
  const keywords = [...node.keywordIds].sort().join(',');
  return `${intents}|${keywords}|${node.contextVariableId ?? ''}|${node.matchMode}`;
}

/**
 * 대화그래프 설계 점검(FR-5-16~18, DD-17). `ERROR`가 있어도 저장/상태전환을 막지 않는다(FR-5-17).
 */
export function validateDialogueDesign(bundle: DialogueBundle, now: Date = new Date()): DesignValidationReport {
  const issues: DesignIssue[] = [];
  const nodes = bundle.dialogNodes;
  const incomingCounts = computeIncomingCounts(nodes);
  const intentMap = new Map(bundle.intents.map((i) => [i.id, i]));
  const keywordMap = new Map(bundle.keywords.map((k) => [k.id, k]));
  const contextMap = new Map(bundle.contexts.map((c) => [c.id, c]));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  for (const node of nodes) {
    // ① 아웃풋이 빈 노드
    if (node.outputs.length === 0) {
      issues.push({
        code: 'EMPTY_OUTPUT',
        severity: 'WARNING',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"에 아웃풋이 없습니다.`,
      });
    }

    // ② 끊어진 참조
    for (const intentId of node.intentIds) {
      if (!intentMap.has(intentId)) {
        issues.push({
          code: 'BROKEN_REFERENCE',
          severity: 'ERROR',
          resourceType: 'NODE',
          resourceId: node.id,
          resourceName: node.name,
          message: `노드 "${node.name}"이(가) 존재하지 않는 의도(${intentId})를 참조합니다.`,
        });
      }
    }
    for (const keywordId of node.keywordIds) {
      if (!keywordMap.has(keywordId)) {
        issues.push({
          code: 'BROKEN_REFERENCE',
          severity: 'ERROR',
          resourceType: 'NODE',
          resourceId: node.id,
          resourceName: node.name,
          message: `노드 "${node.name}"이(가) 존재하지 않는 키워드(${keywordId})를 참조합니다.`,
        });
      }
    }
    if (node.contextVariableId && !contextMap.has(node.contextVariableId)) {
      issues.push({
        code: 'BROKEN_REFERENCE',
        severity: 'ERROR',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"이(가) 존재하지 않는 컨텍스트(${node.contextVariableId})를 참조합니다.`,
      });
    }
    const { moveTargets, buttonTargets } = getOutgoingNodeRefs(node);
    for (const targetId of [...moveTargets, ...buttonTargets]) {
      if (!nodeMap.has(targetId)) {
        issues.push({
          code: 'BROKEN_REFERENCE',
          severity: 'ERROR',
          resourceType: 'NODE',
          resourceId: node.id,
          resourceName: node.name,
          message: `노드 "${node.name}"이(가) 존재하지 않는 이동 대상 노드(${targetId})를 참조합니다.`,
        });
      }
    }
    for (const output of node.outputs) {
      if (output.type === 'CONTEXT_FORM' && !contextMap.has(output.payload.contextVariableId)) {
        issues.push({
          code: 'BROKEN_REFERENCE',
          severity: 'ERROR',
          resourceType: 'NODE',
          resourceId: node.id,
          resourceName: node.name,
          message: `노드 "${node.name}"의 CONTEXT_FORM 아웃풋이 존재하지 않는 컨텍스트를 참조합니다.`,
        });
      }
    }

    // ⑤ 고아 노드
    const conditionCount = node.intentIds.length + node.keywordIds.length + (node.contextVariableId ? 1 : 0);
    if (node.nodeType === 'NORMAL' && conditionCount === 0 && (incomingCounts.get(node.id) ?? 0) === 0) {
      issues.push({
        code: 'ORPHAN_NODE',
        severity: 'INFO',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"은(는) 어떤 조건에도 걸리지 않고 다른 노드에서도 참조되지 않습니다.`,
      });
    }

    // ⑧ 실행 미지원 아웃풋
    const unsupportedTypes = node.outputs
      .map((o) => o.type)
      .filter((t): t is (typeof UNSUPPORTED_OUTPUT_TYPES)[number] => (UNSUPPORTED_OUTPUT_TYPES as readonly string[]).includes(t));
    if (unsupportedTypes.length > 0) {
      issues.push({
        code: 'UNSUPPORTED_OUTPUT',
        severity: 'INFO',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"이(가) 이번 버전에서 실행되지 않는 아웃풋(${[...new Set(unsupportedTypes)].join(', ')})을 포함합니다.`,
      });
    }
  }

  // ③ 순환 이동 경로
  for (const cyclePath of findMoveCycles(nodes)) {
    issues.push({
      code: 'MOVE_CYCLE',
      severity: 'WARNING',
      resourceType: 'NODE',
      resourceId: undefined,
      path: cyclePath,
      message: `순환 이동 경로가 발견됐습니다: ${cyclePath.join(' → ')}`,
    });
  }

  // ④ 중복 조건 노드
  const bySignature = new Map<string, DialogNode[]>();
  for (const node of nodes) {
    if (node.intentIds.length + node.keywordIds.length + (node.contextVariableId ? 1 : 0) === 0) continue;
    const sig = conditionSignature(node);
    const list = bySignature.get(sig);
    if (list) list.push(node);
    else bySignature.set(sig, [node]);
  }
  for (const group of bySignature.values()) {
    if (group.length < 2) continue;
    for (const node of group) {
      const others = group.filter((n) => n.id !== node.id).map((n) => n.name);
      issues.push({
        code: 'DUPLICATE_CONDITION',
        severity: 'WARNING',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"과(와) 동일한 조건을 가진 노드가 있습니다: ${others.join(', ')}.`,
      });
    }
  }

  // ⑥ FALLBACK 노드 부재
  if (!nodes.some((n) => n.nodeType === 'FALLBACK')) {
    issues.push({
      code: 'NO_FALLBACK_NODE',
      severity: 'INFO',
      resourceType: 'CHATBOT',
      message: '폴백(FALLBACK) 노드가 없습니다. 매칭 실패 시 시스템 기본 문구로 응답합니다.',
    });
  }

  // ⑦ 예문이 0개인 의도를 조건으로 쓰는 노드
  const emptyExampleIntentIds = new Set<string>();
  for (const node of nodes) {
    for (const intentId of node.intentIds) {
      const intent = intentMap.get(intentId);
      if (intent && intent.examples.length === 0) emptyExampleIntentIds.add(intentId);
    }
  }
  for (const intentId of emptyExampleIntentIds) {
    const intent = intentMap.get(intentId);
    issues.push({
      code: 'EMPTY_EXAMPLE_INTENT',
      severity: 'WARNING',
      resourceType: 'INTENT',
      resourceId: intentId,
      resourceName: intent?.name,
      message: `의도 "${intent?.name ?? intentId}"는 예문이 0개라 영원히 매칭되지 않습니다.`,
    });
  }

  const summary = {
    error: issues.filter((i) => i.severity === 'ERROR').length,
    warning: issues.filter((i) => i.severity === 'WARNING').length,
    info: issues.filter((i) => i.severity === 'INFO').length,
  };

  return { issues, summary, checkedAt: now };
}
