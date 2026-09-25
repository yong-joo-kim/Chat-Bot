import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { ConversationState, DialogueOverlay, EnvironmentStatus, SimulateResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { SimulatorPanel } from './SimulatorPanel';

expect.extend(toHaveNoViolations);

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

const mockVersionsList = vi.fn();
vi.mock('../../../api/versions', () => ({
  versionsApi: {
    list: (...args: unknown[]) => mockVersionsList(...args),
  },
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
    assetCounts: { dialogNodes: 3, intents: 3, keywords: 3, homonyms: 3, contexts: 3, faqs: 3 },
    overlayApplied: false,
    ...overrides,
  } as SimulateResponse;
}

const ENV_ENABLED: EnvironmentStatus = {
  enabled: true,
  enabledAt: new Date('2026-09-20T00:00:00.000Z'),
  prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
  staging: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date(), label: null, legacyTiebreak: false, semanticPending: 0 },
  draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
  gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
  activeSwitchSchedule: null,
} as EnvironmentStatus;

function renderPanel(environmentStatus: EnvironmentStatus | null = null, overlay?: DialogueOverlay): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <SimulatorPanel chatbotId="bot-1" isArchived={false} mode="tab" environmentStatus={environmentStatus} overlay={overlay} />
    </ToastProvider>,
  );
}

async function sendMessage(text: string): Promise<void> {
  const user = userEvent.setup();
  const input = screen.getByLabelText('메시지 입력');
  await user.type(input, text);
  await user.click(screen.getByRole('button', { name: '전송' }));
}

/** [신규 No.40] 시뮬레이터 대상 선택(`environment-separation-ui-spec.md` §4.13). */
describe('SimulatorPanel — 대상 선택(No.40)', () => {
  beforeEach(() => {
    mockSimulate.mockReset();
    mockVersionsList.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('환경 분리가 꺼져 있으면(environmentStatus 없음) 대상 선택 컨트롤이 렌더되지 않는다', () => {
    renderPanel(null);
    expect(screen.queryByLabelText('대상')).not.toBeInTheDocument();
  });

  it('환경 분리가 켜져 있으면 대상 선택 컨트롤이 렌더되고 기본값은 초안이다', () => {
    renderPanel(ENV_ENABLED);
    const select = screen.getByLabelText('대상') as HTMLSelectElement;
    expect(select.value).toBe('DRAFT');
    expect(screen.getByText('대화 상대: 초안')).toBeInTheDocument();
  });

  it('대상을 스테이징으로 바꾸면 simulate 요청에 target이 실리고, 초안이면 생략된다', async () => {
    const user = userEvent.setup();
    mockSimulate.mockResolvedValue(makeResponse());
    renderPanel(ENV_ENABLED);

    await user.selectOptions(screen.getByLabelText('대상'), '스테이징(v44)');
    await sendMessage('안녕');

    await waitFor(() => expect(mockSimulate).toHaveBeenCalled());
    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ target: { kind: 'STAGING' } });
  });

  it('초안 대상이면 target을 undefined로 보낸다(직렬화 시 키가 빠져 요청 바이트 불변, 기존 apiMode/mockResponse와 같은 관행)', async () => {
    mockSimulate.mockResolvedValue(makeResponse());
    renderPanel(ENV_ENABLED);

    await sendMessage('안녕');

    await waitFor(() => expect(mockSimulate).toHaveBeenCalled());
    expect(mockSimulate.mock.calls[0][1].target).toBeUndefined();
  });

  it('응답의 target이 있으면 트레이스 패널에 "대상: ..." 줄을 보여준다', async () => {
    const user = userEvent.setup();
    mockSimulate.mockResolvedValue(
      makeResponse({ target: { kind: 'STAGING', versionId: 'ver-44', versionNo: 44, legacyTiebreak: false, semanticMissing: 0 } }),
    );
    renderPanel(ENV_ENABLED);
    await user.selectOptions(screen.getByLabelText('대상'), '스테이징(v44)');
    await sendMessage('안녕');

    await user.click(await screen.findByRole('button', { name: /판정 근거/ }));
    expect(screen.getByText('대상: 스테이징(v44)')).toBeInTheDocument();
  });

  it('오버레이가 켜져 있으면 대상 컨트롤이 비활성화되고 초안으로 고정된다(AC-EN6-2)', () => {
    renderPanel(ENV_ENABLED, { nodes: [] } as unknown as DialogueOverlay);
    const select = screen.getByLabelText('대상');
    expect(select).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('오버레이는 초안 대상에서만 사용할 수 있습니다.')).toBeInTheDocument();
  });

  // [R1 L-1/L-2] 양방향 상호 배제(§4.13)의 "반대 방향"(대상이 비초안인 상태에서 오버레이가 켜지는 경우)이
  // 실제 UI로는 일어날 수 없음을 확인한다 — `SimulatorPanel`에는 오버레이를 켜고 끄는 컨트롤이 없다. `overlay`는
  // 호출부(`NodeFormPage`/`ContextFormPage`/`FaqEditModal`)가 드로어를 열 때 고정으로 넘기는 prop이라, 이미
  // 마운트된 패널에서 사용자가 "초안이 아닌 대상을 고른 뒤" 오버레이를 새로 켜는 조작 경로 자체가 없다
  // (드로어 모드는 처음부터 항상 `overlay`가 채워져 있고, 탭 모드는 `overlay`를 절대 넘기지 않는다). 아래
  // 테스트는 그럼에도 방어적으로 존재하는 `useEffect`(대상 비초안 상태에서 overlay가 뒤늦게 채워지면 즉시
  // 초안으로 되돌림)가 실제로 동작함을 확인한다 — 회귀가 생겨도 비초안 대상이 선택된 채로 남지 않는다.
  it('(방어적) 대상이 비초안인 상태에서 overlay prop이 나중에 채워지면 즉시 초안으로 되돌아간다', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ToastProvider>
        <SimulatorPanel chatbotId="bot-1" isArchived={false} mode="tab" environmentStatus={ENV_ENABLED} overlay={undefined} />
      </ToastProvider>,
    );
    await user.selectOptions(screen.getByLabelText('대상'), '스테이징(v44)');
    expect((screen.getByLabelText('대상') as HTMLSelectElement).value).toBe('STAGING');

    rerender(
      <ToastProvider>
        <SimulatorPanel chatbotId="bot-1" isArchived={false} mode="tab" environmentStatus={ENV_ENABLED} overlay={{ nodes: [] } as unknown as DialogueOverlay} />
      </ToastProvider>,
    );

    await waitFor(() => expect((screen.getByLabelText('대상') as HTMLSelectElement).value).toBe('DRAFT'));
    expect(screen.getByLabelText('대상')).toHaveAttribute('aria-disabled', 'true');
  });

  it('대상 선택 컨트롤이 보이는 상태 — axe 스캔 위반 0건', async () => {
    const { container } = renderPanel(ENV_ENABLED);
    await screen.findByLabelText('대상');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
