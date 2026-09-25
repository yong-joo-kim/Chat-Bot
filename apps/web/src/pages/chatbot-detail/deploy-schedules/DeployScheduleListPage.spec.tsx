import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DeployScheduleListItem, DeployScheduleMeta } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { MESSAGES } from '../../../constants/messages';
import { makeChatbot } from '../../../test/fixtures';
import { resetDeployScheduleMetaCacheForTests } from '../../../lib/useDeployScheduleMeta';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { DeployScheduleListPage } from './DeployScheduleListPage';

const chatbot = makeChatbot();
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
const mockMeta = vi.fn();
const mockAcknowledge = vi.fn();
const mockCancel = vi.fn();
const mockDetail = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    list: (...args: unknown[]) => mockList(...args),
    meta: (...args: unknown[]) => mockMeta(...args),
    acknowledge: (...args: unknown[]) => mockAcknowledge(...args),
    cancel: (...args: unknown[]) => mockCancel(...args),
    preview: vi.fn(),
    create: vi.fn(),
    detail: (...args: unknown[]) => mockDetail(...args),
  },
}));

function baseMeta(overrides: Partial<DeployScheduleMeta> = {}): DeployScheduleMeta {
  return {
    timezone: 'Asia/Seoul',
    timezoneFallback: false,
    engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
    limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
    ...overrides,
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

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/chatbots/${chatbot.id}/deploy-schedules`]}>
      <ToastProvider>
        <DeployScheduleListPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** S1 — 챗봇별 예약 목록(`scheduled-deploy-ui-spec.md` §4.1). 상태 배지·폴링 조건·권한별 렌더를 검증한다. */
describe('DeployScheduleListPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockMeta.mockReset();
    mockAcknowledge.mockReset();
    mockCancel.mockReset();
    mockDetail.mockReset();
    mockMeta.mockResolvedValue(baseMeta());
    mockUseAuth.mockReturnValue({ can: () => true });
    resetDeployScheduleMetaCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('상태별 배지가 아이콘+텍스트로 렌더된다(§3.3, 색상 단독 아님)', async () => {
    mockList.mockResolvedValue({
      items: [
        makeItem({ id: 's-pending', status: 'PENDING' }),
        makeItem({ id: 's-running', status: 'RUNNING', action: 'PUBLISH' }),
        makeItem({ id: 's-held', status: 'HELD', heldReason: 'PREDECESSOR_FAILED', needsAttention: true }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    });
    renderPage();

    expect(await screen.findByText('대기')).toBeInTheDocument();
    expect(screen.getByText('실행 중')).toBeInTheDocument();
    expect(screen.getByText('보류')).toBeInTheDocument();
    expect(screen.getByText('선행 예약 실패로 보류됨')).toBeInTheDocument();
    expect(screen.getByText(MESSAGES.deploySchedules.needsAttentionFlag)).toBeInTheDocument();
  });

  // 실제 interval을 흘려보내는 대신 `window.setInterval` 호출 여부/간격을 스파이로 검증한다
  // (fake timer + 비동기 mock의 마이크로태스크 경합으로 전체 스위트 동시 실행 시 플레이키해지는 것을 피함).
  it('RUNNING 행이 있으면 5초 간격 폴링 타이머가 등록된다(§9 폴링 정책)', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockList.mockResolvedValue({ items: [makeItem({ status: 'RUNNING' })], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findByText('실행 중');
    await waitFor(() => expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000));
    setIntervalSpy.mockRestore();
  });

  it('재시도 중(PENDING·attemptCount≥1) 행도 폴링 대상이다', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockList.mockResolvedValue({ items: [makeItem({ status: 'PENDING', attemptCount: 1, lastTransientReason: 'DB_BUSY' })], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findByText('대기(재시도 중)');
    await waitFor(() => expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000));
    setIntervalSpy.mockRestore();
  });

  it('종결 상태(SUCCEEDED/CANCELLED)만 있으면 폴링 타이머를 등록하지 않는다', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockList.mockResolvedValue({
      items: [makeItem({ status: 'SUCCEEDED', outcome: 'APPLIED' }), makeItem({ id: 's-2', status: 'CANCELLED' })],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    renderPage();

    await screen.findByText('성공');
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 5000);
    setIntervalSpy.mockRestore();
  });

  it('M-1: 행 시각에 meta 기준 시간대 라벨이 병기된다(하드코딩 Asia/Seoul formatDateTime 대신)', async () => {
    mockMeta.mockResolvedValue(baseMeta({ timezone: 'Asia/Seoul' }));
    mockList.mockResolvedValue({ items: [makeItem({ status: 'PENDING' })], total: 1, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText(/\(KST, UTC\+9\)/)).toBeInTheDocument();
  });

  it('M-3: 동작별 필요 권한만 보유한 사용자는 해당 동작의 행에서만 관리 버튼을 본다(포괄 canManage 아님)', async () => {
    // channel:write만 보유 — SET_WEB_CHANNEL 행은 관리 가능, RESTORE_VERSION 행은 불가.
    mockUseAuth.mockReturnValue({ can: (p: string) => p === 'channel:write' });
    mockList.mockResolvedValue({
      items: [
        makeItem({ id: 's-restore', status: 'PENDING', action: 'RESTORE_VERSION' }),
        makeItem({ id: 's-channel', status: 'PENDING', action: 'SET_WEB_CHANNEL', targetVersionId: null, targetVersionNo: null, channelEnabled: true }),
      ],
      total: 2,
      page: 1,
      pageSize: 20,
    });
    renderPage();

    await screen.findByText('웹 채널 열기');
    // "취소" 버튼이 정확히 1개(SET_WEB_CHANNEL 행)만 렌더된다 — RESTORE_VERSION 행에는 없다.
    expect(screen.getAllByRole('button', { name: '취소' })).toHaveLength(1);
  });

  it('VIEWER(관리 권한 없음)는 "+ 예약 만들기"·"취소"·"확인함" 버튼이 렌더되지 않는다(§6)', async () => {
    mockUseAuth.mockReturnValue({ can: () => false });
    mockList.mockResolvedValue({
      items: [makeItem({ status: 'FAILED', failureReason: 'STATE_CHANGED', needsAttention: true })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPage();

    await screen.findByText('실패');
    expect(screen.queryByRole('button', { name: '+ 예약 만들기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '확인함' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });

  it('관리 권한이 있으면 FAILED/MISSED/HELD 행에 "확인함" 버튼이 렌더되고 클릭 시 acknowledge가 호출된다', async () => {
    mockList.mockResolvedValue({
      items: [makeItem({ status: 'FAILED', failureReason: 'STATE_CHANGED', needsAttention: true })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mockAcknowledge.mockResolvedValue(makeItem({ status: 'FAILED', needsAttention: false }));
    renderPage();

    const button = await screen.findByRole('button', { name: '확인함' });
    button.click();
    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledWith(chatbot.id, 'sched-1'));
  });

  it('H-1: "지금 다시 예약"은 목록의 targetVersionId로 곧바로 진입하고 상세를 추가 조회하지 않는다', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      items: [makeItem({ status: 'FAILED', failureReason: 'STATE_CHANGED', needsAttention: true, targetVersionId: 'ver-99', targetVersionNo: 99 })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    renderPage();

    const retryButton = await screen.findByRole('button', { name: '지금 다시 예약' });
    await user.click(retryButton);

    expect(await screen.findByText('대상: v99')).toBeInTheDocument();
    expect(mockDetail).not.toHaveBeenCalled();
  });
});
