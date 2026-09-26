import type { DialogNode, FlowNode, FlowTree } from '@chat-bot/shared-types';

/**
 * [신규 No.41 — 프런트엔드 계약 보강, 코드 리뷰 R1 후속] 흐름 미리보기(FR-5-19)에 WORKFLOW 아웃풋
 * 표시(🔗 아이콘, WF5)를 얹는다. **엔진(`buildFlowTree`)은 건드리지 않는다** — No.41 엔진 변경
 * 닫힌 목록(§5.1) 밖이기 때문이다. 이 파일은 엔진이 만든 트리를 순수 후처리로 주석만 붙인다.
 * 워크플로 아웃풋을 가진 노드가 하나도 없으면 원본 트리를 그대로 반환한다(바이트 동일 — FR-0-172급 보장).
 */
export function annotateFlowTreeWorkflowOutputs(tree: FlowTree, dialogNodes: readonly DialogNode[]): FlowTree {
  const workflowNodeIds = new Set(dialogNodes.filter((n) => n.outputs.some((o) => o.type === 'WORKFLOW')).map((n) => n.id));
  if (workflowNodeIds.size === 0) return tree;
  return { ...tree, roots: tree.roots.map((root) => annotateNode(root, workflowNodeIds)) };
}

function annotateNode(node: FlowNode, workflowNodeIds: ReadonlySet<string>): FlowNode {
  const children = node.children.map((child) => annotateNode(child, workflowNodeIds));
  if (workflowNodeIds.has(node.nodeId)) {
    return { ...node, children, hasWorkflowOutput: true };
  }
  return { ...node, children };
}
