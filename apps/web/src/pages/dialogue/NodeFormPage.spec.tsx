import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { DialogueOverlay, EnvironmentStatus } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { NodeFormPage } from './NodeFormPage';

// [R1 L-1] `environmentStatus`가 `SimulatorDrawer`까지 전달되는지 확인하려고 켜진 상태로 둔다.
const ENV_ENABLED: EnvironmentStatus = {
  enabled: true,
  enabledAt: new Date('2026-09-20T00:00:00.000Z'),
  prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
  staging: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date(), label: null, legacyTiebreak: false, semanticPending: 0 },
  draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
  gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
  activeSwitchSchedule: null,
} as EnvironmentStatus;

const mockContext: ChatbotDetailContext = {
  chatbot: makeChatbot({ id: 'bot-1', status: 'ACTIVE' }),
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
  learningSummary: null,
  refreshLearningSummary: vi.fn(),
  environmentStatus: ENV_ENABLED,
  refreshEnvironmentStatus: vi.fn(),
};
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const mockFindOne = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../api/dialogue', () => ({
  dialogNodesApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    create: vi.fn(),
  },
  intentsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
  keywordsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
  contextsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

let capturedDrawerProps: { isOpen: boolean; overlay?: DialogueOverlay; environmentStatus?: EnvironmentStatus | null } | undefined;
vi.mock('../chatbot-detail/simulator/SimulatorDrawer', () => ({
  SimulatorDrawer: (props: { isOpen: boolean; overlay?: DialogueOverlay; environmentStatus?: EnvironmentStatus | null }) => {
    capturedDrawerProps = props;
    if (!props.isOpen) return null;
    return <div data-testid="sim-drawer-stub">드로어 열림</div>;
  },
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/nodes/new']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/nodes/new" element={<NodeFormPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/** SIM1-D 드로어 진입 지점 1/3 — 노드 편집 폼(FR-10-17/23, ui-spec §4.2). */
describe('NodeFormPage — SIM1-D 드로어 진입("이 설정으로 테스트")', () => {
  it('초기에는 드로어가 닫혀 있다가, 버튼을 누르면 현재 폼 상태가 오버레이로 직렬화되어 열린다', async () => {
    renderPage();
    expect(capturedDrawerProps?.isOpen).toBe(false);
    expect(screen.queryByTestId('sim-drawer-stub')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/노드 이름|이름/), '배송조회_응답');
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect(screen.getByTestId('sim-drawer-stub')).toBeInTheDocument();
    expect(capturedDrawerProps?.isOpen).toBe(true);
    expect(capturedDrawerProps?.overlay?.dialogNodes?.[0]).toMatchObject({ id: 'draft-1', name: '배송조회_응답' });
  });

  // [R1 L-1] `ChatbotDetailContext.environmentStatus`가 `SimulatorDrawer`까지 그대로 전달돼야
  // 오버레이 모드에서 대상 컨트롤이 aria-disabled로 보인다(§4.13, AC-EN6-2).
  it('현재 챗봇의 environmentStatus를 SimulatorDrawer에 그대로 넘긴다', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect(capturedDrawerProps?.environmentStatus).toBe(ENV_ENABLED);
  });

  it('드로어 진입은 UnsavedGuardContext를 등록하지 않는다(AC-10-17 — 라우트 이동이 아니므로)', async () => {
    renderPage();
    const user = userEvent.setup();
    const setUnsavedGuardCallsBefore = (mockContext.setUnsavedGuard as ReturnType<typeof vi.fn>).mock.calls.length;

    await user.click(screen.getByRole('button', { name: '이 설정으로 테스트' }));

    expect((mockContext.setUnsavedGuard as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setUnsavedGuardCallsBefore);
  });
});

function renderEditPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/nodes/node-legacy']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/nodes/:nodeId" element={<NodeFormPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/**
 * [No.26 1차 코드리뷰 반영] `API_OUTPUT_LEGACY_FORMAT` 저장 거부 시 v1 카드로 스크롤·포커스를 옮기고
 * "연결로 전환" 버튼을 강조한다(ui-spec §3.3-5).
 */
describe('NodeFormPage — API_OUTPUT_LEGACY_FORMAT 저장 거부', () => {
  it('저장이 거부되면 안내 배너가 뜨고 legacyHighlight가 v1 아웃풋 인덱스로 설정된다', async () => {
    mockFindOne.mockResolvedValue({
      id: 'node-legacy',
      chatbotId: 'bot-1',
      name: '레거시노드',
      nodeType: 'FALLBACK',
      matchMode: 'ANY',
      enabled: true,
      priority: 100,
      intentIds: [],
      keywordIds: [],
      outputs: [
        {
          type: 'API_CONDITION',
          payload: {
            method: 'GET',
            url: 'https://erp.corp.local/',
            conditions: [{ path: 'data.status', operator: 'EQ', value: 'A', nextNodeId: '11111111-1111-1111-1111-111111111111' }],
          },
        },
      ],
      createdAt: new Date('2026-09-01T00:00:00.000Z'),
      updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    mockUpdate.mockRejectedValue(
      new (await import('../../api/client')).ApiError(400, 'API 조건을 연결 방식으로 전환해야 저장할 수 있습니다.', 'API_OUTPUT_LEGACY_FORMAT', [
        { field: 'outputs[0]', message: '이전 형식 API 조건은 저장할 수 없습니다.' },
      ]),
    );

    const user = userEvent.setup();
    renderEditPage();
    const nameInput = await screen.findByDisplayValue('레거시노드');
    // 저장 버튼은 `dirty`일 때만 활성화된다 — 이름 끝에 문자 하나를 더해 변경 상태를 만든다.
    await user.type(nameInput, 'x');

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('API 조건을 연결 방식으로 전환해야 저장할 수 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '연결로 전환' })).toBeInTheDocument();
  });
});

/** [신규 No.22] D1-ext — START/FALLBACK 노드는 `TopicSelectField` 대신 고정 안내를 보여준다(§9-7). */
describe('NodeFormPage — 토픽 선택 필드 / 시작·폴백 잠금', () => {
  it('유형이 일반(NORMAL)이면 토픽 선택 필드가 보인다', async () => {
    renderPage();
    expect(await screen.findByLabelText('토픽')).toBeInTheDocument();
  });

  it('유형을 시작(START)으로 바꾸면 토픽 선택 필드 대신 고정 안내 문구가 보인다', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('토픽');

    await user.click(screen.getByRole('radio', { name: '시작' }));

    expect(screen.queryByLabelText('토픽')).not.toBeInTheDocument();
    expect(screen.getByText('시작·폴백 노드는 항상 공통입니다.')).toBeInTheDocument();
  });

  it('유형을 폴백(FALLBACK)으로 바꿔도 같은 고정 안내가 보인다', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('토픽');

    await user.click(screen.getByRole('radio', { name: '폴백' }));

    expect(screen.queryByLabelText('토픽')).not.toBeInTheDocument();
    expect(screen.getByText('시작·폴백 노드는 항상 공통입니다.')).toBeInTheDocument();
  });
});
