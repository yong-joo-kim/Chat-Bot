import { getOutgoingNodeRefs } from '@chat-bot/dialogue-engine';
import type { DialogNode, DialogOutput } from '@chat-bot/shared-types';
import { collectNodeTargetRefs } from './node-target-refs';

/**
 * K-2 동등성 시험(topic-system-설계.md §13) — 저장 검증의 노드 참조 수집(`collectNodeTargetRefs`)과
 * 엔진의 `getOutgoingNodeRefs()`가 **같은 id 집합**을 낸다는 것을 모든 아웃풋 유형(v1·v2 포함)
 * 픽스처로 고정한다. 새 참조 종류를 한쪽에만 추가하면 이 시험이 실패한다.
 */
function buildNode(outputs: DialogOutput[]): DialogNode {
  return {
    id: 'node-under-test',
    chatbotId: 'c1',
    name: '검사노드',
    nodeType: 'NORMAL',
    matchMode: 'ANY',
    enabled: true,
    priority: 100,
    intentIds: [],
    keywordIds: [],
    outputs,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function engineTargetIdSet(node: DialogNode): Set<string> {
  const { moveTargets, buttonTargets, apiTargets, surveyTargets } = getOutgoingNodeRefs(node);
  return new Set([...moveTargets, ...buttonTargets, ...apiTargets, ...surveyTargets]);
}

function collectTargetIdSet(outputs: DialogOutput[]): Set<string> {
  return new Set(collectNodeTargetRefs(outputs).map((r) => r.id));
}

const ALL_OUTPUT_FIXTURES: Array<{ label: string; outputs: DialogOutput[] }> = [
  { label: 'DIALOG_MOVE', outputs: [{ type: 'DIALOG_MOVE', payload: { targetNodeId: '11111111-1111-1111-1111-111111111111' } }] },
  {
    label: 'BUTTON(다중 액션 혼합)',
    outputs: [
      {
        type: 'BUTTON',
        payload: {
          text: '메뉴',
          buttons: [
            { label: '이동', action: 'NODE', value: '22222222-2222-2222-2222-222222222222' },
            { label: '링크', action: 'LINK', value: 'https://example.com' },
            { label: '메시지', action: 'MESSAGE', value: '안녕' },
          ],
        },
      },
    ],
  },
  {
    label: 'CARD(버튼 포함)',
    outputs: [
      {
        type: 'CARD',
        payload: {
          title: '카드',
          buttons: [{ label: '이동', action: 'NODE', value: '33333333-3333-3333-3333-333333333333' }],
        },
      },
    ],
  },
  {
    label: 'API_CONDITION v1',
    outputs: [
      {
        type: 'API_CONDITION',
        payload: {
          method: 'GET',
          url: 'https://api.example.com',
          conditions: [{ path: 'result', operator: 'EQ', value: 'ok', nextNodeId: '44444444-4444-4444-4444-444444444444' }],
        },
      },
    ],
  },
  {
    label: 'API_CONDITION v2(default·failure 포함)',
    outputs: [
      {
        type: 'API_CONDITION',
        payload: {
          version: 2,
          connectionId: '55555555-5555-5555-5555-555555555555',
          method: 'GET',
          path: '/orders',
          pathParams: [],
          query: [],
          body: [],
          responseMappings: [],
          conditions: [{ path: '$.result', operator: 'EQ', value: 'ok', nextNodeId: '66666666-6666-6666-6666-666666666666' }],
          defaultNodeId: '77777777-7777-7777-7777-777777777777',
          failureNodeId: '88888888-8888-8888-8888-888888888888',
        },
      },
    ],
  },
  {
    label: 'SURVEY v1(참조 없음 — 자유 문자열 키)',
    outputs: [{ type: 'SURVEY', payload: { surveyId: 'legacy-key' } }],
  },
  {
    label: 'SURVEY v2(onCompleteNodeId 포함)',
    outputs: [
      {
        type: 'SURVEY',
        payload: { version: 2, surveyId: '99999999-9999-9999-9999-999999999999', onCompleteNodeId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      },
    ],
  },
];

describe('K-2: collectNodeTargetRefs ↔ getOutgoingNodeRefs 동등성', () => {
  it.each(ALL_OUTPUT_FIXTURES.map((f) => [f.label, f.outputs] as const))('%s — 두 목록의 id 집합이 일치한다', (_label, outputs) => {
    const node = buildNode(outputs);
    const engineSet = engineTargetIdSet(node);
    const collectedSet = collectTargetIdSet(outputs);
    expect([...collectedSet].sort()).toEqual([...engineSet].sort());
  });

  it('전 유형을 한 노드에 합쳐도 일치한다', () => {
    const outputs = ALL_OUTPUT_FIXTURES.flatMap((f) => f.outputs);
    const node = buildNode(outputs);
    expect([...collectTargetIdSet(outputs)].sort()).toEqual([...engineTargetIdSet(node)].sort());
  });

  it('빈 아웃풋은 양쪽 다 빈 집합이다', () => {
    const node = buildNode([]);
    expect(collectTargetIdSet([])).toEqual(new Set());
    expect(engineTargetIdSet(node)).toEqual(new Set());
  });
});
