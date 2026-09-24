import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FlowTree } from '@chat-bot/shared-types';
import { FlowPreviewPanel } from './FlowPreviewPanel';

function makeTree(): FlowTree {
  return {
    roots: [
      {
        nodeId: 'node-1',
        name: '배송완료_안내',
        nodeType: 'NORMAL',
        via: 'ROOT',
        repeated: false,
        children: [
          {
            nodeId: 'node-2',
            name: '추가문의_안내',
            nodeType: 'NORMAL',
            via: 'SURVEY_COMPLETE',
            repeated: false,
            children: [],
          },
        ],
      },
    ],
    orphanNodes: [],
  };
}

/** [No.27] M1 — 설문 완료 후 이동 대상 자식 항목에 "설문 완료 후 →" 접두가 표시된다(ui-spec §3.7). */
describe('FlowPreviewPanel — SURVEY_COMPLETE 라벨', () => {
  it('via가 SURVEY_COMPLETE인 자식 노드 앞에 "설문 완료 후 →" 라벨이 붙는다', () => {
    render(
      <MemoryRouter>
        <FlowPreviewPanel chatbotId="bot-1" tree={makeTree()} loading={false} error={false} onLoad={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('설문 완료 후 →')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '추가문의_안내' })).toBeInTheDocument();
  });
});
