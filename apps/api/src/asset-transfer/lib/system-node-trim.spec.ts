import { trimSystemNodeOutputs } from './system-node-trim';
import type { DialogNode, DialogOutput } from '@chat-bot/shared-types';

function buildNode(outputs: DialogOutput[]): DialogNode {
  return {
    id: 'system-node',
    chatbotId: 'c1',
    name: '시작',
    nodeType: 'START',
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

const KEEP_ID = '11111111-1111-1111-1111-111111111111';
const TRIM_ID = '22222222-2222-2222-2222-222222222222';

describe('trimSystemNodeOutputs — topic-system-설계.md §9.3 (M-2 코드리뷰 대응)', () => {
  it('DIALOG_MOVE가 keep 대상이 아니면 잘라내고 edge=NODE_MOVE·reason 없음으로 보고한다', () => {
    const node = buildNode([{ type: 'DIALOG_MOVE', payload: { targetNodeId: TRIM_ID } }, { type: 'TEXT', payload: { text: '안내' } }]);
    const result = trimSystemNodeOutputs(node, new Set([KEEP_ID]));
    expect(result.trimmedLinks).toEqual([{ edge: 'NODE_MOVE', targetNodeId: TRIM_ID }]);
    expect(result.followedLinks).toEqual([]);
    expect(result.outputs).toEqual([{ type: 'TEXT', payload: { text: '안내' } }]);
  });

  it('BUTTON의 NODE 액션이 keep 대상이 아니면 그 버튼만 잘라내고 edge=NODE_BUTTON으로 보고한다', () => {
    const node = buildNode([
      { type: 'BUTTON', payload: { buttons: [{ label: '유지', action: 'NODE', value: KEEP_ID }, { label: '제거', action: 'NODE', value: TRIM_ID }] } },
    ]);
    const result = trimSystemNodeOutputs(node, new Set([KEEP_ID]));
    expect(result.trimmedLinks).toEqual([{ edge: 'NODE_BUTTON', targetNodeId: TRIM_ID }]);
    expect(result.outputs).toEqual([{ type: 'BUTTON', payload: { buttons: [{ label: '유지', action: 'NODE', value: KEEP_ID }] } }]);
  });

  it('API_CONDITION 대상은 잘라내지 않고 edge=NODE_API_BRANCH·reason 없음으로 따라간다', () => {
    const node = buildNode([
      {
        type: 'API_CONDITION',
        payload: { method: 'GET', url: 'https://example.com', conditions: [{ path: 'ok', operator: 'EQ', value: '1', nextNodeId: TRIM_ID }] },
      },
    ]);
    const result = trimSystemNodeOutputs(node, new Set([KEEP_ID]));
    expect(result.trimmedLinks).toEqual([]);
    expect(result.followedLinks).toEqual([{ edge: 'NODE_API_BRANCH', targetNodeId: TRIM_ID }]);
    expect(result.followedLinks[0].reason).toBeUndefined();
  });

  describe('TRIM_WOULD_EMPTY 보정(잘라낸 결과 아웃풋이 0개가 되는 경우)', () => {
    it('DIALOG_MOVE 단일 아웃풋 — 원본을 그대로 두고 edge=NODE_MOVE·reason=TRIM_WOULD_EMPTY로 보고한다(하드코딩된 NODE_API_BRANCH 오분류 수정)', () => {
      const node = buildNode([{ type: 'DIALOG_MOVE', payload: { targetNodeId: TRIM_ID } }]);
      const result = trimSystemNodeOutputs(node, new Set([KEEP_ID]));
      expect(result.trimmedLinks).toEqual([]);
      expect(result.outputs).toBe(node.outputs);
      expect(result.followedLinks).toEqual([{ edge: 'NODE_MOVE', targetNodeId: TRIM_ID, reason: 'TRIM_WOULD_EMPTY' }]);
    });

    it('BUTTON 단일 아웃풋(text 없음, 버튼 전부 제거 대상) — edge=NODE_BUTTON·reason=TRIM_WOULD_EMPTY로 버튼별 보고한다', () => {
      const trim2 = '33333333-3333-3333-3333-333333333333';
      const node = buildNode([
        { type: 'BUTTON', payload: { buttons: [{ label: '제거1', action: 'NODE', value: TRIM_ID }, { label: '제거2', action: 'NODE', value: trim2 }] } },
      ]);
      const result = trimSystemNodeOutputs(node, new Set([KEEP_ID]));
      expect(result.outputs).toBe(node.outputs);
      expect(result.followedLinks).toEqual([
        { edge: 'NODE_BUTTON', targetNodeId: TRIM_ID, reason: 'TRIM_WOULD_EMPTY' },
        { edge: 'NODE_BUTTON', targetNodeId: trim2, reason: 'TRIM_WOULD_EMPTY' },
      ]);
    });

    it('DIALOG_MOVE + BUTTON이 섞여 있고 둘 다 트림 대상이면 각각의 실제 edge로 보고한다', () => {
      const node = buildNode([
        { type: 'DIALOG_MOVE', payload: { targetNodeId: TRIM_ID } },
        { type: 'BUTTON', payload: { buttons: [{ label: '제거', action: 'NODE', value: TRIM_ID }] } },
      ]);
      const result = trimSystemNodeOutputs(node, new Set([KEEP_ID]));
      expect(result.followedLinks).toEqual([
        { edge: 'NODE_MOVE', targetNodeId: TRIM_ID, reason: 'TRIM_WOULD_EMPTY' },
        { edge: 'NODE_BUTTON', targetNodeId: TRIM_ID, reason: 'TRIM_WOULD_EMPTY' },
      ]);
    });
  });
});
