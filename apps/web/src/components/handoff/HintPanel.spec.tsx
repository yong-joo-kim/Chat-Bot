import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { HintResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../Toast';
import { HintPanel } from './HintPanel';
import { handoffApi } from '../../api/handoff';
import { cannedResponsesApi } from '../../api/cannedResponses';

vi.mock('../../api/handoff', () => ({ handoffApi: { hints: vi.fn() } }));
vi.mock('../../api/cannedResponses', () => ({ cannedResponsesApi: { search: vi.fn() } }));

const EMPTY_HINT: HintResponse = { source: null, mode: 'LEXICAL', answers: [], canned: [] };
const SESSION_REF = 'a'.repeat(16);

function renderPanel(lastUserKey: string | null) {
  return render(
    <ToastProvider>
      <HintPanel chatbotId="bot-1" sessionRef={SESSION_REF} lastUserKey={lastUserKey} canFillComposer onFill={vi.fn()} />
    </ToastProvider>,
  );
}

describe('HintPanel — 재요청 조건(AC-CS5-5)', () => {
  beforeEach(() => {
    vi.mocked(handoffApi.hints).mockReset().mockResolvedValue(EMPTY_HINT);
    vi.mocked(cannedResponsesApi.search).mockReset().mockResolvedValue({ items: [] });
  });

  it('lastUserKey가 null이면 힌트를 요청하지 않는다', async () => {
    renderPanel(null);
    await waitFor(() => expect(handoffApi.hints).not.toHaveBeenCalled());
  });

  it('lastUserKey가 처음 주어지면 1회 요청한다', async () => {
    renderPanel('log-1');
    await waitFor(() => expect(handoffApi.hints).toHaveBeenCalledTimes(1));
    expect(handoffApi.hints).toHaveBeenCalledWith('bot-1', SESSION_REF);
  });

  it('2초 대화 폴링 틱처럼 같은 lastUserKey로 리렌더되어도 재요청하지 않는다(폴링마다 재요청 금지)', async () => {
    const { rerender } = renderPanel('log-1');
    await waitFor(() => expect(handoffApi.hints).toHaveBeenCalledTimes(1));

    const rerenderWith = (key: string | null) =>
      rerender(
        <ToastProvider>
          <HintPanel chatbotId="bot-1" sessionRef={SESSION_REF} lastUserKey={key} canFillComposer onFill={vi.fn()} />
        </ToastProvider>,
      );

    // 부모(TranscriptPanel)가 2초마다 폴링해도 lastUserKey가 그대로면 재요청하지 않는다.
    rerenderWith('log-1');
    rerenderWith('log-1');
    expect(handoffApi.hints).toHaveBeenCalledTimes(1);
  });

  it('lastUserKey가 바뀌면(새 사용자 발화) 다시 요청한다', async () => {
    const { rerender } = renderPanel('log-1');
    await waitFor(() => expect(handoffApi.hints).toHaveBeenCalledTimes(1));

    rerender(
      <ToastProvider>
        <HintPanel chatbotId="bot-1" sessionRef={SESSION_REF} lastUserKey="log-2" canFillComposer onFill={vi.fn()} />
      </ToastProvider>,
    );
    await waitFor(() => expect(handoffApi.hints).toHaveBeenCalledTimes(2));
  });
});

/**
 * Low(코드 리뷰 2회차 후속) — "입력창에 넣기" 버튼이 비활성일 때 사유가 화면에 보이는지 검증한다.
 * "가까운 답변" 목록에는 이미 있었지만 "자주 쓰는 문장" 목록에는 없던 문제.
 */
describe('HintPanel — 비활성 버튼 사유 표시(Low, 코드 리뷰 2회차 후속)', () => {
  beforeEach(() => {
    vi.mocked(cannedResponsesApi.search).mockReset().mockResolvedValue({ items: [] });
  });

  it('canFillComposer=false면 "가까운 답변"과 "자주 쓰는 문장" 양쪽 모두 비활성 사유 텍스트를 보여준다', async () => {
    vi.mocked(handoffApi.hints).mockReset().mockResolvedValue({
      source: { key: 'log-1', text: '환불 계좌를 바꾸고 싶어요' },
      mode: 'SEMANTIC',
      answers: [{ kind: 'FAQ', refName: 'refund-account', text: '환불 계좌 변경 안내', score: 0.9 }],
      canned: [{ id: 'cr-1', title: '환불계좌 안내', body: '환불 계좌를 알려주세요.', category: null, score: 0.8 }],
    } satisfies HintResponse);

    render(
      <ToastProvider>
        <HintPanel chatbotId="bot-1" sessionRef={SESSION_REF} lastUserKey="log-1" canFillComposer={false} onFill={vi.fn()} />
      </ToastProvider>,
    );

    await screen.findByText('환불 계좌 변경 안내');
    await screen.findByText('환불계좌 안내');

    // 두 목록의 "입력창에 넣기" 버튼이 모두 비활성이고, 사유 텍스트가 각각 화면에 보인다(title 속성뿐 아니라).
    const fillButtons = screen.getAllByRole('button', { name: '입력창에 넣기' });
    expect(fillButtons).toHaveLength(2);
    for (const btn of fillButtons) expect(btn).toBeDisabled();
    expect(screen.getAllByText('개입 후 사용할 수 있어요')).toHaveLength(2);
  });

  it('canFillComposer=true면 비활성 사유 텍스트가 보이지 않는다', async () => {
    vi.mocked(handoffApi.hints).mockReset().mockResolvedValue({
      source: { key: 'log-1', text: '환불 계좌를 바꾸고 싶어요' },
      mode: 'SEMANTIC',
      answers: [],
      canned: [{ id: 'cr-1', title: '환불계좌 안내', body: '환불 계좌를 알려주세요.', category: null, score: 0.8 }],
    } satisfies HintResponse);

    render(
      <ToastProvider>
        <HintPanel chatbotId="bot-1" sessionRef={SESSION_REF} lastUserKey="log-1" canFillComposer onFill={vi.fn()} />
      </ToastProvider>,
    );

    await screen.findByText('환불계좌 안내');
    expect(screen.queryByText('개입 후 사용할 수 있어요')).not.toBeInTheDocument();
  });
});
