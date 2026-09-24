import type { DesignIssue, DesignValidationReport, DialogNode, DialogueBundle } from '@chat-bot/shared-types';
import { UNSUPPORTED_OUTPUT_TYPES, isApiConditionV2 } from '@chat-bot/shared-types';

/**
 * 노드가 다른 노드를 가리키는 참조(이동/버튼/[No.26] API 분기) — 순환 검사·고아 노드 판정·
 * `incomingCount` 산출·삭제 409·스냅샷 무결성 4곳이 공용으로 쓴다(J-17, 규칙 1벌).
 * `apiTargets` = `API_CONDITION`(v1·v2 모두)의 `conditions[].nextNodeId` + (v2) `defaultNodeId`·`failureNodeId`.
 */
export function getOutgoingNodeRefs(node: DialogNode): { moveTargets: string[]; buttonTargets: string[]; apiTargets: string[] } {
  const moveTargets: string[] = [];
  const buttonTargets: string[] = [];
  const apiTargets: string[] = [];
  for (const output of node.outputs) {
    if (output.type === 'DIALOG_MOVE') moveTargets.push(output.payload.targetNodeId);
    if (output.type === 'BUTTON') {
      for (const b of output.payload.buttons) if (b.action === 'NODE') buttonTargets.push(b.value);
    }
    if (output.type === 'CARD' && output.payload.buttons) {
      for (const b of output.payload.buttons) if (b.action === 'NODE') buttonTargets.push(b.value);
    }
    if (output.type === 'API_CONDITION') {
      for (const c of output.payload.conditions) apiTargets.push(c.nextNodeId);
      if (isApiConditionV2(output.payload)) {
        if (output.payload.defaultNodeId) apiTargets.push(output.payload.defaultNodeId);
        if (output.payload.failureNodeId) apiTargets.push(output.payload.failureNodeId);
      }
    }
  }
  return { moveTargets, buttonTargets, apiTargets };
}

