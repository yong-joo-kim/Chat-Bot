import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { TestRun } from '@chat-bot/shared-types';
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
  learningSummary: null,
  refreshLearningSummary: vi.fn(),
};
vi.mock('../../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeRun(overrides: Partial<TestRun> = {}): TestRun {
  return {
    id: RUN_ID,
    chatbotId: chatbot.id,
    setId: '22222222-2222-4222-8222-222222222222',
    mode: 'SINGLE',
    overlaySource: 'NONE',
    status: 'SUCCEEDED',
    progress: 100,
    totalCount: 10,
    processedCount: 10,
    summary: { a: { pass: 10, fail: 0, notJudged: 0, unresolved: 0 } },
    envFingerprint: {
      assetCounts: { intents: 1, keywords: 1, homonyms: 0, contexts: 0, nodes: 1, faqs: 1 },
      embeddingModelId: null,
      semanticEnabled: false,
      thresholds: { accept: 0.8, low: 0.5, margin: 0.1 },
      degradedMode: false,
      useRag: false,
      overlaySource: 'NONE',
      target: { kind: 'PROD', versionId: 'ver-43', versionNo: 43, legacyTiebreak: false, semanticMissing: 0, contentHash: 'a'.repeat(64) },
    },
    degradedMode: false,
    useRag: false,
    ragCallCount: 0,
    pinned: false,
    failureReason: null,
    elapsedMs: 3000,
    startedAt: new Date('2026-09-20T00:00:00.000Z'),
    finishedAt: new Date('2026-09-20T00:01:00.000Z'),
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    target: { kind: 'PROD', versionId: 'ver-43', versionNo: 43, legacyTiebreak: false, semanticMissing: 0 },
    ...overrides,
  } as TestRun;
}

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

const mockRun = makeRun();
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

/** [신규 No.40] TC 실행 상세의 "대상: ..." 표시(`environment-separation-ui-spec.md` §4.14). */
describe('TestRunDetailPage — 대상 표시(No.40)', () => {
  beforeEach(() => {
    mockGetOne.mockReset().mockResolvedValue(mockRun);
    mockListResults.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('envFingerprint.target이 있으면 "대상: 운영(v43)" 줄을 보여준다', async () => {
    renderPage();
    await waitFor(() => expect(mockListResults).toHaveBeenCalled());
    expect(await screen.findByText('대상: 운영(v43)')).toBeInTheDocument();
  });
});
