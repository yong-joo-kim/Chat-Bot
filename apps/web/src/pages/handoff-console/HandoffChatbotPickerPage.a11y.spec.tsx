import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { HandoffConsoleResponse } from '@chat-bot/shared-types';
import { HandoffChatbotPickerPage } from './HandoffChatbotPickerPage';
import { handoffApi } from '../../api/handoff';

expect.extend(toHaveNoViolations);

vi.mock('../../api/handoff', () => ({ handoffApi: { consoleChatbots: vi.fn() } }));

const RESPONSE: HandoffConsoleResponse = {
  items: [
    { chatbotId: 'bot-1', name: '쇼핑몰 도우미', status: 'ACTIVE', handoffEnabled: true, activeHandoffCount: 3 },
    { chatbotId: 'bot-2', name: '뉴스레터 챗봇', status: 'ACTIVE', handoffEnabled: false, activeHandoffCount: 0 },
  ],
  myActiveCount: 2,
};

/** M2(코드 리뷰 1회차) — HC0 axe 접근성 스캔. */
describe('HandoffChatbotPickerPage — axe 접근성 스캔', () => {
  it('챗봇 카드 목록 화면에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.consoleChatbots).mockResolvedValue(RESPONSE);
    const { container } = render(
      <MemoryRouter>
        <HandoffChatbotPickerPage />
      </MemoryRouter>,
    );
    await screen.findByText('쇼핑몰 도우미');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(모니터링할 수 있는 챗봇 0건)에도 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.consoleChatbots).mockResolvedValue({ items: [], myActiveCount: 0 });
    const { container } = render(
      <MemoryRouter>
        <HandoffChatbotPickerPage />
      </MemoryRouter>,
    );
    await screen.findByText('모니터링할 수 있는 챗봇이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
