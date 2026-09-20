import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DialogueOverlay } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { ContextFormPage } from './ContextFormPage';

const mockContext: ChatbotDetailContext = {
  chatbot: makeChatbot({ id: 'bot-1', status: 'ACTIVE' }),
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

vi.mock('../../api/dialogue', () => ({
  contextsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }), findOne: vi.fn() },
  keywordsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
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
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/contexts/new']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/contexts/new" element={<ContextFormPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** SIM1-D 드로어 진입 지점 2/3 — 컨텍스트 편집 폼(FR-10-17/23, ui-spec §4.2). */
describe('ContextFormPage — SIM1-D 드로어 진입("이 설정으로 테스트")', () => {
  it('버튼을 누르면 현재 슬롯 초안이 오버레이로 직렬화되어 드로어가 열린다', async () => {
    renderPage();
    expect(capturedDrawerProps?.isOpen).toBe(false);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^이름/), '커피주문');
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect(screen.getByTestId('sim-drawer-stub')).toBeInTheDocument();
    expect(capturedDrawerProps?.overlay?.contexts?.[0]).toMatchObject({ id: 'draft-1', name: '커피주문' });
  });

  it('드로어를 열어둔 채 폼을 더 고치면 다음 렌더에서 오버레이가 최신 상태로 갱신된다(ui-spec §4.2-3)', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^이름/), '커피주문');
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));
    expect(capturedDrawerProps?.overlay?.contexts?.[0]).toMatchObject({ name: '커피주문' });

    await user.type(screen.getByLabelText(/^이름/), '_v2');
    expect(capturedDrawerProps?.overlay?.contexts?.[0]).toMatchObject({ name: '커피주문_v2' });
  });

  it('드로어 진입은 UnsavedGuardContext를 등록하지 않는다(AC-10-17)', async () => {
    renderPage();
    const user = userEvent.setup();
    const callsBefore = (mockContext.setUnsavedGuard as ReturnType<typeof vi.fn>).mock.calls.length;

    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect((mockContext.setUnsavedGuard as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });
});
