import { buildFlowTree } from './flow-tree';
import { makeBundle, makeNode, moveOutput, textOutput } from './test-fixtures';

describe('buildFlowTree — FR-5-19', () => {
  it('AC-5-14: START 노드를 루트로 트리를 구성하고 반복 경로는 repeated로 접는다', () => {
    const start = makeNode({ id: 'start', name: '시작', nodeType: 'START', outputs: [moveOutput('mid')] });
    const mid = makeNode({ id: 'mid', name: '중간', outputs: [moveOutput('start')] });
    const bundle = makeBundle({ dialogNodes: [start, mid] });

    const tree = buildFlowTree(bundle);

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0].nodeId).toBe('start');
    expect(tree.roots[0].children[0].nodeId).toBe('mid');
    expect(tree.roots[0].children[0].children[0].repeated).toBe(true);
  });

  it('어떤 루트에서도 도달하지 않는 노드는 orphanNodes로 반환한다', () => {
    const start = makeNode({ id: 'start', nodeType: 'START', outputs: [textOutput('hi')] });
    const orphan = makeNode({ id: 'orphan', name: '고아' });
    const bundle = makeBundle({ dialogNodes: [start, orphan] });

    const tree = buildFlowTree(bundle);
    expect(tree.orphanNodes.map((n) => n.id)).toContain('orphan');
  });
});
