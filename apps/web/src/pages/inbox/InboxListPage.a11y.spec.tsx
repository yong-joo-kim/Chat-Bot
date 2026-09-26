import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { InboxListPage } from './InboxListPage';
import { inboxApi } from '../../api/inbox';
import { makeSummary, makeThreadListResponse } from '../../test/inboxFixtures';

expect.extend(toHaveNoViolations);

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: '김상담', role: 'ADMIN' }, can: () => true }),
}));

vi.mock('../../api/inbox', () => ({
  inboxApi: {
    summary: vi.fn(),
    threads: vi.fn(),
    tags: { list: vi.fn() },
    createAnonymousCustomer: vi.fn(),
    createTestCustomer: vi.fn(),
  },
}));

describe('InboxListPage — axe 접근성 스캔(OI-1)', () => {
  it('목록 화면에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary());
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());
    vi.mocked(inboxApi.tags.list).mockResolvedValue([]);

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <InboxListPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('홍길동');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
