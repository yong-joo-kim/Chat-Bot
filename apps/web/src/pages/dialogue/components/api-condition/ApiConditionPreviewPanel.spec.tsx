import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiConditionOutputPayloadV2, DialogNode } from '@chat-bot/shared-types';
import { ApiConditionPreviewPanel } from './ApiConditionPreviewPanel';

const mockSamples = vi.fn();
const mockFindOne = vi.fn();

vi.mock('../../../../api/apiConnections', () => ({
  apiConnectionsApi: { samples: (...args: unknown[]) => mockSamples(...args) },
}));
vi.mock('../../../../api/dialogue', () => ({
  dialogNodesApi: { findOne: (...args: unknown[]) => mockFindOne(...args) },
}));

function basePayload(overrides: Partial<ApiConditionOutputPayloadV2> = {}): ApiConditionOutputPayloadV2 {
  return {
    version: 2,
    connectionId: '11111111-1111-1111-1111-111111111111',
    method: 'GET',
    path: '/orders',
    pathParams: [],
    query: [],
    body: [],
    responseMappings: [{ name: 'status', path: 'data.status', required: false, maxLength: 200 }],
    conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: '22222222-2222-2222-2222-222222222222' }],
    ...overrides,
  };
}

function makeNode(overrides: Partial<DialogNode> = {}): DialogNode {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    chatbotId: 'bot-1',
    name: '배송중안내',
    nodeType: 'NORMAL',
    matchMode: 'ANY',
    enabled: true,
    priority: 100,
    intentIds: [],
    keywordIds: [],
    outputs: [{ type: 'TEXT', payload: { text: '주문하신 상품은 {api.status} 상태입니다.' } }],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  } as DialogNode;
}

/**
 * [No.26 1차 코드리뷰 반영] "치환 미리보기"(설계 §3.4) — 선택된 분기 노드의 첫 TEXT 아웃풋에
 * `renderApiTokens()`를 적용한 결과를 보여준다(엔진 `outputs.ts`와 동일 함수).
 */
describe('ApiConditionPreviewPanel — 치환 미리보기', () => {
  beforeEach(() => {
    mockSamples.mockReset();
    mockFindOne.mockReset();
    mockSamples.mockResolvedValue({ items: [{ label: '배송중', httpStatus: 200, body: { data: { status: 'SHIPPED' } } }] });
  });

  it('일치한 조건의 nextNodeId 노드를 조회해 첫 TEXT 아웃풋에 {api.*} 치환을 적용해 보여준다', async () => {
    mockFindOne.mockResolvedValue(makeNode());
    const user = userEvent.setup();

    render(<ApiConditionPreviewPanel payload={basePayload()} chatbotId="bot-1" />);
    await screen.findByLabelText('샘플');
    await user.click(screen.getByRole('button', { name: '미리보기' }));

    expect(await screen.findByText('"주문하신 상품은 SHIPPED 상태입니다."')).toBeInTheDocument();
    expect(mockFindOne).toHaveBeenCalledWith('bot-1', '22222222-2222-2222-2222-222222222222');
  });

  it('일치하는 조건이 없고 defaultNodeId도 없으면 "지정된 분기 노드가 없어…" 안내로 생략한다', async () => {
    const user = userEvent.setup();
    render(
      <ApiConditionPreviewPanel
        payload={basePayload({ conditions: [{ path: 'data.status', operator: 'EQ', value: 'NOPE', nextNodeId: '22222222-2222-2222-2222-222222222222' }] })}
        chatbotId="bot-1"
      />,
    );
    await screen.findByLabelText('샘플');
    await user.click(screen.getByRole('button', { name: '미리보기' }));

    expect(await screen.findByText('지정된 분기 노드가 없어 치환 미리보기를 생략합니다.')).toBeInTheDocument();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it('대상 노드에 TEXT 아웃풋이 없으면 안내 문구를 보여준다', async () => {
    mockFindOne.mockResolvedValue(makeNode({ outputs: [{ type: 'PAUSE', payload: { durationMs: 1000 } }] }));
    const user = userEvent.setup();

    render(<ApiConditionPreviewPanel payload={basePayload()} chatbotId="bot-1" />);
    await screen.findByLabelText('샘플');
    await user.click(screen.getByRole('button', { name: '미리보기' }));

    expect(await screen.findByText('대상 노드에 텍스트 아웃풋이 없습니다.')).toBeInTheDocument();
  });
});
