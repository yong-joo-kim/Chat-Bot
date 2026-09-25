import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

// [No.26] SimulatorPanel이 `ApiModeToggle`의 `simulation:write` 판정을 위해 `useAuth()`를 새로 쓴다.
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

const mockListOk = () => Promise.resolve({ items: [], total: 3 });
const mockDialogNodesList = vi.fn();
const mockDialogNodesFindOne = vi.fn();
vi.mock('../../../api/dialogue', () => ({
  dialogNodesApi: {
    list: (...args: unknown[]) => mockDialogNodesList(...args),
    findOne: (...args: unknown[]) => mockDialogNodesFindOne(...args),
  },
  intentsApi: { list: () => mockListOk() },
  keywordsApi: { list: () => mockListOk() },
  homonymsApi: { list: () => mockListOk() },
  contextsApi: { list: () => mockListOk() },
  faqsApi: { list: () => mockListOk() },
}));

function makeState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    version: 1,
    contextSession: null,
    ...overrides,
  } as ConversationState;
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
    assetCounts: { dialogNodes: 3, intents: 3, keywords: 3, homonyms: 3, contexts: 3, faqs: 3 },
    overlayApplied: false,
    ...overrides,
  } as SimulateResponse;
}

function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } } as DialogOutput;
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

describe('SimulatorPanel — 멀티턴 대화(FR-10-3, AC-10-4/AC-10-5)', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    mockDialogNodesList.mockReset().mockResolvedValue({ items: [], total: 0 });
    mockDialogNodesFindOne.mockReset();
  });

  it('첫 턴 응답의 state를 두 번째 요청에 그대로 실어 보낸다', async () => {
    const stateAfterFirst = makeState({
      contextSession: {
        contextVariableId: 'ctx-1',
        status: 'IN_PROGRESS',
        currentSlotIndex: 0,
        filledValues: {},
        retryCount: 0,
        startedAt: new Date('2026-09-20T00:00:00.000Z'),
        lastInteractedAt: new Date('2026-09-20T00:00:00.000Z'),
      },
    } as Partial<ConversationState>);

    mockSimulate.mockResolvedValueOnce(
      makeResponse({ outputs: [textOutput('어떤 메뉴로 하시겠어요?')], state: stateAfterFirst }),
    );
    mockSimulate.mockResolvedValueOnce(
      makeResponse({ outputs: [textOutput('사이즈는요?')], state: makeState() }),
    );

    renderPanel();
    await sendMessage('커피 주문할게요');
    await screen.findByText('어떤 메뉴로 하시겠어요?');

    await sendMessage('아메리카노');
    await screen.findByText('사이즈는요?');

    expect(mockSimulate).toHaveBeenCalledTimes(2);
    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ message: '커피 주문할게요', state: undefined });
    expect(mockSimulate.mock.calls[1][1]).toMatchObject({ message: '아메리카노', state: stateAfterFirst });
  });

  it('"대화 초기화"를 누르면 메시지와 state가 모두 비워진다(FR-10-12)', async () => {
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [textOutput('안녕하세요!')] }));
    renderPanel();
    await sendMessage('안녕');
    await screen.findByText('안녕하세요!');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '대화 초기화' }));

    expect(screen.queryByText('안녕하세요!')).not.toBeInTheDocument();
    expect(screen.queryByText('안녕')).not.toBeInTheDocument();
  });
});

