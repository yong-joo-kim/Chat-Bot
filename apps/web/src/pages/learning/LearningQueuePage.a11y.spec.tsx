import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { StatsShellContext } from '../stats/StatsShell';
import { LearningQueuePage } from './LearningQueuePage';

expect.extend(toHaveNoViolations);

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333' });

const mockShellContext: StatsShellContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
  learningSummary: { pendingCount: 1, limitReached: false },
  refreshLearningSummary: vi.fn(),
};

vi.mock('../stats/StatsShell', () => ({
  useStatsShellContext: () => mockShellContext,
}));

let canWrite = true;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'dialogue:write' ? canWrite : true) }),
}));

const mockList = vi.fn();
const mockFindOne = vi.fn();
vi.mock('../../api/learning', () => ({
  learningApi: {
    list: (...args: unknown[]) => mockList(...args),
    summary: vi.fn(),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    resolve: vi.fn(),
    ignore: vi.fn(),
    reopen: vi.fn(),
    bulkResolve: vi.fn(),
    bulkIgnore: vi.fn(),
  },
}));

vi.mock('../../api/dialogue', () => ({
  intentsApi: {
    list: vi.fn().mockResolvedValue({ items: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '배송문의' }], total: 1, page: 1, pageSize: 100 }),
  },
  keywordsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
}));

// B1 분류기 상태 패널이 L1 상단에서 항상 조회한다 — axe 스캔에 영향 없도록 최소 응답으로 목 처리한다.
vi.mock('../../api/classifier', () => ({
  classifierApi: {
    status: vi.fn().mockResolvedValue({ state: 'NONE', classCount: 0, sampleCount: 0, stale: false, staleReasons: [] }),
    train: vi.fn(),
  },
}));

function makeItem(overrides: Partial<UnansweredQuestionListItem> = {}): UnansweredQuestionListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    chatbotId: chatbot.id,
    questionText: '해외배송도 되나요?',
    occurredCount: 12,
    status: 'PENDING',
    firstOccurredAt: new Date('2026-09-01T00:00:00.000Z'),
    lastOccurredAt: new Date('2026-09-22T09:00:00.000Z'),
    recurredCount: 4,
    recurredAfterAt: new Date('2026-09-15T00:00:00.000Z'),
    channelType: 'WEB',
    suggestions: [{ intentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', intentName: '배송문의', score: 0.62, matchedExample: '배송 얼마나 걸리나요' }],
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <LearningQueuePage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** L1 학습현황 axe 접근성 스캔(NFR-A9, AC-UI-10). */
describe('LearningQueuePage — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockFindOne.mockReset();
    canWrite = true;
  });

  it('목록(반영 후 재발생 배지 포함) + 일괄 액션이 보이는 화면(EDITOR)에 구조적 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });

    const { container } = renderPage();
    await screen.findByText('해외배송도 되나요?');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('VIEWER(쓰기 권한 없음)는 체크박스/반영/무시가 렌더되지 않고도 접근성 위반이 없다(FR-C-6)', async () => {
    canWrite = false;
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });

    const { container } = renderPage();
    await screen.findByText('해외배송도 되나요?');

    expect(screen.queryByRole('button', { name: '반영' })).not.toBeInTheDocument();
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('검토할 미응답 질문이 없는 빈 상태(긍정 표현)에도 접근성 위반이 없다(AC-UI-7)', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = renderPage();
    await screen.findByText('검토할 미응답 질문이 없습니다 — 좋은 신호입니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
