import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { Chatbot, EnvironmentStatus, VersionCurrentStatus } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeApproval, makePolicyStatus } from '../guardrails/testFixtures';
import { EnvironmentTab } from './EnvironmentTab';

expect.extend(toHaveNoViolations);

const mockGetStatus = vi.fn();
const mockHistory = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    getStatus: (...a: unknown[]) => mockGetStatus(...a),
    enablePreview: vi.fn(),
    enable: vi.fn(),
    disablePreview: vi.fn(),
    disable: vi.fn(),
    promote: vi.fn(),
    prodPreview: vi.fn(),
    prodSwitch: vi.fn(),
    prodRollback: vi.fn(),
    history: (...a: unknown[]) => mockHistory(...a),
    updateGate: vi.fn(),
  },
}));
const mockApprovalStatus = vi.fn();
vi.mock('../../../api/switchApprovals', () => ({
  switchApprovalsApi: { getStatus: (...a: unknown[]) => mockApprovalStatus(...a), updatePolicy: vi.fn(), cancel: vi.fn(), createRequest: vi.fn() },
}));
vi.mock('../../../api/versions', () => ({ versionsApi: { current: vi.fn().mockResolvedValue({ contentHash: 'a'.repeat(64), counts: {}, latestVersion: null, hasUnsavedChanges: false } as unknown as VersionCurrentStatus) } }));
vi.mock('../../../api/validation', () => ({ testSetsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) } }));

let permissions = new Set<string>(['chatbot:read', 'dialogue:read', 'chatbot:deploy', 'dialogue:write', 'chatbot:write']);
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => permissions.has(p), user: { id: 'user-lee', email: 'lee@example.com', governanceModeOn: false } }),
}));

const CHATBOT = { id: 'bot-1', name: '고객센터 봇', slug: 'bot-1', status: 'ACTIVE', groupId: null, description: null, avatarUrl: null } as unknown as Chatbot;

function envStatus(extra: Record<string, unknown> = {}): EnvironmentStatus {
  return {
    enabled: true,
    enabledAt: new Date('2026-09-20T00:00:00.000Z'),
    prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date('2026-09-20T00:00:00.000Z'), label: null, switchedAt: new Date('2026-09-25T05:02:00.000Z'), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
    staging: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date('2026-09-24T06:10:00.000Z'), label: null, legacyTiebreak: false, semanticPending: 0 },
    draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
    gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
    activeSwitchSchedule: null,
    ...extra,
  } as EnvironmentStatus;
}

let outletStatus: EnvironmentStatus | null = envStatus();
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => ({
    chatbot: CHATBOT,
    reload: vi.fn(),
    setUnsavedGuard: vi.fn(),
    learningSummary: null,
    refreshLearningSummary: vi.fn(),
    environmentStatus: outletStatus,
    refreshEnvironmentStatus: vi.fn(),
  }),
}));

function renderTab(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <EnvironmentTab />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockGetStatus.mockReset();
  mockHistory.mockReset();
  mockApprovalStatus.mockReset();
  mockHistory.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  permissions = new Set(['chatbot:read', 'dialogue:read', 'chatbot:deploy', 'dialogue:write', 'chatbot:write']);
  outletStatus = envStatus();
});

