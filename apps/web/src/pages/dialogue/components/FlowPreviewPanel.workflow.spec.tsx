import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FlowTree } from '@chat-bot/shared-types';
import { FlowPreviewPanel } from './FlowPreviewPanel';

function makeTree(hasWorkflowOutput?: true): FlowTree {
  return {
    roots: [
      {
        nodeId: 'node-1',
        name: '휴가신청완료',
        nodeType: 'NORMAL',
        via: 'ROOT',
        repeated: false,
        children: [],
        ...(hasWorkflowOutput ? { hasWorkflowOutput } : {}),
      },
    ],
    orphanNodes: [],
  };
}

/** WF5 2차 — 흐름 미리보기 "🔗 업무 요청" 배지(workflow-automation-ui-spec.md §3.8, `FlowNode.hasWorkflowOutput`). */
describe('FlowPreviewPanel — 업무 요청 배지(No.41 2차)', () => {
  it('hasWorkflowOutput=true인 노드에는 🔗 업무 요청 배지가 붙는다(텍스트 대체 포함)', () => {
    render(
      <MemoryRouter>
        <FlowPreviewPanel chatbotId="bot-1" tree={makeTree(true)} loading={false} error={false} onLoad={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('이 노드는 업무 요청을 보냅니다')).toBeInTheDocument();
    expect(screen.getByText('업무 요청')).toBeInTheDocument();
  });

  it('hasWorkflowOutput이 없으면 배지가 렌더되지 않는다', () => {
    render(
      <MemoryRouter>
        <FlowPreviewPanel chatbotId="bot-1" tree={makeTree()} loading={false} error={false} onLoad={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('이 노드는 업무 요청을 보냅니다')).not.toBeInTheDocument();
  });
});
