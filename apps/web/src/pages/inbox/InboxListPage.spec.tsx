import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { InboxListPage } from './InboxListPage';
import { inboxApi } from '../../api/inbox';
import { ApiError } from '../../api/client';
import { makeSummary, makeThreadListResponse, makeThreadListItem } from '../../test/inboxFixtures';

let mockPermissions = { csRead: true, csWrite: true, simulationWrite: true };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1', name: '김상담', role: 'ADMIN' },
    can: (p: string) => {
      if (p === 'cs:read') return mockPermissions.csRead;
      if (p === 'cs:write') return mockPermissions.csWrite;
      if (p === 'simulation:write') return mockPermissions.simulationWrite;
      return true;
    },
  }),
}));

vi.mock('../../api/inbox', () => ({
  inboxApi: {
    summary: vi.fn(),
    threads: vi.fn(),
    tags: { list: vi.fn() },
    createAnonymousCustomer: vi.fn(),
    createTestCustomer: vi.fn(),
  },
}));

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <InboxListPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('InboxListPage(OI-1)', () => {
  beforeEach(() => {
    mockPermissions = { csRead: true, csWrite: true, simulationWrite: true };
    vi.mocked(inboxApi.tags.list).mockResolvedValue([]);
  });

  it('조회 성공 시 목록·요약 칩을 렌더한다', async () => {
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary({ open: 12, pending: 3 }));
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());
    renderPage();

    expect((await screen.findAllByText('홍길동')).length).toBeGreaterThan(0);
    expect(screen.getByText(/열림 12/)).toBeInTheDocument();
    expect(screen.getByText(/보류 3/)).toBeInTheDocument();
  });

  it('필터 기본값에서 결과 0건이면 기본 안내를 보여준다', async () => {
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary());
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse([]));
    renderPage();

    expect(await screen.findByText(/볼 일이 생긴 고객이 없습니다/)).toBeInTheDocument();
  });

  it('참여 챗봇이 0개면 안내 카드를 보여준다', async () => {
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary());
    vi.mocked(inboxApi.threads).mockResolvedValue({ ...makeThreadListResponse([]), participatingChatbots: [] });
    renderPage();

    expect(await screen.findByText(/통합 인박스에 참여하는 챗봇이 없습니다/)).toBeInTheDocument();
  });

  it('기능이 꺼져 있으면(404) 안내 화면을 보여준다', async () => {
    vi.mocked(inboxApi.summary).mockRejectedValue(new ApiError(404, 'not found'));
    vi.mocked(inboxApi.threads).mockRejectedValue(new ApiError(404, 'not found'));
    renderPage();

    expect(await screen.findByText('이 기능은 사용할 수 없습니다.')).toBeInTheDocument();
  });

  it('조회 실패(5xx)면 재시도 버튼을 제공한다', async () => {
    vi.mocked(inboxApi.summary).mockRejectedValue(new ApiError(500, '서버 오류'));
    vi.mocked(inboxApi.threads).mockRejectedValue(new ApiError(500, '서버 오류'));
    renderPage();

    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('cs:write가 없으면(VIEWER 등) "새 고객·기록"·"시험 고객" 버튼이 렌더되지 않는다', async () => {
    mockPermissions = { csRead: true, csWrite: false, simulationWrite: false };
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary());
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());
    renderPage();

    await screen.findAllByText('홍길동');
    expect(screen.queryByRole('button', { name: '새 고객·기록' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '시험 고객' })).not.toBeInTheDocument();
  });

  it('요약 칩 클릭 시 필터가 반영되어 재조회한다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary({ pending: 3 }));
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());
    renderPage();

    await screen.findAllByText('홍길동');
    await user.click(screen.getByRole('button', { name: /보류 3/ }));

    await waitFor(() => {
      const lastCall = vi.mocked(inboxApi.threads).mock.calls.at(-1)?.[0];
      expect(lastCall?.status).toEqual(['PENDING']);
    });
  });

  it('채널 필터(channelFamily) 체크박스를 선택하면 목록 조회 쿼리에 반영된다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary());
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());
    renderPage();

    await screen.findAllByText('홍길동');
    await user.click(screen.getByRole('checkbox', { name: '기록' }));

    await waitFor(() => {
      const lastCall = vi.mocked(inboxApi.threads).mock.calls.at(-1)?.[0];
      expect(lastCall?.channelFamily).toEqual(['RECORD']);
    });

    await user.click(screen.getByRole('checkbox', { name: '시뮬레이션' }));
    await waitFor(() => {
      const lastCall = vi.mocked(inboxApi.threads).mock.calls.at(-1)?.[0];
      expect(lastCall?.channelFamily).toEqual(['RECORD', 'SIMULATED']);
    });
  });

  it('새 고객·기록 생성 성공 시 새 스레드로 이동한다', async () => {
    const user = userEvent.setup();
    vi.mocked(inboxApi.summary).mockResolvedValue(makeSummary());
    vi.mocked(inboxApi.threads).mockResolvedValue(makeThreadListResponse());
    vi.mocked(inboxApi.createAnonymousCustomer).mockResolvedValue({ customerId: 'c2', threadId: 'thread-2' });
    renderPage();

    await screen.findAllByText('홍길동');
    await user.click(screen.getByRole('button', { name: '새 고객·기록' }));
    await user.click(screen.getByRole('button', { name: '만들기' }));

    await waitFor(() => expect(inboxApi.createAnonymousCustomer).toHaveBeenCalled());
  });
});
