import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { RetentionPolicyResponse, RetentionPreviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ChatbotRetentionSection } from './ChatbotRetentionSection';

expect.extend(toHaveNoViolations);

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockPreview = vi.fn();
const mockCancelPending = vi.fn();
let mockCanWrite = true;

vi.mock('../../../api/governance', () => ({
  chatbotRetentionApi: {
    get: (...args: unknown[]) => mockGet(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    preview: (...args: unknown[]) => mockPreview(...args),
    cancelPending: (...args: unknown[]) => mockCancelPending(...args),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { permissions: mockCanWrite ? ['security:read', 'security:write'] : ['security:read'] },
  }),
}));

const BOUNDS = { minConversationDays: 7, minAuditDays: 365, maxDays: 3650, shortenGraceDays: 7 };

function makePolicy(overrides: Partial<RetentionPolicyResponse> = {}): RetentionPolicyResponse {
  return {
    scope: 'CHATBOT',
    chatbotId: 'bot-1',
    kinds: [
      { kind: 'CONVERSATION_TEXT', days: 180, source: 'GLOBAL' },
      { kind: 'UNANSWERED_CLOSED', days: 180, source: 'GLOBAL' },
      { kind: 'SURVEY_FREE_TEXT', days: 180, source: 'GLOBAL' },
      { kind: 'HANDOFF_TEXT', days: 180, source: 'GLOBAL' },
    ],
    bounds: BOUNDS,
    updatedAt: null,
    updatedByEmail: null,
    ...overrides,
  };
}

function renderSection(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <ChatbotRetentionSection chatbotId="bot-1" chatbotName="대출 상담봇" isArchived={false} />
    </ToastProvider>,
  );
}

