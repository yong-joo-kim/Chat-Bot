import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makeChatbot } from '../../../test/fixtures';
import { ChatbotWorkflowShell } from './ChatbotWorkflowShell';

const mockUseChatbotDetailContext = vi.fn();
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockUseChatbotDetailContext(),
}));

let permissions: string[] = [];
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => permissions.includes(p) }),
}));

function renderShell(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/chatbots/22222222-2222-4222-8222-222222222222/workflow-automation/subscriptions']}>
      <Routes>
        <Route path="/chatbots/:chatbotId/workflow-automation/*" element={<ChatbotWorkflowShell />}>
          <Route path="subscriptions" element={<p>이벤트 구독 본문</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * WF3~WF3-b — 챗봇 스코프 조회는 `chatbot:read` AND `dialogue:read`가 모두 필요하다(R-9).
 * AGENT는 `chatbot:read`만 가지므로 배제된다(workflow-automation-ui-spec.md §5).
 */
describe('ChatbotWorkflowShell — 권한별 렌더링', () => {
  it('chatbot:read만 있고 dialogue:read가 없으면(AGENT) 403 안내를 보여준다', () => {
    permissions = ['chatbot:read'];
    mockUseChatbotDetailContext.mockReturnValue({ chatbot: makeChatbot() });

    renderShell();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('이벤트 구독 본문')).not.toBeInTheDocument();
  });

  it('chatbot:read+dialogue:read가 모두 있으면 서브탭과 본문이 보인다', () => {
    permissions = ['chatbot:read', 'dialogue:read'];
    mockUseChatbotDetailContext.mockReturnValue({ chatbot: makeChatbot() });

    renderShell();

    expect(screen.getByRole('link', { name: '이벤트 구독' })).toBeInTheDocument();
    expect(screen.getByText('이벤트 구독 본문')).toBeInTheDocument();
  });
});
