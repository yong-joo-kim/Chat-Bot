import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChatbotListItem, DeployScheduleListItem, DeployScheduleSummary } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { resetDeployScheduleMetaCacheForTests } from '../../lib/useDeployScheduleMeta';
import { DeploySchedulesPage } from './DeploySchedulesPage';

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

function makeChatbotListItem(overrides: Partial<ChatbotListItem> = {}): ChatbotListItem {
  return {
    id: 'chatbot-1',
    groupId: 'group-1',
    name: '테스트봇',
    slug: 'test-bot',
    status: 'ACTIVE',
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
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

function baseSummary(): DeployScheduleSummary {
  return {
    needsAttention: { total: 0, byChatbot: [] },
    last24h: { succeeded: 0, failed: 0, missed: 0 },
    generatedAt: new Date('2026-09-24T00:00:00.000Z'),
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/settings/deploy-schedules']}>
      <DeploySchedulesPage />
    </MemoryRouter>,
  );
}

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). S4 전역 현황 페이지
 * (`apps/web/src/pages/settings/DeploySchedulesPage.tsx`)는 이전까지 전용 스펙이 없었다.
 */
describe('DeploySchedulesPage(S4 전역 예약 현황)', () => {
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

  it('목록·요약을 조회해 챗봇 이름과 함께 행을 렌더한다(쓰기 액션은 제공하지 않음)', async () => {
    mockSummary.mockResolvedValue(baseSummary());
    mockGlobalList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('테스트봇', { selector: '.deploy-schedule-row-chatbot' })).toBeInTheDocument();
    // 전역 목록은 `can={() => false}`로 고정 — 관리 버튼이 렌더되지 않는다(행에 canManage가 있어도).
    expect(screen.queryByRole('button', { name: MESSAGES.deploySchedules.cancelButton })).not.toBeInTheDocument();
  });

  it('요약 실패는 목록 조회를 막지 않는다', async () => {
    mockSummary.mockRejectedValue(new Error('summary down'));
    mockGlobalList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('테스트봇', { selector: '.deploy-schedule-row-chatbot' })).toBeInTheDocument();
  });

  it('목록이 비어 있으면 빈 상태를 표시한다', async () => {
    mockSummary.mockResolvedValue(baseSummary());
    mockGlobalList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText(MESSAGES.deploySchedules.global.emptyTitle)).toBeInTheDocument();
  });

  it('목록 조회 실패 시 오류 상태와 재시도 버튼을 표시한다', async () => {
    mockSummary.mockResolvedValue(baseSummary());
    mockGlobalList.mockRejectedValue(new Error('down'));
    renderPage();

    expect(await screen.findByText(MESSAGES.deploySchedules.loadFailed)).toBeInTheDocument();
  });

  it('"확인 필요만" 체크박스를 켜면 목록 재조회 시 needsAttention 파라미터가 전달된다', async () => {
    mockSummary.mockResolvedValue(baseSummary());
    mockGlobalList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderPage();

    await screen.findByText(MESSAGES.deploySchedules.global.emptyTitle);
    mockGlobalList.mockClear();

    const checkbox = screen.getByRole('checkbox', { name: MESSAGES.deploySchedules.needsAttentionFilterLabel });
    checkbox.click();

    await waitFor(() => expect(mockGlobalList).toHaveBeenCalledWith(expect.objectContaining({ needsAttention: true, page: 1 })));
  });

  it('RUNNING 행이 있으면 5초 폴링 타이머가, 없으면 60초 요약 폴링 타이머가 등록된다', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockSummary.mockResolvedValue(baseSummary());
    mockGlobalList.mockResolvedValue({ items: [makeItem({ status: 'RUNNING' })], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findByText('테스트봇', { selector: '.deploy-schedule-row-chatbot' });
    await waitFor(() => expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000));
    setIntervalSpy.mockRestore();
  });
});
