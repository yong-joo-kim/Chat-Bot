import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { Chatbot, DialogNodeListItem, FlowTree, DesignValidationReport } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { ApiError } from '../../api/client';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { NodesListPage } from './NodesListPage';

const mockList = vi.fn();
const mockFlow = vi.fn();
const mockValidate = vi.fn();
const mockRemove = vi.fn();
const mockCopy = vi.fn();
const mockIntentsList = vi.fn();

vi.mock('../../api/dialogue', () => ({
  dialogNodesApi: {
    list: (...args: unknown[]) => mockList(...args),
    flow: (...args: unknown[]) => mockFlow(...args),
    validate: (...args: unknown[]) => mockValidate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    copy: (...args: unknown[]) => mockCopy(...args),
  },
  intentsApi: {
    list: (...args: unknown[]) => mockIntentsList(...args),
  },
}));

const chatbot: Chatbot = makeChatbot({ id: 'bot-1', status: 'ACTIVE' });

const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};

vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

// [신규 No.22] `NodesListPage`가 토픽 일괄 지정 게이팅에 `useAuth().can`을 쓴다 — 기존 스펙은
// `AuthProvider` 없이 렌더하므로 실패를 막기 위해 최소 목을 추가한다(canned-responses 선례와 동일).
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

vi.mock('../../api/topics', () => ({
  topicsApi: {
    list: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'topic-1',
          chatbotId: 'bot-1',
          name: '배송',
          sortOrder: 0,
          enabled: true,
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          updatedAt: new Date('2026-09-01T00:00:00.000Z'),
        },
      ],
      common: { counts: {}, outgoingCrossRefs: 0 },
      limit: 50,
    }),
  },
}));

