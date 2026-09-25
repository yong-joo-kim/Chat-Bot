import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chatbot } from '@chat-bot/shared-types';
import { ToastProvider } from '../components/Toast';
import { UnsavedGuardProvider } from '../context/UnsavedGuardContext';
import { resetDeployScheduleMetaCacheForTests } from '../lib/useDeployScheduleMeta';
import { ChatbotDetailLayout, useChatbotDetailContext } from './ChatbotDetailLayout';

const chatbot: Chatbot = {
  id: '33333333-3333-4333-8333-333333333333',
  groupId: null,
  name: '고객센터 봇',
  avatarUrl: undefined,
  description: undefined,
  slug: 'bot-1',
  status: 'ACTIVE',
  skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-18T00:00:00.000Z'),
};

const mockFindOne = vi.fn();
vi.mock('../api/chatbots', () => ({
  chatbotsApi: { findOne: (...args: unknown[]) => mockFindOne(...args), updateStatus: vi.fn(), archive: vi.fn() },
}));

vi.mock('../api/groups', () => ({ groupsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }) } }));

const mockDeployScheduleSummary = vi.fn();
const mockDeployScheduleMeta = vi.fn();
vi.mock('../api/deploySchedules', () => ({
  deploySchedulesApi: {
    summary: (...args: unknown[]) => mockDeployScheduleSummary(...args),
    meta: (...args: unknown[]) => mockDeployScheduleMeta(...args),
  },
}));

const mockLearningSummary = vi.fn();
vi.mock('../api/learning', () => ({
  learningApi: { summary: (...args: unknown[]) => mockLearningSummary(...args) },
}));

const mockGetStatus = vi.fn();
vi.mock('../api/environment', () => ({
  environmentApi: { getStatus: (...args: unknown[]) => mockGetStatus(...args) },
}));

let permissions = new Set<string>(['chatbot:read', 'chatbot:write', 'dialogue:read']);
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => permissions.has(p) }),
}));

function Probe(): JSX.Element {
  const { environmentStatus, refreshEnvironmentStatus } = useChatbotDetailContext();
  return (
    <div>
      <p>{environmentStatus === null ? '환경상태 없음' : environmentStatus.enabled ? '환경상태 켜짐' : '환경상태 꺼짐'}</p>
      <button type="button" onClick={refreshEnvironmentStatus}>
        새로고침
      </button>
    </div>
  );
}

function renderTree(initialPath: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <UnsavedGuardProvider>
          <Routes>
            <Route path="/chatbots/:chatbotId" element={<ChatbotDetailLayout />}>
              <Route path="dashboard" element={<Probe />} />
            </Route>
          </Routes>
        </UnsavedGuardProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * [신규 No.40] `ChatbotDetailContext.environmentStatus` — `learningSummary`와 동일한 관행(챗봇 상세
 * 마운트당 1회 조회, `dialogue:read` 권한 가드, chatbotId 변경 시 초기화)을 검증한다(§4.2·§9·§14 G-7).
 */
describe('ChatbotDetailLayout — environmentStatus 컨텍스트(No.40)', () => {
  beforeEach(() => {
    mockFindOne.mockReset().mockResolvedValue(chatbot);
    mockDeployScheduleSummary.mockReset().mockResolvedValue({ needsAttention: { byChatbot: [] } });
    mockDeployScheduleMeta.mockReset().mockResolvedValue({
      timezone: 'Asia/Seoul',
      timezoneFallback: false,
      engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
      limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
    });
    mockLearningSummary.mockReset().mockResolvedValue({ pendingCount: 0, limitReached: false, bySource: {} });
    mockGetStatus.mockReset();
    permissions = new Set(['chatbot:read', 'chatbot:write', 'dialogue:read']);
    resetDeployScheduleMetaCacheForTests();
  });

  it('챗봇 상세 마운트당 정확히 1회만 environmentApi.getStatus를 호출한다(폴링 없음)', async () => {
    mockGetStatus.mockResolvedValue({ enabled: false, gate: null });
    renderTree(`/chatbots/${chatbot.id}/dashboard`);

    await screen.findByText('환경상태 꺼짐');
    expect(mockGetStatus).toHaveBeenCalledTimes(1);
    expect(mockGetStatus).toHaveBeenCalledWith(chatbot.id);
  });

  it('dialogue:read 권한이 없으면 getStatus를 호출하지 않는다', async () => {
    permissions = new Set(['chatbot:read', 'chatbot:write']);
    renderTree(`/chatbots/${chatbot.id}/dashboard`);

    await screen.findByText('환경상태 없음');
    expect(mockGetStatus).not.toHaveBeenCalled();
  });

  it('refreshEnvironmentStatus를 호출하면 최신값을 다시 받아온다(변경 액션 뒤 갱신)', async () => {
    mockGetStatus.mockResolvedValueOnce({ enabled: false, gate: null }).mockResolvedValueOnce({
      enabled: true,
      enabledAt: new Date(),
      prod: { versionId: 'v1', versionNo: 1, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
      staging: null,
      draft: { contentHash: 'a'.repeat(64), sameAsProd: true, sameAsStaging: true },
      gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
      activeSwitchSchedule: null,
    });
    renderTree(`/chatbots/${chatbot.id}/dashboard`);
    await screen.findByText('환경상태 꺼짐');

    screen.getByRole('button', { name: '새로고침' }).click();
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalledTimes(2));
    await screen.findByText('환경상태 켜짐');
  });
});
