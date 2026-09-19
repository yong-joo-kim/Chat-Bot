import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DeleteBlockedBanner, resolveBlockedRefKind, type BlockedRef } from './DeleteBlockedBanner';

const CHATBOT_ID = 'bot-1';

/**
 * H1/H2 핵심 회귀 시험 — 삭제차단 배너의 3가지 참조종류(노드/동음이의어/컨텍스트) 각각의
 * 라벨/링크 정확성과 클릭 시 이동을 검증한다.
 *
 * H1(삭제차단 배너 바로가기): 참조 목록 각 항목이 실제로 해당 편집 화면으로 이동하는 링크인지.
 * H2(참조종류 라벨 정확성): `resolveBlockedRefKind`가 서버 메시지 문구("동음이의어"/"컨텍스트")로
 * 참조종류를 정확히 판별해 서로 다른 리소스 종류의 편집 화면으로 갈라 보내는지.
 */
describe('resolveBlockedRefKind — H2 참조종류 판별', () => {
  it('의도 삭제 차단 메시지에 "동음이의어"가 포함되면 kind=homonym을 반환한다', () => {
    expect(resolveBlockedRefKind('intent', '이 의도를 연결한 동음이의어 사전 항목이 1건 있습니다.')).toBe('homonym');
  });

  it('의도 삭제 차단 메시지가 노드 참조(동음이의어 언급 없음)면 kind=node를 반환한다', () => {
    expect(resolveBlockedRefKind('intent', '이 의도를 사용하는 대화 노드가 2건 있습니다.')).toBe('node');
  });

  it('키워드 삭제 차단 메시지에 "컨텍스트"가 포함되면 kind=context를 반환한다', () => {
    expect(resolveBlockedRefKind('keyword', '이 키워드를 참조하는 컨텍스트 슬롯이 1건 있습니다.')).toBe('context');
  });

  it('키워드 삭제 차단 메시지가 노드 참조(컨텍스트 언급 없음)면 kind=node를 반환한다', () => {
    expect(resolveBlockedRefKind('keyword', '이 키워드를 사용하는 대화 노드가 1건 있습니다.')).toBe('node');
  });

  it('컨텍스트/노드 리소스는 항상 kind=node를 반환한다(해당 리소스는 노드로만 참조된다)', () => {
    expect(resolveBlockedRefKind('context', '이 컨텍스트를 사용하는 대화 노드가 1건 있습니다.')).toBe('node');
    expect(resolveBlockedRefKind('node', '이 노드로 이동하도록 설정된 노드가 1건 있습니다.')).toBe('node');
  });
});

function renderBanner(props: {
  kind: 'node' | 'homonym' | 'context';
  message: string;
  refs: BlockedRef[];
  onBeforeNavigate: () => void;
}): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/start']}>
      <Routes>
        <Route path="/chatbots/:chatbotId/dialogue/start" element={<DeleteBlockedBanner chatbotId={CHATBOT_ID} {...props} />} />
        <Route path="/chatbots/:chatbotId/dialogue/nodes/:id" element={<p>노드 편집 화면</p>} />
        <Route path="/chatbots/:chatbotId/dialogue/homonyms" element={<p>동음이의어 사전 화면</p>} />
        <Route path="/chatbots/:chatbotId/dialogue/contexts/:id" element={<p>컨텍스트 편집 화면</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DeleteBlockedBanner — 참조종류별 라벨/링크(H1/H2)', () => {
  it('kind=node: 참조 노드명이 그대로 표시되고 클릭 시 노드 편집 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    const onBeforeNavigate = vi.fn();
    renderBanner({
      kind: 'node',
      message: '이 의도를 사용하는 대화 노드가 1건 있습니다.',
      refs: [{ id: 'node-1', name: '배송조회_응답' }],
      onBeforeNavigate,
    });

    expect(screen.getByText('이 의도를 사용하는 대화 노드가 1건 있습니다.')).toBeInTheDocument();
    const link = screen.getByRole('button', { name: '배송조회_응답' });
    await user.click(link);

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('노드 편집 화면')).toBeInTheDocument();
  });

  it('kind=homonym: 참조 항목(단어)명이 표시되고 클릭 시 동음이의어 사전 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    const onBeforeNavigate = vi.fn();
    renderBanner({
      kind: 'homonym',
      message: '이 의도를 연결한 동음이의어 사전 항목이 1건 있습니다. 먼저 연결을 정리해 주세요.',
      refs: [{ id: 'homonym-1', name: '배' }],
      onBeforeNavigate,
    });

    expect(screen.getByText(/동음이의어 사전 항목이 1건 있습니다/)).toBeInTheDocument();
    const link = screen.getByRole('button', { name: '배' });
    await user.click(link);

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('동음이의어 사전 화면')).toBeInTheDocument();
  });

  it('kind=context: 참조 컨텍스트명이 표시되고 클릭 시 컨텍스트 편집 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    const onBeforeNavigate = vi.fn();
    renderBanner({
      kind: 'context',
      message: '이 키워드를 참조하는 컨텍스트 슬롯이 1건 있습니다. 먼저 슬롯을 정리해 주세요.',
      refs: [{ id: 'context-1', name: '커피주문' }],
      onBeforeNavigate,
    });

    expect(screen.getByText(/컨텍스트 슬롯이 1건 있습니다/)).toBeInTheDocument();
    const link = screen.getByRole('button', { name: '커피주문' });
    await user.click(link);

    expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('컨텍스트 편집 화면')).toBeInTheDocument();
  });

  it('참조가 5건을 넘으면 상위 5건만 보여주고 "외 N건"을 표시한다', () => {
    const refs: BlockedRef[] = Array.from({ length: 7 }, (_, i) => ({ id: `node-${i}`, name: `노드${i}` }));
    renderBanner({ kind: 'node', message: '참조 노드가 7건 있습니다.', refs, onBeforeNavigate: vi.fn() });

    expect(screen.getAllByRole('button', { name: /^노드\d$/ })).toHaveLength(5);
    expect(screen.getByText('외 2건')).toBeInTheDocument();
  });
});
