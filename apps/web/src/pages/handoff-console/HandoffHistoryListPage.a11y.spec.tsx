import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { HandoffHistoryItem, HandoffSummaryResponse, Paginated } from '@chat-bot/shared-types';
import { HandoffHistoryListPage } from './HandoffHistoryListPage';
import { handoffApi } from '../../api/handoff';

expect.extend(toHaveNoViolations);

vi.mock('../../api/handoff', () => ({ handoffApi: { historySummary: vi.fn(), historyList: vi.fn() } }));
vi.mock('./HandoffConsoleChatbotShell', () => ({
  useHandoffConsoleChatbotContext: () => ({ chatbotId: 'bot-1', chatbotName: '쇼핑몰 도우미' }),
}));

const SUMMARY: HandoffSummaryResponse = {
  count: 23,
  connectedCount: 20,
  avgFirstResponseSec: 42,
  firstResponseSamples: 20,
  avgDurationSec: 372,
  durationSamples: 18,
  endReasonCounts: { AGENT_ENDED: 20, USER_IDLE: 3 },
};

const ITEM: HandoffHistoryItem = {
  id: 'h1',
  alias: 'a1b2c3',
  startedAt: new Date('2026-09-24T01:00:00.000Z'),
  connectedAt: new Date('2026-09-24T01:00:05.000Z'),
  endedAt: new Date('2026-09-24T01:10:00.000Z'),
  assignedUserName: '김상담',
  endReason: 'AGENT_ENDED',
  userMessageCount: 4,
  agentMessageCount: 5,
  firstResponseSec: 42,
  alertLevelAtStart: 'WARNING',
  clientMode: 'MODERN',
};

const LIST: Paginated<HandoffHistoryItem> = { items: [ITEM], total: 1, page: 1, pageSize: 20 };

/** M2(코드 리뷰 1회차) — HC3 axe 접근성 스캔. */
describe('HandoffHistoryListPage — axe 접근성 스캔', () => {
  it('요약 카드 + 이력 표가 있는 화면에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.historySummary).mockResolvedValue(SUMMARY);
    vi.mocked(handoffApi.historyList).mockResolvedValue(LIST);

    const { container } = render(
      <MemoryRouter>
        <HandoffHistoryListPage />
      </MemoryRouter>,
    );
    await screen.findByText('김상담');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태에도 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.historySummary).mockResolvedValue({ ...SUMMARY, count: 0, connectedCount: 0, avgFirstResponseSec: null, firstResponseSamples: 0, avgDurationSec: null, durationSamples: 0, endReasonCounts: {} });
    vi.mocked(handoffApi.historyList).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <HandoffHistoryListPage />
      </MemoryRouter>,
    );
    await screen.findByText('이 기간에 상담 기록이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
