import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { Chatbot, EnvironmentStatus, VersionCurrentStatus } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { EnvironmentTab } from './EnvironmentTab';

expect.extend(toHaveNoViolations);

const mockGetStatus = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    getStatus: (...args: unknown[]) => mockGetStatus(...args),
    enablePreview: vi.fn(),
    enable: vi.fn(),
    disablePreview: vi.fn(),
    disable: vi.fn(),
    promote: vi.fn(),
    prodPreview: vi.fn(),
    prodSwitch: vi.fn(),
    prodRollback: vi.fn(),
    history: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    updateGate: vi.fn(),
  },
}));

const mockCurrent = vi.fn();
vi.mock('../../../api/versions', () => ({
  versionsApi: {
    current: (...args: unknown[]) => mockCurrent(...args),
  },
}));

const mockTestSetsList = vi.fn();
vi.mock('../../../api/validation', () => ({
  testSetsApi: {
    list: (...args: unknown[]) => mockTestSetsList(...args),
  },
}));

let permissions = new Set<string>(['chatbot:read', 'dialogue:read', 'chatbot:deploy', 'dialogue:write', 'chatbot:write']);
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => permissions.has(p) }),
}));

const CHATBOT: Chatbot = {
  id: 'bot-1',
  name: '고객센터 봇',
  slug: 'bot-1',
  status: 'ACTIVE',
  groupId: null,
  description: null,
  avatarUrl: null,
} as unknown as Chatbot;

function makeEnvironmentStatus(overrides: Partial<Extract<EnvironmentStatus, { enabled: true }>> = {}): EnvironmentStatus {
  return {
    enabled: true,
    enabledAt: new Date('2026-09-20T00:00:00.000Z'),
    prod: {
      versionId: 'ver-43',
      versionNo: 43,
      capturedAt: new Date('2026-09-20T00:00:00.000Z'),
      label: null,
      switchedAt: new Date('2026-09-25T05:02:00.000Z'),
      legacyTiebreak: false,
      readFailed: false,
      semanticPending: 0,
    },
    staging: {
      versionId: 'ver-44',
      versionNo: 44,
      capturedAt: new Date('2026-09-24T06:10:00.000Z'),
      label: null,
      legacyTiebreak: false,
      semanticPending: 0,
    },
    draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
    gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
    activeSwitchSchedule: null,
    ...overrides,
  } as EnvironmentStatus;
}

function makeCurrentStatus(overrides: Partial<VersionCurrentStatus> = {}): VersionCurrentStatus {
  return {
    contentHash: 'a'.repeat(64),
    counts: { intents: 0, keywords: 0, homonyms: 0, dialogNodes: 0, contexts: 0, faqs: 0 },
    latestVersion: null,
    hasUnsavedChanges: false,
    ...overrides,
  };
}

const mockRefresh = vi.fn();
let outletEnvironmentStatus: EnvironmentStatus | null = null;
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => ({
    chatbot: CHATBOT,
    reload: vi.fn(),
    setUnsavedGuard: vi.fn(),
    learningSummary: null,
    refreshLearningSummary: vi.fn(),
    environmentStatus: outletEnvironmentStatus,
    refreshEnvironmentStatus: mockRefresh,
  }),
}));

