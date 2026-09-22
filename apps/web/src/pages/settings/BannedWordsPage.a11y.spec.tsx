import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { makeAdminUser, makeBannedWord } from '../../test/fixtures';
import { BannedWordsPage } from './BannedWordsPage';

expect.extend(toHaveNoViolations);

const mockBannedWordsList = vi.fn();

vi.mock('../../api/bannedWords', () => ({
  bannedWordsApi: {
    list: (...args: unknown[]) => mockBannedWordsList(...args),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: makeAdminUser(), can: () => true }),
}));

/** B1 금지어 관리 화면 axe 접근성 스캔 — AC-U-11. */
describe('BannedWordsPage — axe 접근성 스캔 (AC-U-11)', () => {
  beforeEach(() => {
    mockBannedWordsList.mockReset();
  });

  it('금지어 목록이 있는 화면(+ 문장 시험 패널)에 구조적 접근성 위반이 없다', async () => {
    mockBannedWordsList.mockResolvedValue({ items: [makeBannedWord()], total: 1, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <BannedWordsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('금칙어');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(금지어 0건) 화면에도 접근성 위반이 없다', async () => {
    mockBannedWordsList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <BannedWordsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('등록된 금지어가 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
