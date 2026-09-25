import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TestRun } from '@chat-bot/shared-types';
import { makeChatbot } from '../../../../test/fixtures';
import type { ChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { ToastProvider } from '../../../../components/Toast';
import { TestRunListPage } from './TestRunListPage';

const chatbot = makeChatbot({ id: 'bot-1', status: 'ACTIVE' });

const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
  learningSummary: null,
  refreshLearningSummary: vi.fn(),
  environmentStatus: null,
  refreshEnvironmentStatus: vi.fn(),
};
vi.mock('../../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: 'run-1',
    chatbotId: chatbot.id,
    setId: 'set-1',
    mode: 'SINGLE',
    overlaySource: 'NONE',
    status: 'SUCCEEDED',
    progress: 100,
    totalCount: 10,
    processedCount: 10,
    summary: { a: { pass: 10, fail: 0, notJudged: 0, unresolved: 0 } },
    envFingerprint: null,
    degradedMode: false,
    useRag: false,
    ragCallCount: 0,
    pinned: false,
    failureReason: null,
    elapsedMs: 3000,
    startedAt: new Date('2026-09-20T00:00:00.000Z'),
    finishedAt: new Date('2026-09-20T00:01:00.000Z'),
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  } as TestRun;
}

const mockListSets = vi.fn();
const mockListRuns = vi.fn();
vi.mock('../../../../api/validation', () => ({
  testSetsApi: { list: (...args: unknown[]) => mockListSets(...args) },
  testRunsApi: { list: (...args: unknown[]) => mockListRuns(...args), pin: vi.fn(), cancel: vi.fn() },
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter>
        <TestRunListPage />
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** [신규 No.40] 실행 목록의 대상 배지(`environment-separation-ui-spec.md` §4.14). */
describe('TestRunListPage — 대상 배지(No.40)', () => {
  beforeEach(() => {
    mockListSets.mockReset().mockResolvedValue({ items: [{ id: 'set-1', name: '정기 회귀', caseCount: 10 }], total: 1 });
    mockListRuns.mockReset();
  });

  it('run.target이 있으면 "대상: 스테이징(v44)" 배지를 보여준다', async () => {
    mockListRuns.mockResolvedValue({
      items: [makeRun({ target: { kind: 'STAGING', versionId: 'ver-44', versionNo: 44, legacyTiebreak: false, semanticMissing: 0 } })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPage();
    expect(await screen.findByText('대상: 스테이징(v44)')).toBeInTheDocument();
  });

  it('run.target이 없으면(초안) 배지를 보여주지 않는다', async () => {
    mockListRuns.mockResolvedValue({ items: [makeRun()], total: 1, page: 1, pageSize: 20 });
    renderPage();
    await waitFor(() => expect(mockListRuns).toHaveBeenCalled());
    expect(screen.queryByText(/^대상:/)).not.toBeInTheDocument();
  });
});
