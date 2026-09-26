import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConversationState, DialogOutput, SimulateResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { SimulatorPanel } from './SimulatorPanel';

const mockSimulate = vi.fn();
vi.mock('../../../api/simulation', () => ({
  simulationApi: {
    simulate: (...args: unknown[]) => mockSimulate(...args),
    compare: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

const mockListOk = () => Promise.resolve({ items: [], total: 0 });
vi.mock('../../../api/dialogue', () => ({
  dialogNodesApi: { list: () => mockListOk(), findOne: vi.fn() },
  intentsApi: { list: () => mockListOk() },
  keywordsApi: { list: () => mockListOk() },
  homonymsApi: { list: () => mockListOk() },
  contextsApi: { list: () => mockListOk() },
  faqsApi: { list: () => mockListOk() },
}));

function makeState(): ConversationState {
  return { version: 1, contextSession: null } as ConversationState;
}

function makeResponse(overrides: Partial<SimulateResponse> = {}): SimulateResponse {
  return {
    input: '',
    normalizedInput: '',
    outputs: [],
    nextSession: null,
    unsupportedOutputs: [],
    trace: [],
    state: makeState(),
    stateDiscarded: [],
    elapsedMs: 5,
    resolvedAt: new Date('2026-09-20T00:00:00.000Z'),
    assetCounts: { dialogNodes: 0, intents: 0, keywords: 0, homonyms: 0, contexts: 0, faqs: 0 },
    overlayApplied: false,
    ...overrides,
  } as SimulateResponse;
}

function quickReplyOutput(labels: string[]): DialogOutput {
  return {
    type: 'BUTTON',
    payload: { buttons: labels.map((l) => ({ label: l, action: 'MESSAGE' as const, value: l })), display: 'QUICK_REPLY' },
  } as DialogOutput;
}

function renderPanel(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <SimulatorPanel chatbotId="bot-1" isArchived={false} mode="tab" />
    </ToastProvider>,
  );
}

async function sendMessage(text: string): Promise<void> {
  const user = userEvent.setup();
  const input = screen.getByLabelText('메시지 입력');
  await user.type(input, text);
  await user.click(screen.getByRole('button', { name: '전송' }));
}

/**
 * RM-6 — 응답 테스트 시뮬레이터의 바로연결 "사용 후 숨김"(D-4 확정, channel-rich-messages-ui-spec.md §3.6).
 * 위젯과 동일한 사용자 경험을 재현한다. "대화 초기화"로 칩이 다시 보인다(§13 D-4 확정).
 */
describe('SimulatorPanel — 바로연결 칩 사용 후 숨김(RM-6, D-4)', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
  });

  it('칩을 클릭하면 칩 묶음이 사라지고 다음 턴이 전송된다', async () => {
    mockSimulate.mockResolvedValueOnce(
      makeResponse({ outputs: [{ type: 'TEXT', payload: { text: '무엇을 도와드릴까요?' } }, quickReplyOutput(['반품 문의', '교환 문의'])] }),
    );
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [{ type: 'TEXT', payload: { text: '반품 절차를 안내합니다.' } }] }));

    renderPanel();
    await sendMessage('안녕하세요');
    await screen.findByText('무엇을 도와드릴까요?');
    expect(screen.getByRole('button', { name: '반품 문의' })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '반품 문의' }));

    await screen.findByText('반품 절차를 안내합니다.');
    expect(screen.queryByRole('button', { name: '반품 문의' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '교환 문의' })).not.toBeInTheDocument();
  });

  it('칩을 누르지 않고 직접 입력해 전송해도 칩 묶음이 사라진다', async () => {
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [quickReplyOutput(['반품 문의'])] }));
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [{ type: 'TEXT', payload: { text: '네, 확인했습니다.' } }] }));

    renderPanel();
    await sendMessage('안녕하세요');
    await screen.findByRole('button', { name: '반품 문의' });

    await sendMessage('직접 입력했어요');
    await screen.findByText('네, 확인했습니다.');
    expect(screen.queryByRole('button', { name: '반품 문의' })).not.toBeInTheDocument();
  });

  it('"대화 초기화" 후 같은 응답을 다시 받으면 칩이 복원된다(사라진 칩이 스스로 복원되지는 않음)', async () => {
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [quickReplyOutput(['반품 문의'])] }));
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [{ type: 'TEXT', payload: { text: '확인했습니다.' } }] }));
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [quickReplyOutput(['반품 문의'])] }));

    renderPanel();
    await sendMessage('안녕하세요');
    await screen.findByRole('button', { name: '반품 문의' });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '반품 문의' }));
    await screen.findByText('확인했습니다.');
    expect(screen.queryByRole('button', { name: '반품 문의' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '대화 초기화' }));
    await sendMessage('다시 안녕하세요');
    expect(await screen.findByRole('button', { name: '반품 문의' })).toBeInTheDocument();
  });
});
