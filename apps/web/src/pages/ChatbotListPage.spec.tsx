import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { ApiError } from '../api/client';
import { makeChatbotListItem, makeGroup } from '../test/fixtures';
import { ChatbotListPage } from './ChatbotListPage';

const mockGroupsList = vi.fn();
const mockGroupsCreate = vi.fn();
const mockGroupsRemove = vi.fn();
vi.mock('../api/groups', () => ({
  groupsApi: {
    list: (...args: unknown[]) => mockGroupsList(...args),
    create: (...args: unknown[]) => mockGroupsCreate(...args),
    update: vi.fn(),
    remove: (...args: unknown[]) => mockGroupsRemove(...args),
    copy: vi.fn(),
  },
}));

const mockChatbotsList = vi.fn();
const mockChatbotsCreate = vi.fn();
vi.mock('../api/chatbots', () => ({
  chatbotsApi: {
    list: (...args: unknown[]) => mockChatbotsList(...args),
    create: (...args: unknown[]) => mockChatbotsCreate(...args),
    slugAvailable: vi.fn().mockResolvedValue({ slug: 'refund-bot', available: true, message: '사용 가능한 고유 URL입니다.' }),
  },
}));

const group = makeGroup({ id: 'group-1', name: '고객지원 그룹', chatbotCount: 1 });
const chatbotItem = makeChatbotListItem({ id: 'bot-1', groupId: 'group-1', groupName: '고객지원 그룹', name: '주문 상담봇', slug: 'order-bot' });

