import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chatbot, ChatbotVersionListItem, RestorePreviewResponse, RestoreResponse, VersionDiffResponse } from '@chat-bot/shared-types';
import type { ChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { ApiError } from '../../../../api/client';
import { ToastProvider } from '../../../../components/Toast';
import { VersionDiffPage } from './VersionDiffPage';

const chatbot: Chatbot = {
  id: 'bot-1',
  groupId: 'group-1',
  name: '주문 상담봇',
  avatarUrl: undefined,
  description: undefined,
  slug: 'order-bot',
  status: 'ACTIVE',
  skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-18T00:00:00.000Z'),
};

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

const mockList = vi.fn();
const mockDiff = vi.fn();
const mockRestorePreview = vi.fn();
const mockRestore = vi.fn();

vi.mock('../../../../api/versions', () => ({
  versionsApi: {
    list: (...args: unknown[]) => mockList(...args),
    diff: (...args: unknown[]) => mockDiff(...args),
    diffItemDetail: vi.fn(),
    restorePreview: (...args: unknown[]) => mockRestorePreview(...args),
    restore: (...args: unknown[]) => mockRestore(...args),
  },
}));

vi.mock('../../../../api/embedding', () => ({
  embeddingApi: {
    status: vi.fn().mockResolvedValue({ indexed: 0, totalTargets: 0, pending: 0, failed: 0, providerHealthy: true, staleModel: false }),
  },
}));

function makeVersionItem(overrides: Partial<ChatbotVersionListItem> = {}): ChatbotVersionListItem {
  return {
    id: 'ver-14',
    versionNo: 14,
    trigger: 'MANUAL',
    triggerLabel: '수동 저장',
    triggerContext: null,
    schemaVersion: 1,
    schemaSupported: true,
    contentHash: 'a'.repeat(64),
    counts: {
      intents: 1,
      intentExamples: 1,
      keywords: 0,
      homonyms: 0,
      contexts: 0,
      dialogNodes: 0,
      nodeIntentLinks: 0,
      nodeKeywordLinks: 0,
      faqs: 0,
      answerSetting: 0,
    },
    sizeBytes: 100,
    integrityWarningCount: 0,
    label: null,
    memo: null,
    pinned: false,
    restoredFromVersionNo: null,
    createdById: 'user-1',
    createdByEmail: 'editor@chat-bot.local',
    createdAt: new Date('2026-09-20T09:51:00.000Z'),
    updatedAt: new Date('2026-09-20T09:51:00.000Z'),
    ...overrides,
  };
}

function makeDiffResponse(overrides: Partial<VersionDiffResponse> = {}): VersionDiffResponse {
  return {
    base: { kind: 'VERSION', versionId: 'ver-14', versionNo: 14, contentHash: 'a'.repeat(64) },
    target: { kind: 'CURRENT', contentHash: 'b'.repeat(64) },
    summary: { rows: [], totalChanged: 0, identical: true },
    ...overrides,
  };
}

function makeRestorePreview(overrides: Partial<RestorePreviewResponse> = {}): RestorePreviewResponse {
  return {
    targetVersion: { id: 'ver-14', versionNo: 14, trigger: 'MANUAL', createdAt: new Date('2026-09-01T00:00:00.000Z'), schemaVersion: 1 },
    currentContentHash: 'b'.repeat(64),
    targetContentHash: 'a'.repeat(64),
    diffSummary: { rows: [], totalChanged: 0, identical: false },
    changesUndone: 2,
    laterVersionCount: 1,
    blockers: [],
    warnings: [],
    restorable: true,
    ...overrides,
  };
}

function makeRestoreResponse(overrides: Partial<RestoreResponse> = {}): RestoreResponse {
  return {
    restoredFromVersionNo: 14,
    backupVersionNo: 15,
    backupVersionId: 'ver-15',
    contentHash: 'a'.repeat(64),
    summary: {},
    reindexScheduled: true,
    reindexWasRunning: false,
    classifierDeleted: false,
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/chatbots/bot-1/versions/ver-14/diff?against=current']}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots/:chatbotId/versions/:versionId/diff" element={<VersionDiffPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** L2 — 복원 성공/충돌 시 reload·재조회 회귀(M-2, L-3, L-6). */
describe('VersionDiffPage — 복원 후속 처리', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDiff.mockReset();
    mockRestorePreview.mockReset();
    mockRestore.mockReset();
    (mockContext.reload as ReturnType<typeof vi.fn>).mockClear();
    mockList.mockResolvedValue({ items: [makeVersionItem()], total: 1, page: 1, pageSize: 100 });
    mockDiff.mockResolvedValue(makeDiffResponse());
  });

  it('복원 성공 시 reload()가 호출되고 diff가 재조회된다(M-2, L-6)', async () => {
    const user = userEvent.setup();
    mockRestorePreview.mockResolvedValue(makeRestorePreview());
    mockRestore.mockResolvedValue(makeRestoreResponse());
    renderPage();

    const restoreButton = await screen.findByRole('button', { name: '이 버전으로 복원' });
    await user.click(restoreButton);
    const confirmButton = await screen.findByRole('button', { name: 'v14로 복원' });

    const diffCallsBefore = mockDiff.mock.calls.length;
    await user.click(confirmButton);

    await waitFor(() => expect(mockContext.reload).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockDiff.mock.calls.length).toBeGreaterThan(diffCallsBefore));
    expect(await screen.findByText('v14로 복원되었습니다.')).toBeInTheDocument();
  });

  it('409 RESTORE_IN_PROGRESS면 다이얼로그가 닫히고 diff·버전 목록이 재조회된다(L-3)', async () => {
    const user = userEvent.setup();
    mockRestorePreview.mockResolvedValue(makeRestorePreview());
    mockRestore.mockRejectedValue(new ApiError(409, '이미 복원 중입니다.', 'RESTORE_IN_PROGRESS'));
    renderPage();

    const restoreButton = await screen.findByRole('button', { name: '이 버전으로 복원' });
    await user.click(restoreButton);
    const confirmButton = await screen.findByRole('button', { name: 'v14로 복원' });

    const diffCallsBefore = mockDiff.mock.calls.length;
    const listCallsBefore = mockList.mock.calls.length;
    await user.click(confirmButton);

    await waitFor(() => expect(mockDiff.mock.calls.length).toBeGreaterThan(diffCallsBefore));
    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(listCallsBefore));
    expect(screen.queryByRole('button', { name: 'v14로 복원' })).not.toBeInTheDocument();
  });
});
