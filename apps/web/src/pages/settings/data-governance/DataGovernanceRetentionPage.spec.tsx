import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { RetentionPolicyResponse, RetentionPreviewResponse, RetentionTargetKind } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { DataGovernanceRetentionPage } from './DataGovernanceRetentionPage';

expect.extend(toHaveNoViolations);

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockPreview = vi.fn();
const mockCancelAllPending = vi.fn();
// [신규 No.45 2차] G1-b "챗봇별 재정의" 목록(`RetentionOverridesTable`)이 페이지 하단에서 호출한다.
const mockOverrides = vi.fn();
let mockCanWrite = true;

vi.mock('../../../api/governance', () => ({
  governanceApi: {
    retention: {
      get: (...args: unknown[]) => mockGet(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      preview: (...args: unknown[]) => mockPreview(...args),
      cancelAllPending: (...args: unknown[]) => mockCancelAllPending(...args),
      overrides: (...args: unknown[]) => mockOverrides(...args),
    },
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { governanceModeOn: true, permissions: mockCanWrite ? ['security:read', 'security:write'] : ['security:read'] },
    can: () => true,
  }),
}));

const BOUNDS = { minConversationDays: 7, minAuditDays: 365, maxDays: 3650, shortenGraceDays: 7 };
const KINDS: RetentionTargetKind[] = ['CONVERSATION_TEXT', 'UNANSWERED_CLOSED', 'SURVEY_FREE_TEXT', 'HANDOFF_TEXT', 'CALL_LOGS', 'AUDIT_LOGS'];

