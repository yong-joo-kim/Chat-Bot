import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { Chatbot, ChatbotVersionListItem, RestorePreviewResponse, RestoreResponse, VersionCurrentStatus } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { resetDeployScheduleMetaCacheForTests } from '../../../lib/useDeployScheduleMeta';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { VersionListPage } from './VersionListPage';

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
  setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };

vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const mockUseAuth = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockList = vi.fn();
const mockCurrent = vi.fn();
const mockCreate = vi.fn();
const mockDetail = vi.fn();
const mockRestorePreview = vi.fn();
const mockRestore = vi.fn();
const mockRemove = vi.fn();

vi.mock('../../../api/versions', () => ({
  versionsApi: {
    list: (...args: unknown[]) => mockList(...args),
    current: (...args: unknown[]) => mockCurrent(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    detail: (...args: unknown[]) => mockDetail(...args),
    update: vi.fn(),
    remove: (...args: unknown[]) => mockRemove(...args),
    auditCount: vi.fn(),
    restorePreview: (...args: unknown[]) => mockRestorePreview(...args),
    restore: (...args: unknown[]) => mockRestore(...args),
  },
}));

// No.28: VersionListPage/VersionRow가 예약 관련 API(메타 조회·예약 복원 진입점)를 함께 호출한다.
// 이 스위트는 No.25 회귀 검증이 목적이므로 항상 "예약 없음"으로 응답해 배너/다이얼로그가 뜨지 않게 한다.
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    meta: vi.fn().mockResolvedValue({
      timezone: 'Asia/Seoul',
      timezoneFallback: false,
      engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
      limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
    }),
  },
}));

function makeItem(overrides: Partial<ChatbotVersionListItem> = {}): ChatbotVersionListItem {
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
      intents: 42,
      intentExamples: 300,
      keywords: 118,
      homonyms: 5,
      contexts: 3,
      dialogNodes: 30,
      nodeIntentLinks: 10,
      nodeKeywordLinks: 10,
      faqs: 95,
      answerSetting: 1,
    },
    sizeBytes: 1800000,
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

