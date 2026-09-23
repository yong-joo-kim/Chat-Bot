import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DeployScheduleDetail, DeployScheduleListItem, DeployScheduleMeta } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import { resetDeployScheduleMetaCacheForTests } from '../../../lib/useDeployScheduleMeta';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { DeployScheduleListPage } from './DeployScheduleListPage';
import { DeployScheduleDetailPage } from './DeployScheduleDetailPage';

expect.extend(toHaveNoViolations);

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

const mockList = vi.fn();
const mockDetail = vi.fn();
const mockMeta = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    list: (...args: unknown[]) => mockList(...args),
    meta: (...args: unknown[]) => mockMeta(...args),
    detail: (...args: unknown[]) => mockDetail(...args),
    acknowledge: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    update: vi.fn(),
    stateCheck: vi.fn(),
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

function makeItem(overrides: Partial<DeployScheduleListItem> = {}): DeployScheduleListItem {
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
    ...overrides,
  };
}

function makeDetail(overrides: Partial<DeployScheduleDetail> = {}): DeployScheduleDetail {
  return {
    ...makeItem(),
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

const AXE_OPTIONS = { rules: { 'color-contrast': { enabled: false } } };

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). 이 그룹이 신설한 화면(S1 목록,
 * S2 상세)은 이전까지 axe 스캔이 전혀 없었다(`UIUX_준수기준.md`/설계서 NFR-DA4). 기존 axe 스위트
 * 패턴(`AuditLogsPage.a11y.spec.tsx` 등)을 그대로 재사용한다.
 */
describe('DeployScheduleListPage/DeployScheduleDetailPage — axe 접근성 스캔(NFR-DA4)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockDetail.mockReset();
    mockMeta.mockReset();
    mockMeta.mockResolvedValue(baseMeta());
    mockUseAuth.mockReturnValue({ can: () => true });
    resetDeployScheduleMetaCacheForTests();
  });

  it('S1 목록 — 여러 상태 배지·"확인 필요"·관리 버튼이 섞인 화면에 구조적 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({
      items: [
        makeItem({ id: 's-pending', status: 'PENDING' }),
        makeItem({ id: 's-held', status: 'HELD', heldReason: 'PREDECESSOR_FAILED', needsAttention: true }),
        makeItem({ id: 's-failed', status: 'FAILED', failureReason: 'STATE_CHANGED', needsAttention: true }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <DeployScheduleListPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('대기');

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('S1 목록 — 빈 상태에도 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <DeployScheduleListPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText(/예약된 배포가 없습니다/);

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('S2 상세 — 준비도 경고·결과 요약이 있는 화면에 접근성 위반이 없다', async () => {
    mockDetail.mockResolvedValue(
      makeDetail({
        status: 'SUCCEEDED',
        outcome: 'APPLIED',
        resultSummary: { kind: 'RESTORE', backupVersionNo: 33, backupVersionId: 'ver-33', counts: {}, reindexWasRunning: false, classifierDeleted: false },
        readinessWarnings: [{ code: 'NO_RECENT_TEST_RUN' }],
      }),
    );

    const { container } = render(
      <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/deploy-schedules/sched-1`]}>
        <ToastProvider>
          <Routes>
            <Route path="/chatbots/:chatbotId/deploy-schedules/:scheduleId" element={<DeployScheduleDetailPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('성공');

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('S2 상세 — HELD(보류 사유 표시)에도 접근성 위반이 없다', async () => {
    mockDetail.mockResolvedValue(makeDetail({ status: 'HELD', heldReason: 'PREDECESSOR_FAILED', needsAttention: true }));

    const { container } = render(
      <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/deploy-schedules/sched-1`]}>
        <ToastProvider>
          <Routes>
            <Route path="/chatbots/:chatbotId/deploy-schedules/:scheduleId" element={<DeployScheduleDetailPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('보류');

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});
