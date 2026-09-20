import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DialogueOverlay } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { NodeFormPage } from './NodeFormPage';

const mockContext: ChatbotDetailContext = {
  chatbot: makeChatbot({ id: 'bot-1', status: 'ACTIVE' }),
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

vi.mock('../../api/dialogue', () => ({
  dialogNodesApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }), findOne: vi.fn() },
  intentsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
  keywordsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
  contextsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

let capturedDrawerProps: { isOpen: boolean; overlay?: DialogueOverlay } | undefined;
vi.mock('../chatbot-detail/simulator/SimulatorDrawer', () => ({
  SimulatorDrawer: (props: { isOpen: boolean; overlay?: DialogueOverlay }) => {
    capturedDrawerProps = props;
    if (!props.isOpen) return null;
    return <div data-testid="sim-drawer-stub">드로어 열림</div>;
  },
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/nodes/new']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/nodes/new" element={<NodeFormPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** SIM1-D 드로어 진입 지점 1/3 — 노드 편집 폼(FR-10-17/23, ui-spec §4.2). */
describe('NodeFormPage — SIM1-D 드로어 진입("이 설정으로 테스트")', () => {
  it('초기에는 드로어가 닫혀 있다가, 버튼을 누르면 현재 폼 상태가 오버레이로 직렬화되어 열린다', async () => {
    renderPage();
    expect(capturedDrawerProps?.isOpen).toBe(false);
    expect(screen.queryByTestId('sim-drawer-stub')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/노드 이름|이름/), '배송조회_응답');
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect(screen.getByTestId('sim-drawer-stub')).toBeInTheDocument();
    expect(capturedDrawerProps?.isOpen).toBe(true);
    expect(capturedDrawerProps?.overlay?.dialogNodes?.[0]).toMatchObject({ id: 'draft-1', name: '배송조회_응답' });
  });

  it('드로어 진입은 UnsavedGuardContext를 등록하지 않는다(AC-10-17 — 라우트 이동이 아니므로)', async () => {
    renderPage();
    const user = userEvent.setup();
    const setUnsavedGuardCallsBefore = (mockContext.setUnsavedGuard as ReturnType<typeof vi.fn>).mock.calls.length;

    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect((mockContext.setUnsavedGuard as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setUnsavedGuardCallsBefore);
  });
});
