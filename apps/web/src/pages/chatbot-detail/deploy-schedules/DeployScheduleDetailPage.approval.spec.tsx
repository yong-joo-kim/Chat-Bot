import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DeployScheduleDetail, DeployScheduleMeta } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import { resetDeployScheduleMetaCacheForTests } from '../../../lib/useDeployScheduleMeta';
import { makePolicyStatus } from '../guardrails/testFixtures';
import { DeployScheduleDetailPage } from './DeployScheduleDetailPage';

const chatbot = makeChatbot();
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => ({
    chatbot,
    reload: vi.fn(),
    setUnsavedGuard: vi.fn(),
    learningSummary: null,
    refreshLearningSummary: vi.fn(),
    environmentStatus: { enabled: true },
  }),
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true, user: { id: 'u', email: 'editor@chat-bot.local', governanceModeOn: false } }),
}));

const mockDetail = vi.fn();
const mockMeta = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: { detail: (...a: unknown[]) => mockDetail(...a), meta: (...a: unknown[]) => mockMeta(...a), stateCheck: vi.fn(), update: vi.fn(), cancel: vi.fn(), resume: vi.fn(), acknowledge: vi.fn(), preview: vi.fn(), create: vi.fn() },
}));
const mockApprovalStatus = vi.fn();
vi.mock('../../../api/switchApprovals', () => ({ switchApprovalsApi: { getStatus: (...a: unknown[]) => mockApprovalStatus(...a), createRequest: vi.fn() } }));

function meta(): DeployScheduleMeta {
  return {
    timezone: 'Asia/Seoul',
    timezoneFallback: false,
    engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
    limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
  };
}

function detail(overrides: Partial<DeployScheduleDetail> = {}): DeployScheduleDetail {
  return {
    id: 'sched-1',
    chatbotId: chatbot.id,
    action: 'SWITCH_PROD_VERSION',
    status: 'PENDING',
    scheduledAt: new Date(Date.now() + 86_400_000),
    targetVersionId: 'ver-44',
    targetVersionNo: 44,
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
    params: { targetVersionId: 'ver-44' },
    acknowledgeActive: false,
    expectedContentHash: null,
    targetContentHash: null,
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
  } as unknown as DeployScheduleDetail;
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

beforeEach(() => {
  mockDetail.mockReset();
  mockMeta.mockReset().mockResolvedValue(meta());
  mockApprovalStatus.mockReset().mockResolvedValue(makePolicyStatus());
  resetDeployScheduleMetaCacheForTests();
});

describe('예약 상세 — 2인 승인(챗봇 스코프 상세 한정)', () => {
  it('정책 켜짐 + 승인 요청이 없는 대기 예약은 "승인 요청 필요" 글자와 버튼(작성자)을 보인다', async () => {
    mockDetail.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByText('승인 요청 필요 — 승인 요청이 없으면 실행되지 않습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '승인 요청 보내기' })).toBeInTheDocument();
  });

  it('실패 사유 APPROVAL_MISSING: 상세 설명(운영은 바뀌지 않음)과 기존 "지금 다시 예약" 재시도 버튼을 유지한다', async () => {
    mockDetail.mockResolvedValue(detail({ status: 'FAILED', failureReason: 'APPROVAL_MISSING', needsAttention: true, finishedAt: new Date() }));
    renderPage();
    expect(await screen.findByText(/승인이 없어 실행하지 않았습니다\. 이 챗봇은 운영 전환에 2인 승인이 필요한데, 예약 시각까지 다른 관리자의 승인이 없었습니다\. 운영은 바뀌지 않았습니다\. 새로 예약하고 승인 요청을 보내 주세요\./)).toBeInTheDocument();
    expect(screen.getAllByText('승인 없음(2인 승인 필요)').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '지금 다시 예약' })).toBeInTheDocument();
  });

  it('정책 꺼짐이면 승인 상태 글자를 만들지 않는다', async () => {
    mockApprovalStatus.mockResolvedValue(makePolicyStatus({ policy: { required: false, ttlHours: 24 } }));
    mockDetail.mockResolvedValue(detail());
    renderPage();
    await screen.findByRole('button', { name: '시각/메모 수정' });
    expect(screen.queryByText(/승인 요청 필요/)).toBeNull();
  });
});
