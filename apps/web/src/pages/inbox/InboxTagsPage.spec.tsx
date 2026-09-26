import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../components/Toast';
import { InboxTagsPage } from './InboxTagsPage';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';

let mockRole: 'ADMIN' | 'AGENT' = 'ADMIN';
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', name: '김상담', role: mockRole } }),
}));

vi.mock('../../api/inbox', () => ({
  inboxApi: {
    tags: { list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  },
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <InboxTagsPage />
    </ToastProvider>,
  );
}

describe('InboxTagsPage(OI-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRole = 'ADMIN';
  });

  it('ADMIN은 추가·수정·삭제 버튼을 볼 수 있다', async () => {
    vi.mocked(inboxApi.tags.list).mockResolvedValue([{ id: 't1', name: '환불', color: 'RED', usageCount: 12 }]);
    renderPage();

    expect(await screen.findByText('환불')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ 태그 추가' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '수정' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });

  it('ADMIN이 아니면(AGENT 등) 읽기 전용 목록만 보이고 관리 버튼이 없다', async () => {
    mockRole = 'AGENT';
    vi.mocked(inboxApi.tags.list).mockResolvedValue([{ id: 't1', name: '환불', color: 'RED', usageCount: 12 }]);
    renderPage();

    expect(await screen.findByText('환불')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ 태그 추가' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '수정' })).not.toBeInTheDocument();
    expect(screen.getByText('조회만 가능합니다 — 태그 추가·수정·삭제는 관리자만 할 수 있습니다.')).toBeInTheDocument();
  });

  it('빈 목록이면 안내를 보여준다', async () => {
    vi.mocked(inboxApi.tags.list).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('등록된 태그가 없습니다.')).toBeInTheDocument();
  });

  it('이름 중복(DUPLICATE_NAME) 저장 시 인라인 오류를 보여준다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.tags.list).mockResolvedValue([]);
    vi.mocked(inboxApi.tags.create).mockRejectedValue(new ApiError(409, '중복', 'DUPLICATE_NAME'));
    renderPage();

    await screen.findByText('등록된 태그가 없습니다.');
    await user.click(screen.getByRole('button', { name: '+ 태그 추가' }));
    await user.type(screen.getByLabelText('이름'), '환불');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('이미 사용 중인 태그 이름입니다.')).toBeInTheDocument();
  });

  it('사용 중인 태그를 삭제하면 확인 모달을 거쳐 force=true로 삭제한다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.tags.list).mockResolvedValue([{ id: 't1', name: '환불', color: 'RED', usageCount: 12 }]);
    vi.mocked(inboxApi.tags.remove).mockResolvedValue(undefined);
    renderPage();

    await screen.findByText('환불');
    await user.click(screen.getByRole('button', { name: '삭제' }));
    expect(await screen.findByText(/12개 스레드에서 쓰이고 있습니다/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: '삭제' })[1]);

    expect(inboxApi.tags.remove).toHaveBeenCalledWith('t1', true);
  });
});
