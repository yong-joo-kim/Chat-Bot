import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Chatbot, IntentListItem, KeywordListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { ApiError } from '../../api/client';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { IntentsKeywordsPage } from './IntentsKeywordsPage';

const mockIntentsList = vi.fn();
const mockIntentsCreate = vi.fn();
const mockIntentsRemove = vi.fn();
const mockKeywordsList = vi.fn();
const mockKeywordsCreate = vi.fn();
const mockKeywordsRemove = vi.fn();

vi.mock('../../api/dialogue', () => ({
  intentsApi: {
    list: (...args: unknown[]) => mockIntentsList(...args),
    create: (...args: unknown[]) => mockIntentsCreate(...args),
    remove: (...args: unknown[]) => mockIntentsRemove(...args),
    findOne: vi.fn().mockResolvedValue({ id: 'intent-1', name: '배송조회', description: undefined, examples: [], topicId: undefined, linkedNodes: [] }),
    bulkDelete: vi.fn(),
    importValidate: vi.fn(),
    importCommit: vi.fn(),
    templateUrl: () => '/template',
    exportUrl: () => '/export',
  },
  keywordsApi: {
    list: (...args: unknown[]) => mockKeywordsList(...args),
    create: (...args: unknown[]) => mockKeywordsCreate(...args),
    remove: (...args: unknown[]) => mockKeywordsRemove(...args),
    findOne: vi.fn().mockResolvedValue({ id: 'keyword-1', name: '택배사', description: undefined, synonyms: [], topicId: undefined, linkedNodes: [] }),
    bulkDelete: vi.fn(),
    importValidate: vi.fn(),
    importCommit: vi.fn(),
    templateUrl: () => '/template',
    exportUrl: () => '/export',
  },
  // BulkImportModal(같은 페이지가 렌더링)이 리소스 종류와 무관하게 3개 API를 모두 import하므로 함께 목 처리한다.
  faqsApi: {
    list: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    bulkDelete: vi.fn(),
    importValidate: vi.fn(),
    importCommit: vi.fn(),
    templateUrl: vi.fn(),
    exportUrl: () => '/export',
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

// [신규 No.22 — 코드리뷰 2회차 보강] 토픽 필터 드롭다운이 선택지를 가지려면 실제 토픽이 1개는 있어야 한다.
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

const intentItem: IntentListItem = {
  id: 'intent-1',
  name: '배송조회',
  description: undefined,
  exampleCount: 4,
  linkedNodeCount: 2,
  updatedAt: new Date('2026-09-18T00:00:00.000Z'),
};

const keywordItem: KeywordListItem = {
  id: 'keyword-1',
  name: '택배사',
  description: undefined,
  synonymCount: 4,
  linkedNodeCount: 0,
  updatedAt: new Date('2026-09-18T00:00:00.000Z'),
};

function renderPage(initialEntry = '/chatbots/bot-1/dialogue/intents'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/intents" element={<IntentsKeywordsPage />} />
          <Route path="/chatbots/:chatbotId/dialogue/homonyms" element={<p>동음이의어 사전 화면</p>} />
          <Route path="/chatbots/:chatbotId/dialogue/contexts/:id" element={<p>컨텍스트 편집 화면</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * 의도·키워드 CRUD 플로우 + 삭제차단 배너 참조종류 매핑(H2) 통합 회귀 시험.
 */
describe('IntentsKeywordsPage — 의도/키워드 CRUD', () => {
  beforeEach(() => {
    mockIntentsList.mockReset();
    mockIntentsCreate.mockReset();
    mockIntentsRemove.mockReset();
    mockKeywordsList.mockReset();
    mockKeywordsCreate.mockReset();
    mockKeywordsRemove.mockReset();
    mockIntentsList.mockResolvedValue({ items: [intentItem], total: 1, page: 1, pageSize: 20 });
    mockKeywordsList.mockResolvedValue({ items: [keywordItem], total: 1, page: 1, pageSize: 20 });
  });

  it('의도 탭이 기본으로 목록을 렌더링한다', async () => {
    renderPage();
    expect(await screen.findByText('배송조회')).toBeInTheDocument();
    expect(mockIntentsList).toHaveBeenCalledWith('bot-1', expect.objectContaining({ page: 1, pageSize: 20 }));
  });

  it('"+ 의도 추가" → 이름/예문 입력 → 저장하면 intentsApi.create가 예문 배열과 함께 호출된다', async () => {
    const user = userEvent.setup();
    mockIntentsCreate.mockResolvedValue({
      intent: { id: 'intent-2', name: '환불문의', examples: ['환불 절차'], linkedNodes: [] },
      meta: { deduplicatedCount: 0, conflicts: [] },
    });
    renderPage();
    await screen.findByText('배송조회');

    await user.click(screen.getByRole('button', { name: '+ 의도 추가' }));
    const dialog = await screen.findByRole('dialog', { name: '의도 추가' });
    await user.type(within(dialog).getByLabelText('이름 *'), '환불문의');
    await user.type(within(dialog).getByPlaceholderText('새 예문 입력'), '환불 절차');
    await user.click(within(dialog).getByRole('button', { name: '추가' }));
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(mockIntentsCreate).toHaveBeenCalledWith('bot-1', { name: '환불문의', description: undefined, examples: ['환불 절차'] }),
    );
    expect(await screen.findByText('저장되었습니다.')).toBeInTheDocument();
  });

  it('키워드 탭으로 전환하면 키워드 목록을 조회하고, "+ 키워드 추가"로 동의어를 등록할 수 있다', async () => {
    const user = userEvent.setup();
    mockKeywordsCreate.mockResolvedValue({ id: 'keyword-2', name: '메뉴', synonyms: ['아메리카노'], linkedNodes: [] });
    renderPage();
    await screen.findByText('배송조회');

    await user.click(screen.getByRole('tab', { name: '키워드' }));
    expect(await screen.findByText('택배사')).toBeInTheDocument();
    expect(mockKeywordsList).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '+ 키워드 추가' }));
    const dialog = await screen.findByRole('dialog', { name: '키워드 추가' });
    await user.type(within(dialog).getByLabelText('이름 *'), '메뉴');
    await user.type(within(dialog).getByPlaceholderText('새 동의어 입력'), '아메리카노');
    await user.click(within(dialog).getByRole('button', { name: '추가' }));
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(mockKeywordsCreate).toHaveBeenCalledWith('bot-1', { name: '메뉴', description: undefined, synonyms: ['아메리카노'] }),
    );
  });

  it('H2: 의도 삭제가 동음이의어 참조로 거부되면 배너가 동음이의어 사전 화면으로 안내한다', async () => {
    const user = userEvent.setup();
    mockIntentsRemove.mockRejectedValue(
      new ApiError(409, '이 의도를 연결한 동음이의어 사전 항목이 1건 있습니다. 먼저 연결을 정리해 주세요.', 'INTENT_IN_USE', [
        { field: 'homonym-1', message: '배' },
      ]),
    );
    renderPage();
    await screen.findByText('배송조회');

    await user.click(screen.getByRole('button', { name: '배송조회 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    await screen.findByRole('dialog', { name: '의도 삭제' });
    await user.click(screen.getByRole('button', { name: '삭제', exact: true }));

    expect(await screen.findByText(/동음이의어 사전 항목이 1건 있습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '배' }));
    expect(await screen.findByText('동음이의어 사전 화면')).toBeInTheDocument();
  });

  it('H2: 키워드 삭제가 컨텍스트 슬롯 참조로 거부되면 배너가 컨텍스트 편집 화면으로 안내한다', async () => {
    const user = userEvent.setup();
    mockKeywordsRemove.mockRejectedValue(
      new ApiError(409, '이 키워드를 참조하는 컨텍스트 슬롯이 1건 있습니다. 먼저 슬롯을 정리해 주세요.', 'KEYWORD_IN_USE', [
        { field: 'context-1', message: '커피주문' },
      ]),
    );
    renderPage();
    await screen.findByText('배송조회');
    await userEvent.setup().click(screen.getByRole('tab', { name: '키워드' }));
    await screen.findByText('택배사');

    await user.click(screen.getByRole('button', { name: '택배사 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    await screen.findByRole('dialog', { name: '키워드 삭제' });
    await user.click(screen.getByRole('button', { name: '삭제', exact: true }));

    expect(await screen.findByText(/컨텍스트 슬롯이 1건 있습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '커피주문' }));
    expect(await screen.findByText('컨텍스트 편집 화면')).toBeInTheDocument();
  });

  it('참조가 없는 의도 삭제는 성공 토스트와 함께 목록이 재조회된다', async () => {
    const user = userEvent.setup();
    mockIntentsRemove.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText('배송조회');
    mockIntentsList.mockClear();

    await user.click(screen.getByRole('button', { name: '배송조회 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    await screen.findByRole('dialog', { name: '의도 삭제' });
    await user.click(screen.getByRole('button', { name: '삭제', exact: true }));

    expect(await screen.findByText('삭제되었습니다.')).toBeInTheDocument();
    await waitFor(() => expect(mockIntentsList).toHaveBeenCalledTimes(1));
  });
});

/**
 * [신규 No.22 — 코드리뷰 2회차 보강] 토픽 필터(topicIds)를 바꿔도 이미 URL에 있던 다른 쿼리
 * (`?resource=`·`?edit=`)가 지워지지 않는지 확인한다(`useTopicFilterParam`이 함수형
 * `setSearchParams`로 기존 파라미터를 보존하는지의 행동적 증거 — lib/useTopicFilterParam.ts 주석
 * "[코드 리뷰 1회차 M-1]"의 회귀 방지).
 */
describe('IntentsKeywordsPage — 토픽 필터가 ?resource=·?edit=를 보존한다(M-1)', () => {
  beforeEach(() => {
    mockIntentsList.mockReset();
    mockKeywordsList.mockReset();
    mockIntentsList.mockResolvedValue({ items: [intentItem], total: 1, page: 1, pageSize: 20 });
    mockKeywordsList.mockResolvedValue({ items: [keywordItem], total: 1, page: 1, pageSize: 20 });
  });

  function LocationEcho(): JSX.Element {
    const location = useLocation();
    return <div data-testid="location-search">{location.search}</div>;
  }

  function renderPageWithLocation(initialEntry: string): ReturnType<typeof render> {
    return render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <LocationEcho />
          <Routes>
            <Route path="/chatbots/:chatbotId/dialogue/intents" element={<IntentsKeywordsPage />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  it('?resource=keyword&edit=keyword-1 상태에서 토픽 필터를 바꿔도 resource·edit 쿼리가 그대로 남는다', async () => {
    const user = userEvent.setup();
    renderPageWithLocation('/chatbots/bot-1/dialogue/intents?resource=keyword&edit=keyword-1');

    await screen.findByText('택배사');
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('location-search').textContent).toContain('resource=keyword');
    expect(screen.getByTestId('location-search').textContent).toContain('edit=keyword-1');

    await user.click(screen.getByRole('button', { name: /^토픽:/ }));
    await user.click(await screen.findByRole('checkbox', { name: '배송' }));

    await waitFor(() => expect(mockKeywordsList).toHaveBeenLastCalledWith('bot-1', expect.objectContaining({ topicIds: ['topic-1'] })));

    const search = screen.getByTestId('location-search').textContent ?? '';
    expect(search).toContain('resource=keyword'); // 리소스 탭이 지워지지 않는다
    expect(search).toContain('edit=keyword-1'); // 편집 모달 상태가 지워지지 않는다
    expect(search).toContain('topicIds=topic-1'); // 토픽 필터도 함께 반영된다
  });
});
