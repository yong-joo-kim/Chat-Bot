import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { LiveSessionListResponse } from '@chat-bot/shared-types';
import { LiveSessionListPage } from './LiveSessionListPage';
import { handoffApi } from '../../api/handoff';

expect.extend(toHaveNoViolations);

vi.mock('../../api/handoff', () => ({ handoffApi: { liveSessions: vi.fn() } }));
vi.mock('./HandoffConsoleChatbotShell', () => ({
  useHandoffConsoleChatbotContext: () => ({ chatbotId: 'bot-1', chatbotName: '쇼핑몰 도우미' }),
}));
// [신규 No.45] G7 배너가 `useAuth().user.governanceModeOn`을 읽는다(data-governance-ui-spec.md §3.10).
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: '박관리', role: 'ADMIN', governanceModeOn: false }, can: () => true }),
}));

const RESPONSE: LiveSessionListResponse = {
  items: [
    {
      sessionRef: 'a'.repeat(16),
      alias: 'a1b2c3',
      channelType: 'WEB',
      firstAt: new Date('2026-09-24T01:00:00.000Z'),
      lastAt: new Date('2026-09-24T01:05:00.000Z'),
      turnCount: 4,
      consecutiveUnanswered: 3,
      windowUnanswered: 5,
      blockedCount: 0,
      alertLevel: 'WARNING',
      lastUserText: '환불 계좌를 바꾸고 싶어요',
      handoffSupported: true,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
  summary: { live: 1, warning: 1, caution: 0, handoffActive: 0 },
  truncated: false,
  windowMinutes: 10,
  handoffEnabled: true,
  generatedAt: new Date('2026-09-24T01:05:10.000Z'),
};

/** M2(코드 리뷰 1회차) — HC1 axe 접근성 스캔. */
describe('LiveSessionListPage — axe 접근성 스캔', () => {
  it('진행 중 세션 목록 화면에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.liveSessions).mockResolvedValue(RESPONSE);
    const { container } = render(
      <MemoryRouter>
        <LiveSessionListPage />
      </MemoryRouter>,
    );
    // M3(§8.1)부터 표(데스크톱)와 카드(모바일)를 함께 렌더하고 CSS로 하나만 보이게 한다 — 텍스트가 2곳에 나온다.
    await screen.findAllByText('환불 계좌를 바꾸고 싶어요');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태에도 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.liveSessions).mockResolvedValue({ ...RESPONSE, items: [], total: 0, summary: { live: 0, warning: 0, caution: 0, handoffActive: 0 } });
    const { container } = render(
      <MemoryRouter>
        <LiveSessionListPage />
      </MemoryRouter>,
    );
    await screen.findByText('최근 10분 안에 활동한 대화가 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
