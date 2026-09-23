import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TestRun, TestRunResult } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../../components/Toast';
import { makeChatbot } from '../../../../test/fixtures';
import type { ChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { TestRunDetailPage } from './TestRunDetailPage';

const chatbot = makeChatbot({ id: 'bot-1', status: 'ACTIVE' });
const RUN_ID = '11111111-1111-4111-8111-111111111111';

const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};
vi.mock('../../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeOverlayRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: RUN_ID,
    chatbotId: chatbot.id,
    setId: '22222222-2222-4222-8222-222222222222',
    mode: 'OVERLAY_COMPARE',
    overlaySource: 'AUGMENTATION_SUGGESTIONS',
    status: 'SUCCEEDED',
    progress: 100,
    totalCount: 60,
    processedCount: 60,
    summary: {
      a: { pass: 60, fail: 0, notJudged: 0, unresolved: 0 },
      b: { pass: 55, fail: 5, notJudged: 0, unresolved: 0 },
      regressed: 1,
      improved: 0,
      excludedSuggestions: 0,
    },
    envFingerprint: null,
    degradedMode: false,
    useRag: false,
    ragCallCount: 0,
    pinned: false,
    failureReason: null,
    elapsedMs: 12000,
    startedAt: new Date('2026-09-20T00:00:00.000Z'),
    finishedAt: new Date('2026-09-20T00:01:00.000Z'),
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

function makeResult(seq: number, overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    id: `result-${seq}`,
    runId: RUN_ID,
    caseId: `case-${seq}`,
    seq,
    questionText: `질문 ${seq}`,
    expectedKind: 'INTENT',
    expectedTargetId: 'intent-1',
    expectedTargetName: '배송조회',
    resultA: 'PASS',
    matchedIntentIdA: 'intent-1',
    matchedFaqIdA: null,
    matchedNodeIdA: null,
    matchedNameA: '배송조회',
    bandA: 'CONFIRMED',
    top1ScoreA: 0.9,
    top1KindA: 'INTENT',
    top1IdA: 'intent-1',
    marginToTop2A: 0.3,
    outputsPreviewA: '미리보기',
    unsupportedCountA: 0,
    blockedByFilterA: false,
    elapsedMsA: 10,
    resultB: 'PASS',
    matchedIntentIdB: 'intent-1',
    matchedFaqIdB: null,
    matchedNodeIdB: null,
    matchedNameB: '배송조회',
    bandB: 'CONFIRMED',
    top1ScoreB: 0.9,
    outputsPreviewB: '미리보기',
    diffStatus: 'SAME',
    wouldUseRag: false,
    ragAttempted: false,
    ragLatencyMs: null,
    ragSourceCount: null,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

const mockRun = makeOverlayRun();
// 51번째 TC(2페이지 첫 항목)에만 회귀가 있다 — M2 페이지네이션 없이는 절대 보이지 않던 케이스.
const page1Items = Array.from({ length: 50 }, (_, i) => makeResult(i + 1));
const page2Items = [
  makeResult(51, { resultA: 'PASS', resultB: 'FAIL', matchedNameB: null, diffStatus: 'DIFFERENT' }),
  ...Array.from({ length: 9 }, (_, i) => makeResult(52 + i)),
];

const mockGetOne = vi.fn();
const mockListResults = vi.fn();
vi.mock('../../../../api/validation', () => ({
  testRunsApi: {
    getOne: (...args: unknown[]) => mockGetOne(...args),
    listResults: (...args: unknown[]) => mockListResults(...args),
    start: vi.fn(),
    cancel: vi.fn(),
    pin: vi.fn(),
    exportUrl: () => 'http://example.test/export',
    compare: vi.fn(),
  },
}));

vi.mock('../../../../lib/useTestRunPolling', () => ({
  useTestRunPolling: () => ({ phase: 'done', run: mockRun }),
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/validation/runs/${RUN_ID}`]}>
        <Routes>
          <Route path="/chatbots/:chatbotId/validation/runs/:runId" element={<TestRunDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** M2(오버레이 비교) 결과 화면 페이지네이션(code-reviewer 지목 High 버그 회귀 검증). */
describe('TestRunDetailPage — OVERLAY_COMPARE(M2) 결과 페이지네이션', () => {
  beforeEach(() => {
    mockGetOne.mockReset();
    mockListResults.mockReset();
    mockGetOne.mockResolvedValue(mockRun);
    mockListResults.mockImplementation((_chatbotId: string, _runId: string, query: { page?: number; regressedOnly?: boolean }) => {
      const page = query?.page ?? 1;
      if (query?.regressedOnly) {
        // 서버가 실행 전체에서 A=PASS → B=FAIL만 걸러 준다.
        return Promise.resolve({ items: [page2Items[0]], total: 1, page, pageSize: 50 });
      }
      return Promise.resolve({
        items: page === 1 ? page1Items : page2Items,
        total: 60,
        page,
        pageSize: 50,
      });
    });
  });

  it('60건(50건 초과) 결과가 있으면 페이지네이션이 렌더되어 2페이지로 이동할 수 있다', async () => {
    renderPage();

    await waitFor(() => expect(mockListResults).toHaveBeenCalled());
    expect(await screen.findByText('질문 1')).toBeInTheDocument();
    expect(screen.queryByText('질문 51')).not.toBeInTheDocument();

    const nav = await screen.findByRole('navigation', { name: '페이지 내비게이션' });
    const page2Button = within(nav).getByRole('button', { name: '2' });

    const user = userEvent.setup();
    await user.click(page2Button);

    await waitFor(() => expect(mockListResults).toHaveBeenCalledWith(chatbot.id, RUN_ID, expect.objectContaining({ page: 2 })));
    expect(await screen.findByText('질문 51')).toBeInTheDocument();
  });

  it('"회귀만" 안내 문구는 전체 결과 기준임을 알린다', async () => {
    renderPage();
    await waitFor(() => expect(mockListResults).toHaveBeenCalled());

    expect(await screen.findByText(/전체 결과 기준/)).toBeInTheDocument();
  });

  it('"회귀만"을 켜면 서버 필터로 조회해 51번째(원래 2페이지)의 회귀가 1페이지에 바로 보인다', async () => {
    renderPage();
    await waitFor(() => expect(mockListResults).toHaveBeenCalled());
    await screen.findByText('질문 1');

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: '회귀만' }));

    await waitFor(() =>
      expect(mockListResults).toHaveBeenCalledWith(chatbot.id, RUN_ID, expect.objectContaining({ page: 1, regressedOnly: true })),
    );
    expect(await screen.findByText('질문 51')).toBeInTheDocument();
    expect(screen.queryByText('질문 1')).not.toBeInTheDocument();
  });

  it('2페이지에서 "회귀만"을 켜면 1페이지로 돌아간다', async () => {
    renderPage();
    await screen.findByText('질문 1');
    const user = userEvent.setup();
    const nav = await screen.findByRole('navigation', { name: '페이지 내비게이션' });
    await user.click(within(nav).getByRole('button', { name: '2' }));
    await screen.findByText('질문 51');

    mockListResults.mockClear();
    await user.click(screen.getByRole('checkbox', { name: '회귀만' }));
    await waitFor(() =>
      expect(mockListResults).toHaveBeenLastCalledWith(chatbot.id, RUN_ID, expect.objectContaining({ page: 1, regressedOnly: true })),
    );
  });
});