function renderPage(initialEntry = '/chatbots'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <Routes>
          <Route path="/chatbots" element={<ChatbotListPage />} />
          <Route path="/chatbots/:chatbotId/settings" element={<p>설정 화면(생성 직후 자동 이동)</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * 그룹/챗봇 CRUD 플로우 회귀 시험. `docs/requirements/chatbot-operations.md` S-1(신규 개설)/
 * EX-1-3(잔여 챗봇 그룹 삭제 거부) 시나리오를 실제 렌더링·클릭으로 검증한다.
 */
describe('ChatbotListPage — 그룹/챗봇 CRUD 플로우', () => {
  beforeEach(() => {
    mockGroupsList.mockReset();
    mockGroupsCreate.mockReset();
    mockGroupsRemove.mockReset();
    mockChatbotsList.mockReset();
    mockChatbotsCreate.mockReset();
    mockGroupsList.mockResolvedValue({ items: [group], total: 1, page: 1, pageSize: 100 });
    mockChatbotsList.mockResolvedValue({ items: [chatbotItem], total: 1, page: 1, pageSize: 20 });
  });

  it('그룹과 챗봇 목록을 불러와 렌더링한다', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: '고객지원 그룹 1' })).toBeInTheDocument();
    expect(await screen.findByText('총 1건')).toBeInTheDocument();
    expect(screen.getAllByText('주문 상담봇').length).toBeGreaterThan(0);
  });

  it('S-1: "+ 그룹 추가" → 이름 입력 → 저장하면 groupsApi.create가 호출되고 완료 토스트가 뜬다', async () => {
    const user = userEvent.setup();
    mockGroupsCreate.mockResolvedValue(makeGroup({ id: 'group-2', name: '마케팅 그룹', chatbotCount: 0 }));
    renderPage();
    await screen.findByRole('button', { name: '고객지원 그룹 1' });

    await user.click(screen.getByRole('button', { name: '+ 그룹 추가' }));
    const dialog = await screen.findByRole('dialog', { name: '그룹 추가' });
    await user.type(within(dialog).getByLabelText('그룹 이름 *'), '마케팅 그룹');
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() => expect(mockGroupsCreate).toHaveBeenCalledWith({ name: '마케팅 그룹', description: undefined }));
    expect(await screen.findByText('그룹이 생성되었습니다.')).toBeInTheDocument();
    // 성공 후 목록이 재조회된다(최초 1회 + 재조회 1회).
    await waitFor(() => expect(mockGroupsList).toHaveBeenCalledTimes(2));
  });

  it('그룹 이름 입력 중 동일 이름이 이미 있으면 차단하지 않는 안내 문구를 보여준다(FR-1-6)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: '고객지원 그룹 1' });

    await user.click(screen.getByRole('button', { name: '+ 그룹 추가' }));
    const dialog = await screen.findByRole('dialog', { name: '그룹 추가' });
    await user.type(within(dialog).getByLabelText('그룹 이름 *'), '고객지원 그룹');

    expect(within(dialog).getByText('같은 이름의 그룹이 있습니다.')).toBeInTheDocument();
  });

  it('EX-1-3: 소속 챗봇이 있는 그룹 삭제는 409로 거부되고 모달 내부 배너로 사유를 안내한다', async () => {
    const user = userEvent.setup();
    mockGroupsRemove.mockRejectedValue(new ApiError(409, '소속 챗봇 1개를 먼저 이동하거나 삭제해 주세요.', 'GROUP_NOT_EMPTY'));
    renderPage();
    await screen.findByRole('button', { name: '고객지원 그룹 1' });

    await user.click(screen.getByRole('button', { name: '고객지원 그룹 그룹 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '그룹 삭제' }));

    const dialog = await screen.findByRole('dialog', { name: '그룹 삭제' });
    await user.click(within(dialog).getByRole('button', { name: '삭제' }));

    expect(await within(dialog).findByText('소속 챗봇 1개를 먼저 이동하거나 삭제해 주세요.')).toBeInTheDocument();
    // 409 응답이므로 그룹은 보존되고 모달은 닫히지 않는다.
    expect(screen.getByRole('dialog', { name: '그룹 삭제' })).toBeInTheDocument();
  });

  it('S-1: "+ 챗봇 만들기" → 이름/slug 입력 → 저장하면 생성 후 설정 화면으로 자동 이동한다', async () => {
    const user = userEvent.setup();
    mockChatbotsCreate.mockResolvedValue({ id: 'bot-2', groupId: 'group-1', name: '환불 상담봇', slug: 'refund-bot' });
    renderPage();
    await screen.findByRole('button', { name: '고객지원 그룹 1' });

    await user.click(screen.getByRole('button', { name: '+ 챗봇 만들기' }));
    const dialog = await screen.findByRole('dialog', { name: '챗봇 만들기' });
    await user.type(within(dialog).getByLabelText('이름 *'), '환불 상담봇');
    await user.type(within(dialog).getByLabelText('고유 URL(slug) *'), 'refund-bot');
    await user.click(within(dialog).getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(mockChatbotsCreate).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'group-1', name: '환불 상담봇', slug: 'refund-bot' }),
      ),
    );
    expect(await screen.findByText('설정 화면(생성 직후 자동 이동)')).toBeInTheDocument();
  });

  it('AC-5-3: 그룹 생성 전 과정을 마우스 클릭 없이 키보드(Tab/Enter)만으로 완료할 수 있다', async () => {
    const user = userEvent.setup();
    mockGroupsCreate.mockResolvedValue(makeGroup({ id: 'group-3', name: '키보드로만든그룹', chatbotCount: 0 }));
    renderPage();
    await screen.findByRole('button', { name: '고객지원 그룹 1' });

    // 1) Tab 한 번으로 페이지 첫 상호작용 요소("+ 그룹 추가")에 도달한다(클릭 없음).
    await user.tab();
    expect(screen.getByRole('button', { name: '+ 그룹 추가' })).toHaveFocus();

    // 2) Enter로 모달을 연다(클릭 없이 키보드 활성화).
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: '그룹 추가' });

    // 3) 모달 안에서 Tab으로 이름 입력 필드까지 이동한다(닫기 버튼 -> 이름 입력).
    await user.tab();
    expect(within(dialog).getByLabelText('그룹 이름 *')).toHaveFocus();

    // 4) 키보드로 값을 입력하고 Enter로 폼을 제출한다(저장 버튼을 클릭하지 않음).
    await user.keyboard('키보드로만든그룹');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(mockGroupsCreate).toHaveBeenCalledWith({ name: '키보드로만든그룹', description: undefined }));
    expect(await screen.findByText('그룹이 생성되었습니다.')).toBeInTheDocument();
  });

  it('그룹이 0개면 "+ 챗봇 만들기"가 비활성화된다(EX-1-5)', async () => {
    mockGroupsList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    mockChatbotsList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('그룹이 없습니다. 그룹을 먼저 만들어 주세요.')).toBeInTheDocument();
    for (const btn of screen.getAllByRole('button', { name: '+ 챗봇 만들기' })) {
      expect(btn).toBeDisabled();
    }
  });
});