function makeCurrent(overrides: Partial<VersionCurrentStatus> = {}): VersionCurrentStatus {
  return {
    contentHash: 'a'.repeat(64),
    counts: makeItem().counts,
    latestVersion: makeItem(),
    hasUnsavedChanges: false,
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
    <MemoryRouter initialEntries={['/chatbots/bot-1/versions']}>
      <ToastProvider>
        <VersionListPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * L1 — 버전 목록(`version-history-ui-spec.md` §4.1). 목록 렌더, 수동 저장 unchanged 흐름,
 * 권한별(VIEWER/EDITOR/복원권한) 버튼 렌더 게이팅을 검증한다.
 */
describe('VersionListPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockCurrent.mockReset();
    mockCreate.mockReset();
    mockDetail.mockReset();
    mockRestorePreview.mockReset();
    mockRestore.mockReset();
    mockRemove.mockReset();
    (mockContext.reload as ReturnType<typeof vi.fn>).mockClear();
    mockUseAuth.mockReturnValue({ can: () => true });
    resetDeployScheduleMetaCacheForTests();
  });

  it('목록이 로드되면 버전 번호·트리거 배지·"현재" 행이 표시된다', async () => {
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    renderPage();

    expect(await screen.findByText('v14')).toBeInTheDocument();
    expect(screen.getByText(/수동 저장/)).toBeInTheDocument();
    expect(screen.getByText(/최신 버전\(v14\)과 동일 — 저장할 필요가 없습니다/)).toBeInTheDocument();
  });

  it('버전이 0건이면 빈 상태 안내와 "지금 버전 저장" 버튼이 표시된다(FR-H4-9)', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent({ latestVersion: null, hasUnsavedChanges: false }));
    renderPage();

    expect(await screen.findByText('아직 저장된 버전이 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '지금 버전 저장' })).toBeInTheDocument();
  });

  it('수동 저장 시 unchanged 응답이면 모달이 닫히지 않고 "새로 저장하지 않았습니다" 안내로 전환된다(AC-H1-2)', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    mockCreate.mockResolvedValue({ unchanged: true, latestVersionNo: 14, latestVersionId: 'ver-14' });
    renderPage();

    await screen.findByText('v14');
    await user.click(screen.getByRole('button', { name: '+ 버전 저장' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('직전 버전(v14)과 내용이 같아 새로 저장하지 않았습니다.')).toBeInTheDocument();
    // 모달이 닫히지 않았으므로 다이얼로그(제목)가 여전히 보인다.
    expect(screen.getByRole('heading', { name: '버전 저장' })).toBeInTheDocument();
  });

  it('VIEWER(dialogue:write 없음)는 "+ 버전 저장"·"이 버전으로 복원" 버튼이 렌더되지 않는다(§6)', async () => {
    mockUseAuth.mockReturnValue({ can: () => false });
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    renderPage();

    await screen.findByText('v14');
    expect(screen.queryByRole('button', { name: '+ 버전 저장' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 버전으로 복원' })).not.toBeInTheDocument();
  });

  it('dialogue:write만 있고 chatbot:write가 없으면 저장/고정/삭제는 보이지만 복원 버튼은 렌더되지 않는다(J-11)', async () => {
    mockUseAuth.mockReturnValue({ can: (p: string) => p === 'dialogue:write' });
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    renderPage();

    await screen.findByText('v14');
    expect(screen.getByRole('button', { name: '+ 버전 저장' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이 버전으로 복원' })).not.toBeInTheDocument();
  });

  it('dialogue:write와 chatbot:write가 모두 있으면 복원 버튼이 렌더된다', async () => {
    mockUseAuth.mockReturnValue({ can: () => true });
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    renderPage();

    await screen.findByText('v14');
    expect(screen.getByRole('button', { name: '이 버전으로 복원' })).toBeInTheDocument();
  });

  it('복원 성공 시 챗봇 표시 설정 반영을 위해 ChatbotDetailLayout의 reload()도 호출된다(M-2)', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    mockRestorePreview.mockResolvedValue(makeRestorePreview());
    mockRestore.mockResolvedValue(makeRestoreResponse());
    renderPage();

    await screen.findByText('v14');
    await user.click(screen.getByRole('button', { name: '이 버전으로 복원' }));
    const confirmButton = await screen.findByRole('button', { name: 'v14로 복원' });
    await user.click(confirmButton);

    await waitFor(() => expect(mockRestore).toHaveBeenCalled());
    await waitFor(() => expect(mockContext.reload).toHaveBeenCalledTimes(1));
    // 로컬 버전 목록도 함께 재조회된다(최소 최초 1회 + 복원 후 1회).
    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('409 RESTORE_IN_PROGRESS면 다이얼로그가 닫히고 목록이 재조회된다(L-3)', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    mockRestorePreview.mockResolvedValue(makeRestorePreview());
    mockRestore.mockRejectedValue(new ApiError(409, '이미 복원 중입니다.', 'RESTORE_IN_PROGRESS'));
    renderPage();

    await screen.findByText('v14');
    const listCallsBefore = mockList.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '이 버전으로 복원' }));
    const confirmButton = await screen.findByRole('button', { name: 'v14로 복원' });
    await user.click(confirmButton);

    await waitFor(() => expect(mockList.mock.calls.length).toBeGreaterThan(listCallsBefore));
    expect(screen.queryByRole('button', { name: 'v14로 복원' })).not.toBeInTheDocument();
  });

  it('dialogue:write와 chatbot:write가 모두 있으면 "예약 복원" 버튼도 렌더된다(No.28 E1)', async () => {
    mockUseAuth.mockReturnValue({ can: () => true });
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    renderPage();

    await screen.findByText('v14');
    expect(screen.getByRole('button', { name: '예약 복원' })).toBeInTheDocument();
  });

  it('VERSION_REFERENCED_BY_SCHEDULE(409) — 삭제 시 참조 예약이 있으면 인라인 오류와 예약 배포 링크가 표시된다(No.28)', async () => {
    const user = userEvent.setup();
    mockUseAuth.mockReturnValue({ can: () => true });
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 20 });
    mockCurrent.mockResolvedValue(makeCurrent());
    mockRemove.mockRejectedValue(new ApiError(409, '참조하는 예약이 있습니다.', 'VERSION_REFERENCED_BY_SCHEDULE'));
    renderPage();

    await screen.findByText('v14');
    await user.click(screen.getByRole('button', { name: 'v14 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    await user.click(await screen.findByRole('button', { name: '삭제' }));

    expect(await screen.findByText('이 버전을 대상으로 하는 예약이 있어 삭제할 수 없습니다. 먼저 예약을 취소해 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '예약 배포에서 보기' })).toHaveAttribute('href', '/chatbots/bot-1/deploy-schedules');
  });
});
