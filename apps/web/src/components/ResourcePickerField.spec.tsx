import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ResourcePickerField } from './ResourcePickerField';
import { makeChatbotListItem } from '../test/fixtures';

const mockChatbotsList = vi.fn();
const mockChatbotsFindOne = vi.fn();

vi.mock('../api/chatbots', () => ({
  chatbotsApi: {
    list: (...args: unknown[]) => mockChatbotsList(...args),
    findOne: (...args: unknown[]) => mockChatbotsFindOne(...args),
  },
}));

// 다른 4종(intent/keyword/context/node)은 사용하지 않지만 모듈이 import되므로 목을 제공한다.
vi.mock('../api/dialogue', () => ({
  intentsApi: { list: vi.fn(), findOne: vi.fn() },
  keywordsApi: { list: vi.fn(), findOne: vi.fn() },
  contextsApi: { list: vi.fn(), findOne: vi.fn() },
  dialogNodesApi: { list: vi.fn(), findOne: vi.fn() },
}));

const mockApiConnectionsPicker = vi.fn();
vi.mock('../api/apiConnections', () => ({
  apiConnectionsApi: { picker: (...args: unknown[]) => mockApiConnectionsPicker(...args) },
}));

/**
 * `ResourcePickerField`의 `resourceType='chatbot'` 자동시험 — 2차 코드리뷰 Low 관찰사항(a) 커버.
 * `chatbot`은 다른 4종과 달리 챗봇 "안"의 리소스가 아니라 챗봇 자체를 전역 검색 대상으로 삼는다
 * (security-audit-ui-spec.md §3.9 `AuditLogFilterBar`의 chatbotId 필터). `chatbotId` prop 없이도
 * 동작해야 하며, 검색은 `chatbotsApi.list`를 호출하고 선택된 값의 이름 조회는 `chatbotsApi.findOne`을
 * 호출해야 한다(다른 4종의 챗봇 스코프 API가 아니라).
 */
describe('ResourcePickerField — resourceType="chatbot" (전역 챗봇 검색·선택)', () => {
  beforeEach(() => {
    mockChatbotsList.mockReset();
    mockChatbotsFindOne.mockReset();
  });

  it('chatbotId prop 없이도 검색어를 입력하면 전역 챗봇 목록 API를 호출해 후보를 보여준다', async () => {
    mockChatbotsList.mockResolvedValue({ items: [makeChatbotListItem({ id: 'bot-1', name: '주문 상담봇' })], total: 1, page: 1, pageSize: 20 });
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ResourcePickerField id="picker" label="챗봇" resourceType="chatbot" multiple={false} value={null} onChange={onChange} />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('combobox'), '주문');

    await waitFor(() => expect(mockChatbotsList).toHaveBeenCalled());
    // chatbotId(스코프)를 넘기지 않고(빈 문자열) 호출되어야 한다 — 전역 검색이므로.
    expect(mockChatbotsList.mock.calls[0][0]).toEqual({ q: '주문', page: 1, pageSize: 20 });

    expect(await screen.findByRole('option', { name: '주문 상담봇' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: '주문 상담봇' }));
    expect(onChange).toHaveBeenCalledWith('bot-1');
  });

  it('이미 선택된 챗봇 id가 있으면 chatbotsApi.findOne으로 이름을 조회해 칩에 표시한다', async () => {
    mockChatbotsFindOne.mockResolvedValue({ id: 'bot-2', name: '환불 상담봇' });

    render(
      <MemoryRouter>
        <ResourcePickerField id="picker" label="챗봇" resourceType="chatbot" multiple={false} value="bot-2" onChange={vi.fn()} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(mockChatbotsFindOne).toHaveBeenCalledWith('bot-2'));
    expect(await screen.findByText('환불 상담봇')).toBeInTheDocument();
  });
});

/**
 * [No.26] `resourceType='apiConnection'` — 전역 자원이라 `chatbotId` prop이 필요 없다(ui-spec §2.2).
 * `GET /api-connections/picker`(dialogue:read)는 `q` 검색을 지원하지 않으므로 클라이언트에서
 * 이름으로 필터링하고, 사용 중지된 연결은 "(사용 중지)" 접미사를 붙여 후보에 남긴다.
 */
describe('ResourcePickerField — resourceType="apiConnection" (전역 연결 검색·선택)', () => {
  beforeEach(() => {
    mockApiConnectionsPicker.mockReset();
  });

  it('검색어를 입력하면 picker() 전체 목록을 클라이언트에서 이름으로 필터링해 후보를 보여준다', async () => {
    mockApiConnectionsPicker.mockResolvedValue({
      items: [
        { id: 'conn-1', name: 'ERP 주문', allowedMethods: ['GET', 'POST'], enabled: true, personalDataLookup: false, allowRawPersonalData: false, sampleLabels: [] },
        { id: 'conn-2', name: '결제조회', allowedMethods: ['GET'], enabled: false, personalDataLookup: false, allowRawPersonalData: false, sampleLabels: [] },
      ],
    });
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ResourcePickerField id="picker" label="연결" resourceType="apiConnection" multiple={false} value={null} onChange={onChange} />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('combobox'), 'ERP');

    expect(await screen.findByRole('option', { name: 'ERP 주문' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /결제조회/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'ERP 주문' }));
    expect(onChange).toHaveBeenCalledWith('conn-1');
  });

  it('사용 중지된 연결도 "(사용 중지)" 접미사와 함께 후보에 남는다', async () => {
    mockApiConnectionsPicker.mockResolvedValue({
      items: [{ id: 'conn-2', name: '결제조회', allowedMethods: ['GET'], enabled: false, personalDataLookup: false, allowRawPersonalData: false, sampleLabels: [] }],
    });
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <ResourcePickerField id="picker" label="연결" resourceType="apiConnection" multiple={false} value={null} onChange={vi.fn()} />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole('combobox'), '결제');

    expect(await screen.findByRole('option', { name: '결제조회 (사용 중지)' })).toBeInTheDocument();
  });
});