function makeNodeItem(overrides: Partial<DialogNodeListItem> = {}): DialogNodeListItem {
  return {
    id: 'node-1',
    chatbotId: 'bot-1',
    name: '배송조회_응답',
    nodeType: 'NORMAL',
    matchMode: 'ANY',
    enabled: true,
    priority: 100,
    intentIds: ['intent-1'],
    keywordIds: [],
    outputs: [{ type: 'TEXT', payload: { text: '안내드립니다.' } }],
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    conditionSummary: { intents: [{ id: 'intent-1', name: '배송조회' }], keywords: [] },
    outputTypes: ['TEXT'],
    incomingCount: 0,
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/nodes']}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/nodes" element={<NodesListPage />} />
          <Route path="/chatbots/:chatbotId/dialogue/nodes/:id" element={<p>노드 편집 화면</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * 대화 노드 목록 화면 회귀 시험 — H3(다중유형 필터 서버위임) 핵심 검증 + 흐름미리보기/설계점검
 * 패널 렌더링 + 노드 삭제차단 배너(kind='node').
 */
describe('NodesListPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockFlow.mockReset();
    mockValidate.mockReset();
    mockRemove.mockReset();
    mockCopy.mockReset();
    mockIntentsList.mockReset();
    mockList.mockResolvedValue({ items: [makeNodeItem()], total: 1, page: 1, pageSize: 20 });
    mockIntentsList.mockResolvedValue({ items: [{ id: 'intent-1' }], total: 1, page: 1, pageSize: 1 });
  });

  it('초기 로드 시 3개 유형(NORMAL/START/FALLBACK)이 모두 체크된 채로 목록을 조회한다', async () => {
    renderPage();
    await screen.findByText('배송조회_응답');

    expect(mockList).toHaveBeenCalledWith(
      'bot-1',
      expect.objectContaining({ nodeType: ['NORMAL', 'START', 'FALLBACK'] }),
    );
  });

  it('H3: 유형 체크박스를 해제하면 클라이언트가 직접 필터링하지 않고 좁혀진 배열을 서버(dialogNodesApi.list)에 그대로 위임한다', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('배송조회_응답');
    mockList.mockClear();
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    await user.click(screen.getByRole('checkbox', { name: '시작' }));
    await user.click(screen.getByRole('checkbox', { name: '폴백' }));

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith('bot-1', expect.objectContaining({ nodeType: ['NORMAL'] })),
    );

    // 두 번 체크 해제했으니 서버 호출도 상태 변경마다 각각 발생한다(클라이언트 로컬 필터링이 아니라 매번 재조회).
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('"설계 점검"을 누르면 dialogNodesApi.validate가 호출되고 결과 패널이 심각도별 건수와 함께 렌더링된다', async () => {
    const user = userEvent.setup();
    const report: DesignValidationReport = {
      issues: [
        {
          code: 'EMPTY_OUTPUT',
          severity: 'WARNING',
          resourceType: 'NODE',
          resourceId: 'node-2',
          resourceName: '빈아웃풋노드',
          message: '아웃풋이 비어 있는 노드입니다.',
        },
      ],
      summary: { error: 0, warning: 1, info: 0 },
      checkedAt: new Date('2026-09-19T00:00:00.000Z'),
    };
    mockValidate.mockResolvedValue(report);
    renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: '설계 점검' }));

    expect(mockValidate).toHaveBeenCalledWith('bot-1');
    expect(await screen.findByText('아웃풋이 비어 있는 노드입니다.')).toBeInTheDocument();
    expect(screen.getByText('주의 1건')).toBeInTheDocument();
    expect(screen.getByText('오류 0건')).toBeInTheDocument();
    // 각 항목에서 편집 화면으로 이동하는 링크(NFR-A4)
    expect(screen.getByRole('link', { name: /빈아웃풋노드/ })).toHaveAttribute(
      'href',
      '/chatbots/bot-1/dialogue/nodes/node-2',
    );
  });

  it('"흐름 미리보기"를 누르면 dialogNodesApi.flow가 호출되고 트리가 렌더링된다', async () => {
    const user = userEvent.setup();
    const tree: FlowTree = {
      roots: [
        {
          nodeId: 'node-1',
          name: '배송조회_응답',
          nodeType: 'NORMAL',
          via: 'ROOT',
          repeated: false,
          children: [],
        },
      ],
      orphanNodes: [],
    };
    mockFlow.mockResolvedValue(tree);
    renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: '흐름 미리보기' }));

    expect(mockFlow).toHaveBeenCalledWith('bot-1');
    // 목록의 "배송조회_응답"(버튼)과 트리 내부 링크(같은 이름)가 모두 존재해야 한다.
    expect(await screen.findAllByText('배송조회_응답')).toHaveLength(2);
  });

  it('노드 삭제가 409로 거부되면 kind=node 삭제차단 배너가 표시되고 참조 노드 링크가 제공된다', async () => {
    const user = userEvent.setup();
    mockRemove.mockRejectedValue(
      new ApiError(409, '이 노드로 이동하도록 설정된 노드가 1건 있습니다.', 'NODE_IN_USE', [
        { field: 'node-9', message: '이동출발노드' },
      ]),
    );
    renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: '배송조회_응답 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    const dialog = await screen.findByRole('dialog', { name: '노드 삭제' });
    await user.click(screen.getByRole('button', { name: '삭제', exact: true }));

    expect(await screen.findByText('이 노드로 이동하도록 설정된 노드가 1건 있습니다.')).toBeInTheDocument();
    const link = screen.getByRole('button', { name: '이동출발노드' });
    await user.click(link);
    expect(await screen.findByText('노드 편집 화면')).toBeInTheDocument();
    void dialog;
  });

  // [No.26 1차 코드리뷰 반영] `dialogNodesApi.copy`가 `DialogNodeCopyResponse`(shared-types 정식 타입)를
  // 반환하도록 계약이 확장됐다 — `as unknown as` 캐스팅 없이 `excludedLegacyApiOutputCount`를 읽는다.
  it('복사 시 excludedLegacyApiOutputCount > 0이면 토스트에 이전 형식 API 조건 제외 안내가 함께 뜬다', async () => {
    const user = userEvent.setup();
    mockCopy.mockResolvedValue({
      ...makeNodeItem({ name: '배송조회_응답 (사본)', enabled: false }),
      excludedLegacyApiOutputCount: 1,
    });
    renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: '배송조회_응답 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '복사' }));

    expect(await screen.findByText(/이전 형식 API 조건 1개는 복사되지 않았습니다/)).toBeInTheDocument();
  });

  // [No.27] v1 SURVEY도 복사에서 제외된다 — 같은 토스트에 이어 붙는다(FR-SV1-5, No.26 패턴 재사용).
  it('복사 시 excludedLegacySurveyOutputCount > 0이면 토스트에 이전 형식 설문 연결 제외 안내가 함께 뜬다', async () => {
    const user = userEvent.setup();
    mockCopy.mockResolvedValue({
      ...makeNodeItem({ name: '배송조회_응답 (사본)', enabled: false }),
      excludedLegacyApiOutputCount: 0,
      excludedLegacySurveyOutputCount: 1,
    });
    renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: '배송조회_응답 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '복사' }));

    expect(await screen.findByText(/이전 형식 설문 연결 1개는 복사되지 않았습니다/)).toBeInTheDocument();
  });

  it('복사 시 excludedLegacyApiOutputCount가 0이면 제외 안내 없이 기본 성공 토스트만 뜬다', async () => {
    const user = userEvent.setup();
    mockCopy.mockResolvedValue({
      ...makeNodeItem({ name: '배송조회_응답 (사본)', enabled: false }),
      excludedLegacyApiOutputCount: 0,
    });
    renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: '배송조회_응답 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '복사' }));

    expect(await screen.findByText("'배송조회_응답 (사본)'이 생성되었습니다. 새 노드는 비활성 상태입니다.")).toBeInTheDocument();
    expect(screen.queryByText(/이전 형식 API 조건/)).not.toBeInTheDocument();
  });
});