describe('환경 탭 — 운영 전환 2인 승인 보강(AP-0)', () => {
  it('정책 켜짐: 환경 분리 끄기는 aria-disabled + 🔒 + 사유 글자이고 눌러도 대화상자가 열리지 않으며, 설정 절로 가는 링크가 있다', async () => {
    const user = userEvent.setup();
    outletStatus = envStatus({ approval: { required: true, ttlHours: 24 } });
    mockApprovalStatus.mockResolvedValue(makePolicyStatus());
    renderTab();
    const disable = await screen.findByRole('button', { name: /환경 분리 끄기/ });
    expect(disable).toHaveAttribute('aria-disabled', 'true');
    expect(disable).not.toBeDisabled();
    expect(disable).toHaveAccessibleDescription(/운영 전환 2인 승인이 켜져 있어 환경 분리를 끌 수 없습니다\. 먼저 아래 ‘운영 전환 2인 승인’을 끄세요\./);
    await user.click(disable);
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('link', { name: '2인 승인 설정으로 이동' }));
    expect(await screen.findByRole('heading', { name: '운영 전환 2인 승인' })).toHaveFocus();
  });

  it('정책 켜짐: 스테이징 카드 버튼 문구가 "승인 요청"으로 바뀌고 되돌리기 아래에 긴급 복구 힌트가 붙는다', async () => {
    outletStatus = envStatus({ approval: { required: true, ttlHours: 24 } });
    mockApprovalStatus.mockResolvedValue(makePolicyStatus());
    renderTab();
    expect(await screen.findByRole('button', { name: '운영 전환 승인 요청...' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '예약 전환 + 승인 요청...' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '운영 전환 미리보기...' })).toBeNull();
    const rollback = screen.getByRole('button', { name: '직전 버전으로 되돌리기...' });
    expect(rollback).toHaveAccessibleDescription('긴급 복구용 — 승인 없이 바로 실행되고 기록이 남습니다.');
  });

  it('대기 요청이 있으면 제안 컨테이너(승인 전) 카드와 설정 패널을 3카드와 게이트 사이에 그린다', async () => {
    outletStatus = envStatus({ approval: { required: true, ttlHours: 24 } });
    mockApprovalStatus.mockResolvedValue(makePolicyStatus({ pending: makeApproval({ canApprove: false, canCancel: true }) }));
    renderTab();
    expect(await screen.findByText('승인 대기 요청 (제안 · 승인 전)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '운영 전환 2인 승인' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '요청 취소' })).toBeInTheDocument();
  });

  it('정책 꺼짐: 기존 버튼 문구를 그대로 쓰고 패널은 꺼짐 상태와 켜기 스위치를 보인다', async () => {
    mockApprovalStatus.mockResolvedValue(makePolicyStatus({ policy: { required: false, ttlHours: 24 } }));
    renderTab();
    expect(await screen.findByRole('button', { name: '운영 전환 미리보기...' })).toBeInTheDocument();
    expect(await screen.findByText(/꺼짐 — 운영 전환은 배포 권한이 있는 한 사람의 확인만으로 실행됩니다/)).toBeInTheDocument();
    const disable = screen.getByRole('button', { name: '환경 분리 끄기...' });
    expect(disable).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText('승인 대기 요청 (제안 · 승인 전)')).toBeNull();
  });

  it('정책 조회가 실패해도 패널 자리만 축약 오류로 바뀌고 전환 흐름 버튼은 그대로다(재시도 가능)', async () => {
    const user = userEvent.setup();
    mockApprovalStatus.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(makePolicyStatus({ policy: { required: false, ttlHours: 24 } }));
    renderTab();
    const alert = await screen.findByText('2인 승인 정보를 불러오지 못했습니다');
    expect(alert).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '운영 전환 미리보기...' })).toBeInTheDocument();
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '운영 전환 2인 승인' })).toBeInTheDocument());
  });

  it('조회 권한(chatbot:read·dialogue:read)이 있어도 배포 권한이 없으면 패널은 읽기 전용이다', async () => {
    permissions = new Set(['chatbot:read', 'dialogue:read']);
    mockApprovalStatus.mockResolvedValue(makePolicyStatus());
    renderTab();
    expect(await screen.findByText('읽기 전용입니다. 정책을 바꾸려면 배포 권한이 필요합니다.')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('axe: 정책 켜짐 + 대기 요청 화면에 구조적 접근성 위반이 없다', async () => {
    outletStatus = envStatus({ approval: { required: true, ttlHours: 24 } });
    mockApprovalStatus.mockResolvedValue(makePolicyStatus({ pending: makeApproval(), recent: [makeApproval({ id: 'r2', status: 'APPROVED', outcome: 'APPLIED', decidedBy: { id: 'u', email: 'park@example.com' } })] }));
    const { container } = renderTab();
    await screen.findByText('승인 대기 요청 (제안 · 승인 전)');
    expect(await axe(container, { rules: { region: { enabled: false } } })).toHaveNoViolations();
  });
});
