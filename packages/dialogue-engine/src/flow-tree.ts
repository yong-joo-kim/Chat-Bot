import type { DialogNode, DialogueBundle, FlowNode, FlowTree } from '@chat-bot/shared-types';
import { getOutgoingNodeRefs } from './design-validator';
import { rankNodes } from './node-matcher';

/**
 * 읽기전용 흐름 요약 트리(FR-5-19). `START` 노드(없으면 `priority` 최상위)를 루트로
 * `DIALOG_MOVE`/버튼 `NODE` 액션을 따라 DFS로 펼친다. 재방문 노드는 `repeated: true`로 접는다.
 */
export function buildFlowTree(bundle: DialogueBundle): FlowTree {
  const nodes = bundle.dialogNodes;
  if (nodes.length === 0) return { roots: [], orphanNodes: [] };

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const rootNode = nodes.find((n) => n.nodeType === 'START') ?? rankNodes(nodes)[0];
  const visitedGlobal = new Set<string>();

  function buildNode(node: DialogNode, via: FlowNode['via'], ancestry: Set<string>): FlowNode {
    visitedGlobal.add(node.id);
    if (ancestry.has(node.id)) {
      return { nodeId: node.id, name: node.name, nodeType: node.nodeType, via, repeated: true, children: [] };
    }
    const nextAncestry = new Set(ancestry);
    nextAncestry.add(node.id);

    const { moveTargets, buttonTargets } = getOutgoingNodeRefs(node);
    const children: FlowNode[] = [];
    for (const targetId of moveTargets) {
      const target = nodeMap.get(targetId);
      if (target) children.push(buildNode(target, 'DIALOG_MOVE', nextAncestry));
    }
    for (const targetId of buttonTargets) {
      const target = nodeMap.get(targetId);
      if (target) children.push(buildNode(target, 'BUTTON_NODE', nextAncestry));
    }

    return { nodeId: node.id, name: node.name, nodeType: node.nodeType, via, repeated: false, children };
  }

  const roots: FlowNode[] = rootNode ? [buildNode(rootNode, 'ROOT', new Set())] : [];
  const orphanNodes = nodes.filter((n) => !visitedGlobal.has(n.id)).map((n) => ({ id: n.id, name: n.name }));

  return { roots, orphanNodes };
}