/** "이 노드로 들어오는 참조" 개수(FR-5-11 `incomingCount`, ORPHAN_NODE 판정 공용). API 분기 참조도 포함한다(AC-L1-8). */
export function computeIncomingCounts(nodes: DialogNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const { moveTargets, buttonTargets, apiTargets } = getOutgoingNodeRefs(node);
    for (const targetId of [...moveTargets, ...buttonTargets, ...apiTargets]) {
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

/** [No.26] 연결 카탈로그 조회 결과(엔진 순수성 유지 — `DialogNodesService.validate()`가 1회 조회해 주입, §5.9). */
export interface DesignValidationApiConnectionInfo {
  name: string;
  enabled: boolean;
  secretStatus: 'NOT_REQUIRED' | 'CONFIGURED' | 'MISSING';
  insecureHttp: boolean;
  personalDataLookup: boolean;
  allowRawPersonalData: boolean;
  allowedMethods: readonly string[];
}
export interface DesignValidationContext {
  apiConnections?: ReadonlyMap<string, DesignValidationApiConnectionInfo>;
}

const API_TOKEN_IN_URL_RE = /\{api\./;

/** [No.26] v2 `API_CONDITION` 설계 점검 10종(§5.9) — 컨텍스트가 없으면 연결 의존 항목(⑧~⑪)만 건너뛴다. */
function checkApiConditionIssues(nodes: DialogNode[], nodeMap: Map<string, DialogNode>, context: DesignValidationContext | undefined): DesignIssue[] {
  const issues: DesignIssue[] = [];

  for (const node of nodes) {
    const v2Outputs = node.outputs
      .map((o, index) => ({ o, index }))
      .filter((x) => x.o.type === 'API_CONDITION' && isApiConditionV2(x.o.payload));

    // ① 마지막 아웃풋이 아님
    for (const { index } of v2Outputs) {
      if (index !== node.outputs.length - 1) {
        issues.push({
          code: 'API_OUTPUT_NOT_LAST',
          severity: 'WARNING',
          resourceType: 'NODE',
          resourceId: node.id,
          resourceName: node.name,
          message: `노드 "${node.name}"의 API 조건분기 뒤에 아웃풋이 있습니다. 뒤 아웃풋은 실행되지 않습니다.`,
        });
      }
    }
    // ② 한 노드에 v2 2개 이상
    if (v2Outputs.length > 1) {
      issues.push({
        code: 'API_MULTIPLE_OUTPUTS',
        severity: 'ERROR',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"에 API 조건분기가 2개 이상 있습니다.`,
      });
    }
    // ④ v1 형식
    if (node.outputs.some((o) => o.type === 'API_CONDITION' && !isApiConditionV2(o.payload))) {
      issues.push({
        code: 'API_LEGACY_FORMAT',
        severity: 'WARNING',
        resourceType: 'NODE',
        resourceId: node.id,
        resourceName: node.name,
        message: `노드 "${node.name}"의 API 조건이 이전 형식입니다. 연결 방식으로 전환해야 실행됩니다.`,
      });
    }

    for (const { o } of v2Outputs) {
      if (o.type !== 'API_CONDITION' || !isApiConditionV2(o.payload)) continue;
      const payload = o.payload;

      // ③ 중첩 호출
      const branchTargets = [...payload.conditions.map((c) => c.nextNodeId), payload.defaultNodeId, payload.failureNodeId].filter(
        (id): id is string => !!id,
      );
      for (const targetId of branchTargets) {
        const target = nodeMap.get(targetId);
        if (target && target.outputs.some((to) => to.type === 'API_CONDITION' && isApiConditionV2(to.payload))) {
          issues.push({
            code: 'API_NESTED_CALL',
            severity: 'WARNING',
            resourceType: 'NODE',
            resourceId: node.id,
            resourceName: node.name,
            message: `노드 "${node.name}"의 API 분기 대상 노드 "${target.name}"도 API 조건분기를 가지고 있어 턴당 1회 제한으로 실패 처리됩니다.`,
          });
        }
      }

      // ⑤ SLOT 바인딩 도달 불가
      const slotBindings = [
        ...payload.pathParams,
        ...payload.query.map((q) => q.value),
        ...payload.body.map((b) => b.value),
      ].filter((b) => b.kind === 'SLOT');
      for (const binding of slotBindings) {
        if (binding.kind === 'SLOT' && binding.contextVariableId !== node.contextVariableId) {
          issues.push({
            code: 'API_SLOT_BINDING_UNREACHABLE',
            severity: 'WARNING',
            resourceType: 'NODE',
            resourceId: node.id,
            resourceName: node.name,
            message: `노드 "${node.name}"의 API 조건분기가 이 노드의 조건이 아닌 폼 슬롯을 참조합니다. 값이 비어 실패 처리될 수 있습니다.`,
          });
          break;
        }
      }

      // ⑥ 실패 분기 미지정
      if (!payload.failureNodeId) {
        issues.push({
          code: 'API_FAILURE_BRANCH_MISSING',
          severity: 'INFO',
          resourceType: 'NODE',
          resourceId: node.id,
          resourceName: node.name,
          message: `노드 "${node.name}"의 API 조건분기에 실패 시 이동할 노드가 지정되지 않았습니다. 고정 문구로 안내됩니다.`,
        });
      }

      // ⑧~⑪ 연결 의존 항목(컨텍스트 있을 때만)
      if (context?.apiConnections) {
        const conn = context.apiConnections.get(payload.connectionId);
        if (!conn) {
          issues.push({
            code: 'BROKEN_REFERENCE',
            severity: 'ERROR',
            resourceType: 'NODE',
            resourceId: node.id,
            resourceName: node.name,
            message: `노드 "${node.name}"이(가) 존재하지 않는 API 연결(${payload.connectionId})을 참조합니다.`,
          });
        } else {
          if (!conn.enabled || conn.secretStatus === 'MISSING' || !conn.allowedMethods.includes(payload.method)) {
            issues.push({
              code: 'API_CONNECTION_UNAVAILABLE',
              severity: 'WARNING',
              resourceType: 'NODE',
              resourceId: node.id,
              resourceName: node.name,
              message: `노드 "${node.name}"이(가) 참조하는 API 연결 "${conn.name}"을(를) 지금은 호출할 수 없습니다(사용 중지/시크릿 미설정/허용되지 않은 메서드).`,
            });
          }
          if (conn.insecureHttp) {
            issues.push({
              code: 'API_CONNECTION_INSECURE',
              severity: 'INFO',
              resourceType: 'NODE',
              resourceId: node.id,
              resourceName: node.name,
              message: `노드 "${node.name}"이(가) 참조하는 API 연결 "${conn.name}"은(는) http(비보안) 연결입니다.`,
            });
          }
          if (conn.personalDataLookup) {
            issues.push({
              code: 'API_PERSONAL_DATA_LOOKUP',
              severity: 'INFO',
              resourceType: 'NODE',
              resourceId: node.id,
              resourceName: node.name,
              message: `노드 "${node.name}"이(가) 참조하는 API 연결 "${conn.name}"은(는) 개인정보 조회형으로 표시되어 있습니다.`,
            });
          }
          if (conn.allowRawPersonalData) {
            issues.push({
              code: 'API_RAW_PERSONAL_DATA',
              severity: 'INFO',
              resourceType: 'NODE',
              resourceId: node.id,
              resourceName: node.name,
              message: `노드 "${node.name}"이(가) 참조하는 API 연결 "${conn.name}"은(는) 개인정보를 원문으로 송신합니다.`,
            });
          }
        }
      }
    }

    // ⑦ URL 필드에 {api.*} 토큰(치환되지 않는다)
    for (const output of node.outputs) {
      const urlFields: string[] = [];
      if (output.type === 'LINK') urlFields.push(output.payload.url);
      if (output.type === 'IMAGE') urlFields.push(output.payload.imageUrl);
      if (output.type === 'CARD' && output.payload.imageUrl) urlFields.push(output.payload.imageUrl);
      if (output.type === 'CARD' && output.payload.buttons) {
        for (const b of output.payload.buttons) if (b.action === 'LINK') urlFields.push(b.value);
      }
      if (output.type === 'BUTTON') {
        for (const b of output.payload.buttons) if (b.action === 'LINK') urlFields.push(b.value);
      }
      if (urlFields.some((v) => API_TOKEN_IN_URL_RE.test(v))) {
        issues.push({
          code: 'API_TOKEN_IN_URL_FIELD',
          severity: 'WARNING',
          resourceType: 'NODE',
          resourceId: node.id,
          resourceName: node.name,
          message: `노드 "${node.name}"의 URL 필드에 {api.*} 토큰이 있습니다. URL 필드는 치환되지 않습니다.`,
        });
        break;
      }
    }
  }

  return issues;
}

/**
 * 대화그래프 설계 점검(FR-5-16~18, DD-17). `ERROR`가 있어도 저장/상태전환을 막지 않는다(FR-5-17).
 * [No.26] `context`(선택)로 API 연결 의존 항목(§5.9 ⑧~⑪)을 함께 점검한다. 엔진 자체는 여전히
 * DB·Nest 무의존 순수 함수다 — 연결 데이터는 호출부(`DialogNodesService.validate()`)가 1회 조회해 넘긴다.
 */
export function validateDialogueDesign(
  bundle: DialogueBundle,
  now: Date = new Date(),
  context?: DesignValidationContext,
): DesignValidationReport {
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
    const { moveTargets, buttonTargets, apiTargets } = getOutgoingNodeRefs(node);
    for (const targetId of [...moveTargets, ...buttonTargets, ...apiTargets]) {
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

  // [No.26] API 조건분기 설계 점검 10종(§5.9)
  issues.push(...checkApiConditionIssues(nodes, nodeMap, context));

  const summary = {
    error: issues.filter((i) => i.severity === 'ERROR').length,
    warning: issues.filter((i) => i.severity === 'WARNING').length,
    info: issues.filter((i) => i.severity === 'INFO').length,
  };

  return { issues, summary, checkedAt: now };
}