function makePolicy(overrides: Partial<RetentionPolicyResponse> = {}): RetentionPolicyResponse {
  return {
    scope: 'GLOBAL',
    kinds: KINDS.map((kind) => ({ kind, days: kind === 'AUDIT_LOGS' ? 1825 : 180, source: 'GLOBAL' })),
    bounds: BOUNDS,
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedByEmail: 'admin@chat-bot.local',
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DataGovernanceRetentionPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** G1-b — 보존 정책(전역, data-governance-ui-spec.md §3.2). */
describe('DataGovernanceRetentionPage', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockPreview.mockReset();
    mockCancelAllPending.mockReset();
    mockOverrides.mockReset();
    mockOverrides.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockCanWrite = true;
  });

  it('조회 성공 시 6종의 현재 유효값을 보여준다', async () => {
    mockGet.mockResolvedValue(makePolicy());
    renderPage();

    await screen.findByText('대화 로그 본문');
    expect(screen.getAllByText(/전역 따름\(현재 180일\)/).length).toBeGreaterThan(0);
  });

  it('security:write가 없으면 폼이 읽기 전용으로 disabled 되고 안내 문구가 뜬다(권한별 렌더)', async () => {
    mockCanWrite = false;
    mockGet.mockResolvedValue(makePolicy());
    renderPage();

    await screen.findByText('대화 로그 본문');
    expect(screen.getByText('이 값은 콘솔에서 바꿀 수 없습니다 — 서버 설정으로만 변경할 수 있습니다.')).toBeInTheDocument();
    const fieldset = screen.getByText('대화 로그 본문').closest('fieldset');
    expect(fieldset).toBeDisabled();
  });

  it('단축 미리보기 → 확인 문구 불일치면 저장이 막히고, 일치하면 confirmText와 함께 PUT한다(보존 단축 확인 흐름)', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(makePolicy());
    const preview: RetentionPreviewResponse = {
      items: [
        { kind: 'CONVERSATION_TEXT', currentDays: 180, newDays: 90, shortening: true, affectedCount: 1204331, firstPurgeAt: new Date('2026-10-03T00:00:00.000Z') },
        { kind: 'UNANSWERED_CLOSED', currentDays: 180, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null },
        { kind: 'SURVEY_FREE_TEXT', currentDays: 180, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null },
        { kind: 'HANDOFF_TEXT', currentDays: 180, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null },
        { kind: 'CALL_LOGS', currentDays: 90, newDays: 90, shortening: false, affectedCount: null, firstPurgeAt: null },
        { kind: 'AUDIT_LOGS', currentDays: 1825, newDays: 1825, shortening: false, affectedCount: null, firstPurgeAt: null },
      ],
      requiresConfirm: true,
      confirmHint: '보존기간 단축',
    };
    mockPreview.mockResolvedValue(preview);
    mockUpdate.mockResolvedValue(makePolicy({ kinds: KINDS.map((kind) => ({ kind, days: kind === 'CONVERSATION_TEXT' ? 90 : kind === 'AUDIT_LOGS' ? 1825 : 180, source: 'GLOBAL' })) }));

    renderPage();
    await screen.findByText('대화 로그 본문');

    const convoValueInput = screen.getAllByLabelText('새 값')[0];
    await user.clear(convoValueInput);
    await user.type(convoValueInput, '90');

    await user.click(screen.getByRole('button', { name: '변경 내용 확인(미리보기)' }));
    await screen.findByText(/1,204,331행/);

    // 대표 버튼 라벨은 "보존기간 90일로 단축"이어야 한다(NFR-DGA2 — 위험 동작 버튼 이름 명시).
    const shortenButton = await screen.findByRole('button', { name: '보존기간 90일로 단축' });
    expect(shortenButton).toBeDisabled();

    const confirmInput = screen.getByLabelText('"보존기간 단축"을 입력하세요');
    await user.type(confirmInput, '다른문구');
    expect(screen.getByText('"보존기간 단축"과 일치하지 않습니다.')).toBeInTheDocument();
    expect(shortenButton).toBeDisabled();

    await user.clear(confirmInput);
    await user.type(confirmInput, '보존기간 단축');
    expect(shortenButton).not.toBeDisabled();

    await user.click(shortenButton);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const dto = mockUpdate.mock.calls[0][0];
    expect(dto.confirmText).toBe('보존기간 단축');
    expect(dto.days.CONVERSATION_TEXT).toBe(90);
  });

  it('RETENTION_OUT_OF_RANGE 오류는 해당 종류 입력 아래 인라인 오류로 표시한다', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(makePolicy());
    mockPreview.mockRejectedValue(
      new ApiError(400, '허용 범위: 365~3650일', 'RETENTION_OUT_OF_RANGE', [{ field: 'AUDIT_LOGS', message: '허용 범위: 365~3650일' }]),
    );
    renderPage();
    await screen.findByText('대화 로그 본문');

    await user.click(screen.getByRole('button', { name: '변경 내용 확인(미리보기)' }));

    expect(await screen.findByText('허용 범위: 365~3650일')).toBeInTheDocument();
  });

  it('대기 중인 단축이 있으면 "예정된 단축 전체 취소" 버튼이 나타나고, 클릭 시 전체 취소 API를 1회 호출한다(유예 전체 취소)', async () => {
    const user = userEvent.setup();
    const pendingPolicy = makePolicy({
      kinds: [
        { kind: 'CONVERSATION_TEXT', days: 180, source: 'GLOBAL', pending: { days: 90, effectiveAt: new Date('2026-10-03T09:00:00.000Z') } },
        { kind: 'UNANSWERED_CLOSED', days: 180, source: 'GLOBAL' },
        { kind: 'SURVEY_FREE_TEXT', days: 180, source: 'GLOBAL' },
        { kind: 'HANDOFF_TEXT', days: 60, source: 'GLOBAL', pending: { days: 60, effectiveAt: new Date('2026-10-03T09:00:00.000Z') } },
        { kind: 'CALL_LOGS', days: 90, source: 'GLOBAL' },
        { kind: 'AUDIT_LOGS', days: 1825, source: 'GLOBAL' },
      ],
    });
    mockGet.mockResolvedValue(pendingPolicy);
    mockCancelAllPending.mockResolvedValue(makePolicy());

    renderPage();
    await screen.findByText('적용 예정(대기 중)');

    const cancelButton = screen.getByRole('button', { name: '예정된 단축 전체 취소' });
    expect(screen.getByText('이 버튼은 대기 중인 모든 단축을 취소합니다.')).toBeInTheDocument();
    await user.click(cancelButton);

    expect(mockCancelAllPending).toHaveBeenCalledTimes(1);
  });

  /** [코드 리뷰 R1 L-2] 서버 preview 응답의 `confirmHint`를 화면 코드의 하드코딩 대신 사용한다. */
  it('preview 응답의 confirmHint가 있으면 그 값으로 확인 문구를 판정한다(하드코딩 리터럴 대신)', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(makePolicy());
    mockPreview.mockResolvedValue({
      items: [{ kind: 'CONVERSATION_TEXT', currentDays: 180, newDays: 90, shortening: true, affectedCount: 10, firstPurgeAt: new Date('2026-10-03T00:00:00.000Z') }],
      requiresConfirm: true,
      confirmHint: '커스텀 확인 문구',
    });

    renderPage();
    await screen.findByText('대화 로그 본문');
    await user.click(screen.getByRole('button', { name: '변경 내용 확인(미리보기)' }));
    await screen.findByText(/10행/);

    const shortenButton = screen.getByRole('button', { name: '보존기간 90일로 단축' });
    const confirmInput = screen.getByLabelText('"보존기간 단축"을 입력하세요');

    // 화면에 하드코딩된 "보존기간 단축"을 입력해도 더 이상 통과하지 않는다 — 서버가 준 confirmHint가 기준이다.
    await user.type(confirmInput, '보존기간 단축');
    expect(shortenButton).toBeDisabled();

    await user.clear(confirmInput);
    await user.type(confirmInput, '커스텀 확인 문구');
    expect(shortenButton).not.toBeDisabled();
  });

  /** [코드 리뷰 R1 M-2] axe 접근성 스캔. */
  it('보존 정책 화면에 구조적 접근성 위반이 없다', async () => {
    mockGet.mockResolvedValue(makePolicy());
    const { container } = renderPage();
    await screen.findByText('대화 로그 본문');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