describe('SimulatorPanel — 동음이의어 되묻기 버튼 클릭→해소 흐름(FR-E2-2, AC-E2-3~5, S-9)', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    mockDialogNodesList.mockReset().mockResolvedValue({ items: [], total: 0 });
    mockDialogNodesFindOne.mockReset();
  });

  it('되묻기 버튼("선박")을 클릭하면 그 텍스트로 다음 턴이 전송되고 응답이 이어진다', async () => {
    const clarifyState = makeState({
      pendingClarify: { homonymId: 'hom-1', word: '배', askedAt: new Date('2026-09-20T00:00:00.000Z') },
    } as Partial<ConversationState>);
    const clarifyOutput: DialogOutput = {
      type: 'BUTTON',
      payload: {
        text: "어떤 '배'를 말씀하시는 건가요?",
        buttons: [
          { label: '과일', action: 'MESSAGE', value: '과일' },
          { label: '선박', action: 'MESSAGE', value: '선박' },
        ],
      },
    } as DialogOutput;

    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [clarifyOutput], state: clarifyState }));
    mockSimulate.mockResolvedValueOnce(
      makeResponse({
        outputs: [textOutput('선박 관련 안내입니다.')],
        state: makeState(),
        trace: [{ stage: 'HOMONYM', code: 'CLARIFY_RESOLVED' }],
      }),
    );

    renderPanel();
    await sendMessage('배 언제 와요?');
    await screen.findByText("어떤 '배'를 말씀하시는 건가요?");

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '선박' }));

    await screen.findByText('선박 관련 안내입니다.');

    // 사용자가 버튼으로 보낸 값도 일반 입력처럼 사용자 말풍선에 그대로 노출된다(ui-spec §4.1.2).
    const userBubbles = screen.getAllByText('선박', { selector: '.chat-bubble-text' });
    expect(userBubbles).toHaveLength(1);

    expect(mockSimulate).toHaveBeenCalledTimes(2);
    expect(mockSimulate.mock.calls[1][1]).toMatchObject({ message: '선박', state: clarifyState });
  });
});

describe('SimulatorPanel — 노드 직접 점프(FR-E2-1, §4.1.3)', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    mockDialogNodesList.mockReset();
    mockDialogNodesFindOne.mockReset();
  });

  it('노드 검색 후 선택하고 "이 노드로 시작"을 누르면 buttonAction NODE로 시뮬레이션 요청이 간다', async () => {
    mockDialogNodesList.mockImplementation((_chatbotId: string, query: { q?: string }) => {
      if (query?.q === '배송') {
        return Promise.resolve({ items: [{ id: 'node-99', name: '배송조회_응답' }], total: 1 });
      }
      return Promise.resolve({ items: [], total: 0 });
    });
    mockDialogNodesFindOne.mockResolvedValue({ id: 'node-99', name: '배송조회_응답' });
    mockSimulate.mockResolvedValueOnce(makeResponse({ outputs: [textOutput('운송장을 확인해 드릴게요.')], matchedNodeId: 'node-99' }));

    renderPanel();
    const user = userEvent.setup();

    const searchInput = screen.getByRole('combobox', { name: '노드 검색' });
    await user.type(searchInput, '배송');

    const option = await screen.findByRole('option', { name: '배송조회_응답' });
    await user.click(option);

    const submitButton = screen.getByRole('button', { name: '이 노드로 시작' });
    await waitFor(() => expect(submitButton).toBeEnabled());
    await user.click(submitButton);

    await screen.findByText('운송장을 확인해 드릴게요.');
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ buttonAction: { kind: 'NODE', nodeId: 'node-99' } });

    // 노드 점프는 "사용자가 입력한 것"이 아니라 시스템 안내 말풍선으로 구분 표시된다(ui-spec §4.1.3).
    expect(screen.getByText("[테스트] '배송조회_응답' 노드를 직접 실행합니다")).toBeInTheDocument();
  });
});

describe('SimulatorPanel — 미저장 변경(오버레이) 배지(FR-10-24, AC-10B-6)', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    mockDialogNodesList.mockReset().mockResolvedValue({ items: [], total: 0 });
  });

  it('overlay가 주어진 드로어 모드에서는 상단에 "미저장 변경 적용됨" 배지가 표시된다', () => {
    render(
      <ToastProvider>
        <SimulatorPanel chatbotId="bot-1" isArchived={false} mode="drawer" overlay={{ dialogNodes: [] }} />
      </ToastProvider>,
    );
    expect(screen.getByText(/미저장 변경 적용됨/)).toBeInTheDocument();
  });
});