/** [신규 No.22] D1-ext — 토픽 필터·열(topic-system-ui-spec.md §3.3). */
describe('NodesListPage — 토픽 필터', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue({ items: [makeNodeItem({ topicId: 'topic-1', crossTopicRefCount: 2 })], total: 1, page: 1, pageSize: 20 });
    mockIntentsList.mockReset().mockResolvedValue({ items: [], total: 0 });
  });

  it('토픽 필터에서 토픽을 선택하면 목록 조회에 topicIds가 실려 간다', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('배송조회_응답');

    await user.click(screen.getByRole('button', { name: /^토픽:/ }));
    await user.click(await screen.findByRole('checkbox', { name: '배송' }));

    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith('bot-1', expect.objectContaining({ topicIds: ['topic-1'] })));
  });

  it('노드 목록의 토픽 열에 토픽 이름과 "다른 토픽 참조 n" 배지가 표시된다', async () => {
    renderPage();
    await screen.findByText('배송조회_응답');

    expect(screen.getByText('배송')).toBeInTheDocument();
    expect(screen.getByText('다른 토픽 참조 2')).toBeInTheDocument();
  });
});

/** [코드 리뷰 1회차 M-1] 토픽 필터를 URL 쿼리 `topicIds=`로 유지한다 — 새로고침·뒤로가기 보존. */
describe('NodesListPage — 토픽 필터 URL 유지(M-1)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockList.mockResolvedValue({ items: [makeNodeItem({ topicId: 'topic-1' })], total: 1, page: 1, pageSize: 20 });
    mockIntentsList.mockReset().mockResolvedValue({ items: [], total: 0 });
  });

  function TestBackButton(): JSX.Element {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(-1)}>
        테스트용 뒤로가기
      </button>
    );
  }

  it('URL에 이미 topicIds가 있으면(새로고침과 동일한 상황) 그 값으로 목록을 조회한다', async () => {
    render(
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/nodes?topicIds=topic-1']}>
        <ToastProvider>
          <Routes>
            <Route path="/chatbots/:chatbotId/dialogue/nodes" element={<NodesListPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockList).toHaveBeenCalledWith('bot-1', expect.objectContaining({ topicIds: ['topic-1'] })));
  });

  it('필터를 적용한 뒤 브라우저 뒤로가기를 하면 이전 URL(필터 없음) 기준으로 다시 조회한다', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={['/chatbots/bot-1/dialogue/nodes', '/chatbots/bot-1/dialogue/nodes?topicIds=topic-1']}
        initialIndex={1}
      >
        <ToastProvider>
          <TestBackButton />
          <Routes>
            <Route path="/chatbots/:chatbotId/dialogue/nodes" element={<NodesListPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockList).toHaveBeenCalledWith('bot-1', expect.objectContaining({ topicIds: ['topic-1'] })));

    await user.click(screen.getByRole('button', { name: '테스트용 뒤로가기' }));

    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith('bot-1', expect.objectContaining({ topicIds: undefined })));
  });
});
