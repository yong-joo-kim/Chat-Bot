import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { InboxThreadDetailPage } from './InboxThreadDetailPage';
import { inboxApi } from '../../api/inbox';
import { makeThreadDetail, makeThreadListResponse } from '../../test/inboxFixtures';

expect.extend(toHaveNoViolations);

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'agent-1', name: '김상담', role: 'ADMIN' }, can: () => true }),
}));

vi.mock('../../api/inbox', () => ({
  inboxApi: {
    threadDetail: vi.fn(),
    assignees: vi.fn().mockResolvedValue([]),
    tags: { list: vi.fn().mockResolvedValue([]) },
    identitySpaces: vi.fn().mockResolvedValue([]),
    threads: vi.fn(),
  },
}));

describe('InboxThreadDetailPage — axe 접근성 스캔(OI-2)', () => {
  it('상세 화면에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(inboxApi.threadDetail).mockResolvedValue(makeThreadDetail());
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());

    const { container } = render(
      <MemoryRouter initialEntries={['/inbox/thread-1']}>
        <ToastProvider>
          <Routes>
            <Route path="/inbox/:threadId" element={<InboxThreadDetailPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/인박스 > 홍길동/);

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