// [No.27] SIM1-ext — 설문 미리보기 토글(survey-management-ui-spec.md §3.6). 기본 꺼짐이며, 요청마다
// `surveyPreview`가 실려 나가야 한다(수정 전에는 이 필드가 누락되어 타입 오류가 있었다).
describe('SimulatorPanel — 설문 미리보기(FR-SV9-3)', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    mockDialogNodesList.mockReset().mockResolvedValue({ items: [], total: 0 });
  });

  it('기본값은 꺼짐이며, 메시지 전송 시 surveyPreview: false가 요청에 실린다', async () => {
    mockSimulate.mockResolvedValue(makeResponse({ input: '안녕', outputs: [textOutput('안녕하세요')] }));
    renderPanel();

    expect(screen.getByLabelText('끔(실제 상태·기간을 따름)')).toBeChecked();

    await sendMessage('안녕');

    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ surveyPreview: false });
  });

  it('토글을 켜면 이후 요청에 surveyPreview: true가 실린다', async () => {
    mockSimulate.mockResolvedValue(makeResponse({ input: '안녕', outputs: [textOutput('안녕하세요')] }));
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByLabelText('켬(작성 중·마감·기간 외 설문도 진행)'));
    await sendMessage('안녕');

    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ surveyPreview: true });
  });

  it('응답에 surveyStep이 있으면 "설문 단계" 패널이 "저장되지 않음" 배지와 함께 나타난다', async () => {
    mockSimulate.mockResolvedValue(
      makeResponse({
        input: '4점',
        outputs: [textOutput('2/3 좋았던 점을 골라 주세요')],
        surveyStep: {
          surveyId: '11111111-1111-4111-8111-111111111111',
          surveyName: '배송 만족도',
          questionIndex: 1,
          questionCount: 3,
          outcomes: ['ANSWERED'],
          preview: false,
          saved: false,
        },
      }),
    );
    renderPanel();
    await sendMessage('4점');

    expect(await screen.findByText('설문 단계')).toBeInTheDocument();
    expect(screen.getByText('저장되지 않음')).toBeInTheDocument();
  });
});

/** [신규 No.22] SIM-ext — "비활성 토픽 포함" 토글(topic-system-ui-spec.md §3.8). */
describe('SimulatorPanel — 비활성 토픽 포함 토글', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    mockDialogNodesList.mockReset().mockResolvedValue({ items: [], total: 0 });
    mockDialogNodesFindOne.mockReset();
  });

  it('기본값은 꺼짐이며, 꺼진 채로 보내면 includeInactiveTopics:false가 전달된다', async () => {
    mockSimulate.mockResolvedValue(makeResponse({ outputs: [textOutput('안내')] }));
    renderPanel();
    const toggle = screen.getByRole('checkbox', { name: '비활성 토픽 포함' });
    expect(toggle).not.toBeChecked();

    await sendMessage('안녕');
    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ includeInactiveTopics: false });
  });

  it('토글을 켜고 보내면 includeInactiveTopics:true가 전달된다', async () => {
    const user = userEvent.setup();
    mockSimulate.mockResolvedValue(makeResponse({ outputs: [textOutput('안내')] }));
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: '비활성 토픽 포함' }));
    await sendMessage('안녕');

    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ includeInactiveTopics: true });
  });

  it('응답에 answeredTopic이 있으면 봇 말풍선에 "토픽: {이름}({상태})"가 표시된다', async () => {
    mockSimulate.mockResolvedValue(
      makeResponse({ outputs: [textOutput('보험 접수는 이렇게 진행합니다')], answeredTopic: { id: 'topic-2', name: '보험청구', enabled: false } }),
    );
    renderPanel();
    await sendMessage('보험 접수');

    expect(await screen.findByText('토픽: 보험청구(비활성)')).toBeInTheDocument();
  });

  it('TC 실행에는 이 옵션이 없다는 안내 문구가 토글 근처에 있다', () => {
    renderPanel();
    expect(screen.getByText(/TC 실행에는 이 옵션이 없습니다/)).toBeInTheDocument();
  });
});
