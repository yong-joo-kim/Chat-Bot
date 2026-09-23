import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { ChatbotListItem, DeployScheduleListItem, DeployScheduleSummary } from '@chat-bot/shared-types';
import { resetDeployScheduleMetaCacheForTests } from '../../lib/useDeployScheduleMeta';
import { DeploySchedulesPage } from './DeploySchedulesPage';

expect.extend(toHaveNoViolations);

const mockGlobalList = vi.fn();
const mockSummary = vi.fn();
const mockMeta = vi.fn();
vi.mock('../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    globalList: (...args: unknown[]) => mockGlobalList(...args),
    summary: (...args: unknown[]) => mockSummary(...args),
    meta: (...args: unknown[]) => mockMeta(...args),
  },
}));

const mockChatbotsList = vi.fn();
vi.mock('../../api/chatbots', () => ({
  chatbotsApi: { list: (...args: unknown[]) => mockChatbotsList(...args) },
}));

function makeChatbotListItem(): ChatbotListItem {
  return {
    id: 'chatbot-1',
    groupId: 'group-1',
    name: '테스트봇',
    slug: 'test-bot',
    status: 'ACTIVE',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as ChatbotListItem;
}

function makeItem(overrides: Partial<DeployScheduleListItem> = {}): DeployScheduleListItem {
  return {
    id: 'sched-1',
    chatbotId: 'chatbot-1',
    chatbotName: '테스트봇',
    action: 'RESTORE_VERSION',
    status: 'PENDING',
    scheduledAt: new Date('2027-11-01T00:00:00.000Z'),
    targetVersionId: 'ver-30',
    targetVersionNo: 30,
    enableWebChannel: null,
    channelEnabled: null,
    memo: null,
    createdByEmail: 'editor@chat-bot.local',
    createdAt: new Date('2026-09-20T09:51:00.000Z'),
    attemptCount: 0,
    lastTransientReason: null,
    delaySeconds: null,
    finishedAt: null,
    outcome: null,
    failureReason: null,
    heldReason: null,
    needsAttention: false,
    ...overrides,
  } as DeployScheduleListItem;
}

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). S4 전역 현황 화면의 axe
 * 스캔이 이전까지 없었다.
 */
describe('DeploySchedulesPage(S4) — axe 접근성 스캔(NFR-DA4)', () => {
  beforeEach(() => {
    mockGlobalList.mockReset();
    mockSummary.mockReset();
    mockMeta.mockReset();
    mockChatbotsList.mockReset();
    mockChatbotsList.mockResolvedValue({ items: [makeChatbotListItem()], total: 1, page: 1, pageSize: 100 });
    mockMeta.mockResolvedValue({
      timezone: 'Asia/Seoul',
      timezoneFallback: false,
      engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
      limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
    });
    resetDeployScheduleMetaCacheForTests();
  });

  it('요약 바 + 필터 + 목록이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    mockSummary.mockResolvedValue({
      needsAttention: { total: 1, byChatbot: [{ chatbotId: 'chatbot-1', chatbotName: '테스트봇', count: 1 }] },
      last24h: { succeeded: 2, failed: 1, missed: 0 },
      generatedAt: new Date('2026-09-24T00:00:00.000Z'),
    });
    mockGlobalList.mockResolvedValue({ items: [makeItem({ needsAttention: true, status: 'FAILED', failureReason: 'STATE_CHANGED' })], total: 1, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <DeploySchedulesPage />
      </MemoryRouter>,
    );
    await screen.findByText('실패');

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('빈 상태에도 접근성 위반이 없다', async () => {
    mockSummary.mockResolvedValue({ needsAttention: { total: 0, byChatbot: [] }, last24h: { succeeded: 0, failed: 0, missed: 0 }, generatedAt: new Date('2026-09-24T00:00:00.000Z') });
    mockGlobalList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <DeploySchedulesPage />
      </MemoryRouter>,
    );
    await screen.findByText('권한 범위 내 챗봇에 예약이 없습니다.');

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});
