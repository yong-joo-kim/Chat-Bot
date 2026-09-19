import { validateDialogueDesign } from './design-validator';
import { makeBundle, makeIntent, makeNode, moveOutput, textOutput } from './test-fixtures';

const NOW = new Date('2026-01-01T00:00:00Z');

describe('validateDialogueDesign — FR-5-16~18', () => {
  it('AC-5-9: A→B→A 순환 이동을 WARNING으로 검출한다', () => {
    const nodeA = makeNode({ id: 'node-a', name: 'A', outputs: [moveOutput('node-b')] });
    const nodeB = makeNode({ id: 'node-b', name: 'B', outputs: [moveOutput('node-a')] });
    const bundle = makeBundle({ dialogNodes: [nodeA, nodeB] });

    const report = validateDialogueDesign(bundle, NOW);
    const cycle = report.issues.find((i) => i.code === 'MOVE_CYCLE');

    expect(cycle?.severity).toBe('WARNING');
    expect(cycle?.path?.join('→')).toContain('A→B→A');
  });

  it('AC-5-10: 아웃풋이 빈 노드(WARNING)와 끊어진 참조(ERROR)를 함께 리포트한다', () => {
    const emptyNode = makeNode({ name: '빈노드', enabled: false, outputs: [] });
    const brokenNode = makeNode({ name: '손상노드', intentIds: ['missing-intent'] });
    const bundle = makeBundle({ dialogNodes: [emptyNode, brokenNode] });

    const report = validateDialogueDesign(bundle, NOW);

    expect(report.issues.some((i) => i.code === 'EMPTY_OUTPUT' && i.severity === 'WARNING')).toBe(true);
    expect(report.issues.some((i) => i.code === 'BROKEN_REFERENCE' && i.severity === 'ERROR')).toBe(true);
  });

  it('EX-D-5: 예문이 0개인 의도를 조건으로 쓰는 노드는 WARNING이다', () => {
    const emptyIntent = makeIntent({ name: '빈의도', examples: [] });
    const node = makeNode({ intentIds: [emptyIntent.id] });
    const bundle = makeBundle({ intents: [emptyIntent], dialogNodes: [node] });

    const report = validateDialogueDesign(bundle, NOW);
    expect(report.issues.some((i) => i.code === 'EMPTY_EXAMPLE_INTENT')).toBe(true);
  });

  it('EX-D-4: FALLBACK 노드가 없으면 INFO로 안내한다', () => {
    const bundle = makeBundle({ dialogNodes: [makeNode({ outputs: [textOutput('x')] })] });
    const report = validateDialogueDesign(bundle, NOW);
    expect(report.issues.some((i) => i.code === 'NO_FALLBACK_NODE' && i.severity === 'INFO')).toBe(true);
  });
});
