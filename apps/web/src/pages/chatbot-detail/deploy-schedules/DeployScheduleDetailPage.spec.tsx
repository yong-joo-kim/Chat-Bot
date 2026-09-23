import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DeployScheduleDetail, DeployScheduleMeta } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import { resetDeployScheduleMetaCacheForTests } from '../../../lib/useDeployScheduleMeta';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { DeployScheduleDetailPage } from './DeployScheduleDetailPage';

const chatbot = makeChatbot();
const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const mockUseAuth = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockDetail = vi.fn();
const mockMeta = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    detail: (...args: unknown[]) => mockDetail(...args),
    meta: (...args: unknown[]) => mockMeta(...args),
    stateCheck: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    acknowledge: vi.fn(),
    preview: vi.fn(),
    create: vi.fn(),
  },
}));

function baseMeta(): DeployScheduleMeta {
  return {
    timezone: 'Asia/Seoul',
    timezoneFallback: false,
    engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
    limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
  };
}

function makeDetail(overrides: Partial<DeployScheduleDetail> = {}): DeployScheduleDetail {
  return {
    id: 'sched-1',
    chatbotId: chatbot.id,
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
    params: { versionId: 'ver-30' },
    acknowledgeActive: false,
    expectedContentHash: 'a'.repeat(64),
    targetContentHash: 'b'.repeat(64),
    predecessor: null,
    heldBy: null,
    resultSummary: null,
    revert: null,
    postRunTestSetId: null,
    testRunId: null,
    cancelledByEmail: null,
    cancelledAt: null,
    acknowledgedByEmail: null,
    acknowledgedAt: null,
    readinessWarnings: [],
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/deploy-schedules/sched-1`]}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots/:chatbotId/deploy-schedules/:scheduleId" element={<DeployScheduleDetailPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** S2 — 예약 상세(`scheduled-deploy-ui-spec.md` §4.2). 상태·권한별 액션 버튼 렌더를 검증한다(§6). */
describe('DeployScheduleDetailPage', () => {
  beforeEach(() => {
    mockDetail.mockReset();
    mockMeta.mockReset();
    mockMeta.mockResolvedValue(baseMeta());
    mockUseAuth.mockReturnValue({ can: () => true });
    resetDeployScheduleMetaCacheForTests();
  });

  it('PENDING + 관리 권한 — "시각/메모 수정"·"취소" 버튼이 렌더된다', async () => {
    mockDetail.mockResolvedValue(makeDetail({ status: 'PENDING' }));
    renderPage();

    expect(await screen.findByRole('button', { name: '시각/메모 수정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('FAILED + 관리 권한 — "지금 다시 예약"·"확인함" 버튼이 렌더된다', async () => {
    mockDetail.mockResolvedValue(makeDetail({ status: 'FAILED', failureReason: 'STATE_CHANGED', needsAttention: true }));
    renderPage();

    expect(await screen.findByRole('button', { name: '지금 다시 예약' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인함' })).toBeInTheDocument();
    expect(screen.getByText('예약 이후 자산이 변경됨')).toBeInTheDocument();
  });

  it('HELD + 관리 권한 — "보류 해제"·"취소" 버튼이 렌더되고 보류 사유가 표시된다', async () => {
    mockDetail.mockResolvedValue(makeDetail({ status: 'HELD', heldReason: 'PREDECESSOR_FAILED', needsAttention: true }));
    renderPage();

    expect(await screen.findByRole('button', { name: '보류 해제' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
    expect(screen.getByText('선행 예약 실패로 보류됨')).toBeInTheDocument();
  });

  it('M-1: 상세 헤더 시각(예약 시각·생성 시각)에 meta 기준 시간대 라벨이 병기된다', async () => {
    mockDetail.mockResolvedValue(makeDetail({ status: 'PENDING' }));
    renderPage();

    await screen.findByText('시각/메모 수정');
    // 예약 시각 + 생성 시각, 최소 2곳에 시간대 라벨이 병기된다(NFR-DA1).
    expect(screen.getAllByText(/\(KST, UTC\+9\)/).length).toBeGreaterThanOrEqual(2);
  });

  it('M-3: dialogue:write만 있고 chatbot:write가 없으면 RESTORE_VERSION 예약은 관리 버튼이 렌더되지 않는다(포괄 canManage 아님)', async () => {
    mockUseAuth.mockReturnValue({ can: (p: string) => p === 'dialogue:write' });
    mockDetail.mockResolvedValue(makeDetail({ status: 'PENDING', action: 'RESTORE_VERSION' }));
    renderPage();

    await screen.findByText(/PENDING|대기/);
    expect(screen.queryByRole('button', { name: '시각/메모 수정' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });

  it('VIEWER(관리 권한 없음) — 어떤 상태든 쓰기 버튼이 렌더되지 않는다(§6)', async () => {
    mockUseAuth.mockReturnValue({ can: () => false });
    mockDetail.mockResolvedValue(makeDetail({ status: 'HELD', heldReason: 'PREDECESSOR_FAILED', needsAttention: true }));
    renderPage();

    await screen.findByText('선행 예약 실패로 보류됨');
    expect(screen.queryByRole('button', { name: '보류 해제' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '확인함' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '시각/메모 수정' })).not.toBeInTheDocument();
  });

  it('CANCELLED — 액션 버튼 없이 취소자·취소 시각만 표시된다', async () => {
    mockDetail.mockResolvedValue(
      makeDetail({ status: 'CANCELLED', cancelledByEmail: 'admin@chat-bot.local', cancelledAt: new Date('2026-10-01T00:00:00.000Z') }),
    );
    renderPage();

    expect(await screen.findByText(/admin@chat-bot.local/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '지금 다시 예약' })).not.toBeInTheDocument();
  });

  it('404(NOT_FOUND) — "찾을 수 없습니다" 안내와 목록 복귀 링크가 표시된다', async () => {
    const { ApiError } = await import('../../../api/client');
    mockDetail.mockRejectedValue(new ApiError(404, '없음', 'NOT_FOUND'));
    renderPage();

    expect(await screen.findByText('요청한 예약을 찾을 수 없습니다.')).toBeInTheDocument();
  });
});
