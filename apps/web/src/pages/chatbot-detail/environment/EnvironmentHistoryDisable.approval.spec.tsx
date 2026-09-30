import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { DisableEnvironmentPreviewResponse, EnvironmentSwitchLogItem } from '@chat-bot/shared-types';
import { ApiError } from '../../../api/client';
import { EnvironmentDisableDialog } from './EnvironmentDisableDialog';
import { EnvironmentHistoryTable } from './EnvironmentHistoryTable';

const mockHistory = vi.fn();
const mockDisablePreview = vi.fn();
const mockDisable = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    history: (...a: unknown[]) => mockHistory(...a),
    disablePreview: (...a: unknown[]) => mockDisablePreview(...a),
    disable: (...a: unknown[]) => mockDisable(...a),
  },
}));
vi.mock('../../../api/versions', () => ({ versionsApi: { restorePreview: vi.fn(), restore: vi.fn() } }));

const item = (overrides: Partial<EnvironmentSwitchLogItem> = {}): EnvironmentSwitchLogItem => ({
  id: 'log-1',
  environment: 'PROD',
  method: 'IMMEDIATE',
  fromVersionNo: 43,
  toVersionNo: 44,
  toVersionId: 'ver-44',
  deployScheduleId: null,
  disableMode: null,
  actorEmail: 'park@example.com',
  reason: null,
  createdAt: new Date('2026-09-30T05:00:00.000Z'),
  ...overrides,
});

beforeEach(() => {
  mockHistory.mockReset();
  mockDisablePreview.mockReset();
  mockDisable.mockReset();
});

describe('EnvironmentHistoryTable — 승인 표식(§9.11)', () => {
  const renderTable = (canDeploy = true): ReturnType<typeof render> =>
    render(
      <MemoryRouter>
        <EnvironmentHistoryTable chatbotId="bot-1" canDeploy={canDeploy} currentProdVersionId="ver-44" onRollbackRequested={vi.fn()} onScheduleSwitchRequested={vi.fn()} />
      </MemoryRouter>,
    );

  it('approvalMode가 있으면 방식 셀에 글자 배지를 덧붙이고 승인 전환은 요청 상세 링크를 준다', async () => {
    mockHistory.mockResolvedValue({
      items: [
        item({ id: 'a', approvalMode: 'APPROVED', approvalRequestId: 'b0000000-0000-4000-8000-000000000001' }),
        item({ id: 'b', approvalMode: 'SOLO_ROLLBACK', toVersionNo: 43, fromVersionNo: 44, toVersionId: 'ver-43' }),
        item({ id: 'c' }),
      ],
      total: 3,
      page: 1,
      pageSize: 20,
    });
    renderTable();
    await screen.findAllByText('2인 승인');
    expect(screen.getAllByText('2인 승인').length).toBeGreaterThan(0);
    expect(screen.getAllByText('승인 없이 되돌림').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'v44 승인 요청 보기' })[0]).toHaveAttribute('href', '/environment-approvals/bot-1/b0000000-0000-4000-8000-000000000001');
  });

  it('배포 권한이 없으면 요청 링크는 만들지 않고 배지 글자만 남는다', async () => {
    mockHistory.mockResolvedValue({ items: [item({ approvalMode: 'APPROVED', approvalRequestId: 'b0000000-0000-4000-8000-000000000001' })], total: 1, page: 1, pageSize: 20 });
    renderTable(false);
    await screen.findAllByText('2인 승인');
    expect(screen.queryByRole('link', { name: /승인 요청 보기/ })).toBeNull();
  });

  it('approvalMode가 없으면 기존과 같다(배지 없음)', async () => {
    mockHistory.mockResolvedValue({ items: [item()], total: 1, page: 1, pageSize: 20 });
    renderTable();
    await screen.findAllByText('운영');
    expect(screen.queryByText('2인 승인')).toBeNull();
    expect(screen.queryByText('승인 없이 되돌림')).toBeNull();
  });
});

describe('EnvironmentDisableDialog — 2인 승인 켜진 동안 끄기 거부(§9.9 방어)', () => {
  const preview = (overrides: Partial<DisableEnvironmentPreviewResponse> = {}): DisableEnvironmentPreviewResponse =>
    ({
      draftDiffersFromProd: false,
      prod: { versionId: 'ver-43', versionNo: 43 },
      draftContentHash: 'a'.repeat(64),
      diffSummary: { rows: [], totalChanged: 0, identical: true },
      cancelledSwitchSchedules: 0,
      potentialTieShift: false,
      ...overrides,
    }) as DisableEnvironmentPreviewResponse;

  it('미리보기에 approvalPolicyActive가 있으면 확정 버튼 없이 안내와 확인 버튼만 보인다', async () => {
    mockDisablePreview.mockResolvedValue(preview({ approvalPolicyActive: true }));
    render(<EnvironmentDisableDialog chatbotId="bot-1" isOpen onClose={vi.fn()} onDisabled={vi.fn()} />);
    expect(await screen.findByText('운영 전환 2인 승인이 켜져 있어 환경 분리를 끌 수 없습니다. 먼저 2인 승인을 꺼 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /환경 분리 끄기|끄기/ })).toBeNull();
  });

  it('확정 시 409 ENV_APPROVAL_REQUIRED(POLICY_ACTIVE)를 받으면 같은 안내를 오류로 보이고 확정 버튼을 없앤다', async () => {
    const user = userEvent.setup();
    mockDisablePreview.mockResolvedValue(preview());
    mockDisable.mockRejectedValue(new ApiError(409, 'x', 'ENV_APPROVAL_REQUIRED' as never, [{ field: 'reason', message: 'POLICY_ACTIVE' }]));
    render(<EnvironmentDisableDialog chatbotId="bot-1" isOpen onClose={vi.fn()} onDisabled={vi.fn()} />);
    const confirm = await screen.findByRole('button', { name: /끄기|종료|확인/ });
    void confirm;
    const buttons = await screen.findAllByRole('button');
    const primary = buttons.find((b) => b.classList.contains('btn-primary')) as HTMLElement;
    await user.click(primary);
    await waitFor(() => expect(screen.getByText('운영 전환 2인 승인이 켜져 있어 환경 분리를 끌 수 없습니다. 먼저 2인 승인을 꺼 주세요.')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /끄기|종료/ })).toBeNull();
  });
});