function renderTab(initialEntry = '/chatbots/bot-1/environment'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <EnvironmentTab />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('EnvironmentTab', () => {
  beforeEach(() => {
    mockGetStatus.mockReset();
    mockCurrent.mockReset().mockResolvedValue(makeCurrentStatus());
    mockRefresh.mockReset();
    mockTestSetsList.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    permissions = new Set(['chatbot:read', 'dialogue:read', 'chatbot:deploy', 'dialogue:write', 'chatbot:write']);
    outletEnvironmentStatus = null;
  });

  it('모드 꺼짐이면 설명 문구와 "환경 분리 사용..." 버튼을 렌더한다', async () => {
    outletEnvironmentStatus = { enabled: false, gate: null };
    renderTab();

    await screen.findByText('이 챗봇은 환경 분리를 사용하지 않습니다.');
    expect(screen.getByRole('button', { name: '환경 분리 사용...' })).toBeInTheDocument();
  });

  it('chatbot:deploy 권한이 없으면 모드 꺼짐 화면에 켜기 버튼이 렌더되지 않는다(§6)', async () => {
    permissions = new Set(['chatbot:read', 'dialogue:read']);
    outletEnvironmentStatus = { enabled: false, gate: null };
    renderTab();

    await screen.findByText('이 챗봇은 환경 분리를 사용하지 않습니다.');
    expect(screen.queryByRole('button', { name: '환경 분리 사용...' })).not.toBeInTheDocument();
  });

  it('모드 켜짐이면 초안/스테이징/운영 3단 카드를 렌더한다', async () => {
    outletEnvironmentStatus = makeEnvironmentStatus();
    renderTab();

    await screen.findByText('v43');
    expect(screen.getByText('v44')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '환경 분리 끄기...' })).toBeInTheDocument();
  });

  it('chatbot:deploy 권한이 없으면 쓰기 버튼이 하나도 렌더되지 않는다(VIEWER, §6)', async () => {
    permissions = new Set(['chatbot:read', 'dialogue:read']);
    outletEnvironmentStatus = makeEnvironmentStatus();
    renderTab();

    await screen.findByText('v43');
    expect(screen.queryByRole('button', { name: '환경 분리 끄기...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '운영 전환 미리보기...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '직전 버전으로 되돌리기...' })).not.toBeInTheDocument();
    // 스테이징 승격은 dialogue:write + chatbot:write만 있으면(편집자) 가능 — VIEWER는 렌더되지 않는다.
    expect(screen.queryByRole('button', { name: '스테이징으로 승격' })).not.toBeInTheDocument();
  });

  it('편집자(dialogue:write+chatbot:write, chatbot:deploy 없음)는 승격 버튼은 보이지만 전환/끄기 버튼은 보이지 않는다(P-4 (2))', async () => {
    permissions = new Set(['chatbot:read', 'dialogue:read', 'dialogue:write', 'chatbot:write']);
    outletEnvironmentStatus = makeEnvironmentStatus();
    renderTab();

    await screen.findByText('v43');
    expect(screen.getByRole('button', { name: '스테이징으로 승격' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '환경 분리 끄기...' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '운영 전환 미리보기...' })).not.toBeInTheDocument();
  });

  it('예약된 전환이 있으면 배너와 예약 배포 링크를 보여준다', async () => {
    outletEnvironmentStatus = makeEnvironmentStatus({
      activeSwitchSchedule: { scheduleId: 'sch-1', scheduledAt: new Date('2026-10-01T00:00:00.000Z'), targetVersionNo: 45, status: 'HELD' },
    });
    const { container } = renderTab();

    await screen.findByText('v43');
    const banner = container.querySelector('.environment-active-schedule');
    expect(banner?.textContent).toContain('예약된 전환:');
    expect(banner?.textContent).toContain('보류');
    expect(screen.getByRole('link', { name: '예약 배포에서 보기 →' })).toHaveAttribute('href', '/chatbots/bot-1/deploy-schedules/sch-1');
  });

  it('운영 카드 읽기 실패(readFailed)면 오류 문구를 보여준다(EX-EN-1)', async () => {
    outletEnvironmentStatus = makeEnvironmentStatus({ prod: { ...makeEnvironmentStatus().prod, readFailed: true } as never });
    renderTab();

    await screen.findByText('운영 버전을 읽을 수 없습니다.');
  });

  it('EN1 모드 켜짐 — axe 스캔 위반 0건', async () => {
    outletEnvironmentStatus = makeEnvironmentStatus();
    const { container } = renderTab();
    await screen.findByText('v43');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('EN1 모드 꺼짐 — axe 스캔 위반 0건', async () => {
    outletEnvironmentStatus = { enabled: false, gate: null };
    const { container } = renderTab();
    await screen.findByText('이 챗봇은 환경 분리를 사용하지 않습니다.');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('dialogue:read 권한이 없으면 "모드 꺼짐" 대신 접근 불가 안내를 렌더한다(§6, 1차 편차 (b))', async () => {
    // AGENT처럼 chatbot:read는 있지만 dialogue:read가 없는 사용자 — 이전엔 environmentStatus가 항상
    // null로 남아 "이 챗봇은 환경 분리를 사용하지 않습니다."로 잘못 보였다.
    permissions = new Set(['chatbot:read']);
    outletEnvironmentStatus = null;
    renderTab();

    expect(await screen.findByRole('heading', { name: '이 페이지에 접근할 권한이 없습니다' })).toBeInTheDocument();
    expect(screen.queryByText('이 챗봇은 환경 분리를 사용하지 않습니다.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '환경 분리 사용...' })).not.toBeInTheDocument();
  });

  it('dialogue:read 권한이 없으면 모드 켜짐 상태여도 접근 불가 안내를 렌더한다(§6, 1차 편차 (b))', async () => {
    permissions = new Set(['chatbot:read']);
    outletEnvironmentStatus = makeEnvironmentStatus();
    renderTab();

    expect(await screen.findByRole('heading', { name: '이 페이지에 접근할 권한이 없습니다' })).toBeInTheDocument();
    expect(screen.queryByText('v43')).not.toBeInTheDocument();
  });

  it('게이트가 차단 모드이면 요약 줄에 TC 세트 이름을 보여준다(1회 조회, §4.6(d))', async () => {
    mockTestSetsList.mockResolvedValue({
      items: [{ id: 'set-1', name: '정기 회귀' }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    outletEnvironmentStatus = makeEnvironmentStatus({
      gate: { mode: 'BLOCK', testSetId: 'set-1', minPassRate: 95, validHours: 24 },
    });
    renderTab();

    await waitFor(() => expect(screen.getAllByText('게이트: 차단(정기 회귀 · 95% 이상)').length).toBeGreaterThan(0));
    expect(mockTestSetsList).toHaveBeenCalledTimes(1);
  });

  it('스테이징 승격 확인창은 current.stagingDiff의 변경 요약을 보여준다(§4.5)', async () => {
    const user = userEvent.setup();
    outletEnvironmentStatus = makeEnvironmentStatus();
    mockCurrent.mockResolvedValue(
      makeCurrentStatus({
        stagingDiff: { rows: [{ kind: 'FAQ', added: 0, removed: 3, modified: 1 }], totalChanged: 4, identical: false },
      }),
    );
    renderTab();

    await user.click(await screen.findByRole('button', { name: '스테이징으로 승격' }));
    expect(await screen.findByText('− FAQ 3 ~ FAQ 1')).toBeInTheDocument();
  });

  it('?openGate=1로 진입하면 게이트 설정 섹션이 펼쳐진 채로 시작한다(§4.6(c))', async () => {
    outletEnvironmentStatus = makeEnvironmentStatus();
    renderTab('/chatbots/bot-1/environment?openGate=1');

    await screen.findByText('v43');
    const toggle = screen.getByRole('button', { name: /게이트 설정/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('모드')).toBeInTheDocument();
  });
});