/** G2 — 챗봇 보존기간 재정의(data-governance-ui-spec.md §3.4). */
describe('ChatbotRetentionSection', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUpdate.mockReset();
    mockPreview.mockReset();
    mockCancelPending.mockReset();
    mockCanWrite = true;
  });

  it('재정의가 없으면(source=GLOBAL) 4종 모두 "전역 따름" 라디오가 선택돼 있고 현재 유효 일수를 표기한다', async () => {
    mockGet.mockResolvedValue(makePolicy());
    renderSection();

    await screen.findByText('보존기간 재정의 — 대출 상담봇');
    const globalRadios = screen.getAllByRole('radio', { name: /전역 따름\(현재 180일\)/ });
    expect(globalRadios).toHaveLength(4);
    for (const r of globalRadios) expect(r).toBeChecked();
  });

  it('security:write가 없으면 폼이 읽기 전용(disabled)이다(권한별 렌더)', async () => {
    mockCanWrite = false;
    mockGet.mockResolvedValue(makePolicy());
    renderSection();

    await screen.findByText('보존기간 재정의 — 대출 상담봇');
    expect(screen.getByText('이 값은 콘솔에서 바꿀 수 없습니다 — 서버 설정으로만 변경할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '보존기간' })).toBeDisabled();
  });

  it('단축 시 확인 문자열은 챗봇 이름이다 — 불일치면 저장이 막히고, 이름을 입력하면 저장된다', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(makePolicy());
    const preview: RetentionPreviewResponse = {
      items: [
        { kind: 'CONVERSATION_TEXT', currentDays: 180, newDays: 60, shortening: true, affectedCount: 500, firstPurgeAt: new Date('2026-10-03T00:00:00.000Z') },
        { kind: 'UNANSWERED_CLOSED', currentDays: 180, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null },
        { kind: 'SURVEY_FREE_TEXT', currentDays: 180, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null },
        { kind: 'HANDOFF_TEXT', currentDays: 180, newDays: 180, shortening: false, affectedCount: null, firstPurgeAt: null },
      ],
      requiresConfirm: true,
      confirmHint: '대출 상담봇',
    };
    mockPreview.mockResolvedValue(preview);
    mockUpdate.mockResolvedValue(makePolicy({ kinds: [{ kind: 'CONVERSATION_TEXT', days: 60, source: 'CHATBOT' }, ...makePolicy().kinds.slice(1)] }));

    renderSection();
    await screen.findByText('보존기간 재정의 — 대출 상담봇');

    const convoCustomRadio = screen.getAllByRole('radio', { name: '직접 지정' })[0];
    await user.click(convoCustomRadio);
    const convoInput = screen.getByRole('spinbutton', { name: /대화 로그 본문 직접 지정/ });
    await user.clear(convoInput);
    await user.type(convoInput, '60');

    await user.click(screen.getByRole('button', { name: '변경 내용 확인(미리보기)' }));
    await screen.findByText(/500행/);

    const shortenButton = await screen.findByRole('button', { name: '보존기간 60일로 단축' });
    expect(shortenButton).toBeDisabled();

    const confirmInput = screen.getByLabelText('"대출 상담봇"을(를) 입력하세요');
    await user.type(confirmInput, '다른봇');
    expect(screen.getByText('"대출 상담봇"과(와) 일치하지 않습니다.')).toBeInTheDocument();
    expect(shortenButton).toBeDisabled();

    await user.clear(confirmInput);
    await user.type(confirmInput, '대출 상담봇');
    expect(shortenButton).not.toBeDisabled();

    await user.click(shortenButton);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [calledChatbotId, dto] = mockUpdate.mock.calls[0];
    expect(calledChatbotId).toBe('bot-1');
    expect(dto.confirmText).toBe('대출 상담봇');
    expect(dto.days.CONVERSATION_TEXT).toBe(60);
    expect(dto.days.UNANSWERED_CLOSED).toBe('GLOBAL');
  });

  it('대기 중인 단축이 있으면 "예정된 단축 전체 취소" 버튼이 나타나고, 대기 항목이 없어 서버가 404를 줘도 화면이 깨지지 않는다', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(
      makePolicy({
        kinds: [
          { kind: 'CONVERSATION_TEXT', days: 180, source: 'CHATBOT', pending: { days: 60, effectiveAt: new Date('2026-10-03T09:00:00.000Z') } },
          { kind: 'UNANSWERED_CLOSED', days: 180, source: 'GLOBAL' },
          { kind: 'SURVEY_FREE_TEXT', days: 180, source: 'GLOBAL' },
          { kind: 'HANDOFF_TEXT', days: 180, source: 'GLOBAL' },
        ],
      }),
    );
    mockCancelPending.mockRejectedValue(new Error('404'));

    renderSection();
    await screen.findByText('적용 예정(대기 중)');

    const cancelButton = screen.getByRole('button', { name: '예정된 단축 전체 취소' });
    await user.click(cancelButton);

    expect(mockCancelPending).toHaveBeenCalledTimes(1);
    // 실패해도 화면이 그대로 유지된다(방어적 처리 — 크래시 없음).
    expect(screen.getByRole('button', { name: '예정된 단축 전체 취소' })).toBeInTheDocument();
  });

  it('ARCHIVED 챗봇에서도 편집 가능하며 안내 문구를 보여준다', async () => {
    mockGet.mockResolvedValue(makePolicy());
    render(
      <ToastProvider>
        <ChatbotRetentionSection chatbotId="bot-1" chatbotName="대출 상담봇" isArchived />
      </ToastProvider>,
    );

    await screen.findByText('보존기간 재정의 — 대출 상담봇');
    expect(screen.getByText('보관 상태에서도 보존기간 설정은 변경할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '보존기간' })).not.toBeDisabled();
  });

  /** [코드 리뷰 R1 L-2] preview 응답의 `confirmHint`가 있으면 챗봇 이름 대신 그 값으로 판정한다. */
  it('preview 응답에 confirmHint가 있으면 챗봇 이름 대신 그 값으로 확인 문구를 판정한다', async () => {
    const user = userEvent.setup();
    mockGet.mockResolvedValue(makePolicy());
    mockPreview.mockResolvedValue({
      items: [{ kind: 'CONVERSATION_TEXT', currentDays: 180, newDays: 60, shortening: true, affectedCount: 10, firstPurgeAt: new Date('2026-10-03T00:00:00.000Z') }],
      requiresConfirm: true,
      confirmHint: '서버가 준 다른 문구',
    });

    renderSection();
    await screen.findByText('보존기간 재정의 — 대출 상담봇');

    const convoCustomRadio = screen.getAllByRole('radio', { name: '직접 지정' })[0];
    await user.click(convoCustomRadio);
    const convoInput = screen.getByRole('spinbutton', { name: /대화 로그 본문 직접 지정/ });
    await user.clear(convoInput);
    await user.type(convoInput, '60');
    await user.click(screen.getByRole('button', { name: '변경 내용 확인(미리보기)' }));
    await screen.findByText(/10행/);

    const shortenButton = screen.getByRole('button', { name: '보존기간 60일로 단축' });
    const confirmInput = screen.getByLabelText('"서버가 준 다른 문구"을(를) 입력하세요');

    // 챗봇 이름을 그대로 입력해도 더 이상 통과하지 않는다 — 서버 confirmHint가 기준이다.
    await user.type(confirmInput, '대출 상담봇');
    expect(shortenButton).toBeDisabled();

    await user.clear(confirmInput);
    await user.type(confirmInput, '서버가 준 다른 문구');
    expect(shortenButton).not.toBeDisabled();
  });

  it('라디오 3지 폼 화면에 구조적 접근성 위반이 없다', async () => {
    mockGet.mockResolvedValue(makePolicy());
    const { container } = renderSection();
    await screen.findByText('보존기간 재정의 — 대출 상담봇');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
