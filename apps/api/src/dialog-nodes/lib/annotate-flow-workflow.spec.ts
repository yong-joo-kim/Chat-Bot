import type { DialogNode, FlowTree } from '@chat-bot/shared-types';
import { annotateFlowTreeWorkflowOutputs } from './annotate-flow-workflow';

function makeNode(id: string, hasWorkflow: boolean): DialogNode {
  return {
    id,
    chatbotId: 'chatbot-1',
    name: id,
    nodeType: 'NORMAL',
    matchMode: 'ANY',
    enabled: true,
    priority: 100,
    intentIds: [],
    keywordIds: [],
    outputs: hasWorkflow ? [{ type: 'WORKFLOW', payload: { version: 1, targetId: 'target-1', actionKey: 'a', fields: [] } }] : [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as DialogNode;
}

describe('annotateFlowTreeWorkflowOutputs — 흐름 미리보기 WORKFLOW 표시(FR-5-19 후처리)', () => {
  it('WORKFLOW 아웃풋이 없는 챗봇은 트리를 그대로(참조 동일) 반환한다(바이트 동일 보장)', () => {
    const tree: FlowTree = { roots: [{ nodeId: 'n1', name: 'n1', nodeType: 'NORMAL', via: 'ROOT', repeated: false, children: [] }], orphanNodes: [] };
    const result = annotateFlowTreeWorkflowOutputs(tree, [makeNode('n1', false)]);
    expect(result).toBe(tree);
    expect('hasWorkflowOutput' in result.roots[0]).toBe(false);
  });

  it('WORKFLOW 아웃풋을 가진 노드에만 hasWorkflowOutput: true를 얹는다(중첩 포함)', () => {
    const tree: FlowTree = {
      roots: [
        {
          nodeId: 'root',
          name: 'root',
          nodeType: 'NORMAL',
          via: 'ROOT',
          repeated: false,
          children: [{ nodeId: 'child-wf', name: 'child-wf', nodeType: 'NORMAL', via: 'DIALOG_MOVE', repeated: false, children: [] }],
        },
      ],
      orphanNodes: [],
    };
    const result = annotateFlowTreeWorkflowOutputs(tree, [makeNode('root', false), makeNode('child-wf', true)]);

    expect('hasWorkflowOutput' in result.roots[0]).toBe(false);
    expect(result.roots[0].children[0].hasWorkflowOutput).toBe(true);
  });

  it('역검증 — 워크플로 노드가 있는데도 주석이 없는 픽스처는 실제로 실패로 잡힌다', () => {
    const tree: FlowTree = { roots: [{ nodeId: 'n1', name: 'n1', nodeType: 'NORMAL', via: 'ROOT', repeated: false, children: [] }], orphanNodes: [] };
    const uncorrected = tree; // 후처리를 호출하지 않은 픽스처
    expect('hasWorkflowOutput' in uncorrected.roots[0]).toBe(false);
    const corrected = annotateFlowTreeWorkflowOutputs(tree, [makeNode('n1', true)]);
    expect(corrected.roots[0].hasWorkflowOutput).toBe(true);
  });
});
