import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../../api/client';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot } from '../../../test/fixtures';
import type { ChatbotDetailContext } from '../../ChatbotDetailLayout';
import { UtteranceAnalysisListPage } from './UtteranceAnalysisListPage';
import { CHATBOT_ID, makeCapability, makeListItem } from './testFixtures';

let mockContext: ChatbotDetailContext;
vi.mock('../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

let mockPermissions: string[] = [];
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => mockPermissions.includes(p), user: { governanceModeOn: false } }),
}));

const api = vi.hoisted(() => ({
  capability: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  downloadTemplate: vi.fn(),
}));
vi.mock('../../../api/utteranceAnalyses', () => ({ utteranceAnalysesApi: api }));

function page(items = [makeListItem()], total = items.length): { items: unknown[]; total: number; page: number; pageSize: number } {
  return { items, total, page: 1, pageSize: 20 };
}

function setup(opts: { permissions?: string[]; chatbot?: Parameters<typeof makeChatbot>[0] } = {}): ReturnType<typeof render> {
  mockPermissions = opts.permissions ?? ['dialogue:read', 'dialogue:write'];
  mockContext = {
    chatbot: makeChatbot({ id: CHATBOT_ID, ...opts.chatbot }),
    reload: vi.fn().mockResolvedValue(undefined),
    setUnsavedGuard: vi.fn(),
    learningSummary: null,
    refreshLearningSummary: vi.fn(),
  } as ChatbotDetailContext;
  return render(
    <MemoryRouter>
      <ToastProvider>
        <UtteranceAnalysisListPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.capability.mockResolvedValue(makeCapability());
  api.list.mockResolvedValue(page());
});

describe('UtteranceAnalysisListPage — 표·상태 글자(UA-1 §3.2~3.3)', () => {
  it('완료 행: caption·열 머리·수치·보존 만료·결과 보기/삭제 동작이 보인다', async () => {
    setup();

    expect(await screen.findByRole('table', { name: '발화 묶음 분석 목록' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '학습 후보' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '3월_VOC.xlsx' })).toBeInTheDocument();
    expect(screen.getByText('완료')).toBeInTheDocument();
    expect(screen.getByText('2,870')).toBeInTheDocument();
    expect(screen.getByText('412')).toBeInTheDocument();
    expect(screen.getByText(/2026-12-28 삭제 예정/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '3월_VOC.xlsx 결과 보기' })).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/stats/utterance-analyses/${makeListItem().id}`);
    expect(screen.getByRole('button', { name: '3월_VOC.xlsx 삭제' })).toBeInTheDocument();
    expect(screen.getByText('보관 중 4개 / 최대 20개')).toBeInTheDocument();
  });

  it('상태별 글자: 처리 중(단계+%)·오류(사유 첫 구절)·취소됨·대기 중, 진행 행은 수치·삭제 없음', async () => {
    api.list.mockResolvedValue(
      page([
        makeListItem({ id: 'r1', status: 'RUNNING', stage: 'PROBING', progress: 82, fileName: 'a.xlsx', validCount: 0, clusterCount: null, candidateCount: null }),
        makeListItem({ id: 'r2', status: 'FAILED', progress: 10, fileName: 'b.xlsx', failureReason: 'EMBEDDING_UNAVAILABLE', clusterCount: null, candidateCount: null }),
        makeListItem({ id: 'r3', status: 'CANCELLED', fileName: 'c.xlsx', clusterCount: null, candidateCount: null }),
        makeListItem({ id: 'r4', status: 'QUEUED', fileName: 'd.xlsx', clusterCount: null, candidateCount: null }),
      ]),
    );
    setup();

    expect(await screen.findByText('처리 중 · 챗봇 대조 82%')).toBeInTheDocument();
    expect(screen.getByText(/오류 · 문장 분석 서비스가 응답하지 않아 중단되었습니다/)).toBeInTheDocument();
    expect(screen.getByText('취소됨')).toBeInTheDocument();
    expect(screen.getByText('대기 중')).toBeInTheDocument();
    // 처리 중·대기 중 행은 삭제 버튼이 없다(종결 상태만).
    expect(screen.queryByRole('button', { name: 'a.xlsx 삭제' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'd.xlsx 삭제' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'b.xlsx 삭제' })).toBeInTheDocument();
  });

  it('만료가 7일 이내면 "곧 삭제됩니다"를 글자로 병기한다', async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000);
    api.list.mockResolvedValue(page([makeListItem({ expiresAt: soon })]));
    setup();

    expect(await screen.findByText(/곧 삭제됩니다\(3일 남음\)/)).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisListPage — 권한·보관(§1.3)', () => {
  it('읽기 전용(VIEWER)은 새 분석·삭제를 렌더하지 않고 양식 받기는 보인다', async () => {
    setup({ permissions: ['dialogue:read'] });

    await screen.findByRole('table', { name: '발화 묶음 분석 목록' });
    expect(screen.queryByRole('link', { name: '새 분석' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '새 분석' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '양식 받기(엑셀)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '양식 받기(CSV)' })).toBeInTheDocument();
  });

  it('보관 챗봇은 쓰기 버튼을 숨기고 배너를 보인다', async () => {
    setup({ chatbot: { status: 'ARCHIVED' } });

    await screen.findByRole('table', { name: '발화 묶음 분석 목록' });
    expect(screen.queryByRole('link', { name: '새 분석' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /삭제/ })).not.toBeInTheDocument();
    expect(document.querySelector('.archived-banner')).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisListPage — 새 분석 사전 차단(§3.4)', () => {
  it('막힘 없음: "새 분석"이 UA-2로 가는 링크다', async () => {
    setup();
    const link = await screen.findByRole('link', { name: '새 분석' });
    expect(link).toHaveAttribute('href', `/chatbots/${CHATBOT_ID}/stats/utterance-analyses/new`);
  });

  it('문장 분석 서비스 연결 불가: aria-disabled 버튼 + 이유 글자가 연결된다(포커스 가능)', async () => {
    api.capability.mockResolvedValue(makeCapability({ embeddingAvailable: false }));
    setup();

    const button = await screen.findByRole('button', { name: '새 분석' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(reason).toHaveTextContent('문장 분석 서비스에 연결할 수 없어 지금은 새 분석을 만들 수 없습니다');
  });

  it('이 챗봇의 분석이 진행 중이면 이유와 진행 중 분석으로 가는 링크를 준다', async () => {
    api.capability.mockResolvedValue(makeCapability({ busy: { server: true, chatbot: true } }));
    api.list.mockResolvedValue(page([makeListItem({ id: 'run-1', status: 'RUNNING', stage: 'EMBEDDING', progress: 10 })]));
    setup();

    expect(await screen.findByText(/이 챗봇의 분석이 진행 중입니다/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '진행 중인 분석 보기' })).toHaveAttribute('href', expect.stringContaining('/run-1'));
  });

  it('다른 챗봇에서 진행 중이면 안내 글자만(링크 없음)', async () => {
    api.capability.mockResolvedValue(makeCapability({ busy: { server: true, chatbot: false } }));
    setup();

    expect(await screen.findByText(/다른 챗봇에서 분석이 진행 중입니다/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '진행 중인 분석 보기' })).not.toBeInTheDocument();
  });

  it('보관 가득이면 자동 삭제 없이 사용자에게 삭제를 안내한다', async () => {
    api.capability.mockResolvedValue(makeCapability({ stored: { count: 20, max: 20 } }));
    setup();

    expect(await screen.findByText(/보관할 수 있는 분석이 가득 찼습니다\(20\/20\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 분석' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('capability 조회가 404가 아닌 오류로 실패하면 버튼을 막지 않는다(서버 판정에 맡김)', async () => {
    api.capability.mockRejectedValue(new ApiError(500, 'x'));
    setup();

    expect(await screen.findByRole('link', { name: '새 분석' })).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisListPage — 빈·오류·꺼짐 상태', () => {
  it('분석 0건(쓰기 권한): 3단계 안내 + 양식 받기 + 새 분석 만들기', async () => {
    api.list.mockResolvedValue(page([], 0));
    setup();

    expect(await screen.findByText('아직 만든 분석이 없습니다')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('link', { name: '새 분석 만들기' })).toBeInTheDocument();
  });

  it('분석 0건(읽기 전용): 안내 문구만, 버튼 없음', async () => {
    api.list.mockResolvedValue(page([], 0));
    setup({ permissions: ['dialogue:read'] });

    expect(await screen.findByText(/편집 권한이 있는 담당자가 만들 수 있습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '새 분석 만들기' })).not.toBeInTheDocument();
  });

  it('조회 실패는 ErrorState + 다시 시도, 양식 받기 등 다른 영역은 정상', async () => {
    api.list.mockRejectedValueOnce(new ApiError(500, 'x'));
    setup();

    expect(await screen.findByText('분석 목록을 불러오지 못했습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '양식 받기(엑셀)' })).toBeInTheDocument();
    api.list.mockResolvedValue(page());
    await userEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(await screen.findByRole('table', { name: '발화 묶음 분석 목록' })).toBeInTheDocument();
  });

  it('기능 꺼짐(capability 404): 꺼짐 화면과 통계로 돌아가는 링크만, 재시도 버튼 없음', async () => {
    api.capability.mockRejectedValue(new ApiError(404, 'Not Found'));
    api.list.mockRejectedValue(new ApiError(404, 'Not Found'));
    setup();

    expect(await screen.findByText('발화 묶음 분석 기능이 꺼져 있습니다')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '챗봇 통계로 돌아가기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });

  it('상태 필터를 고르면 그 상태만 조회하고, 결과가 없으면 필터 지우기를 보인다', async () => {
    setup();
    await screen.findByRole('table', { name: '발화 묶음 분석 목록' });
    api.list.mockResolvedValue(page([], 0));

    await userEvent.click(screen.getByRole('button', { name: /상태: 전체/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: '오류' }));

    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(CHATBOT_ID, expect.objectContaining({ status: ['FAILED'], page: 1 })));
    expect(await screen.findByText('선택한 상태의 분석이 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '필터 지우기' })).toBeInTheDocument();
  });
});

describe('UtteranceAnalysisListPage — 삭제(UA-3b)', () => {
  it('확인 대화상자 기본 포커스는 취소, 삭제하면 행이 사라지고 토스트가 뜬다', async () => {
    api.remove.mockResolvedValue(undefined);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '3월_VOC.xlsx 삭제' }));

    const dialog = await screen.findByRole('dialog', { name: '분석 결과를 삭제할까요?' });
    expect(within(dialog).getByRole('button', { name: '취소' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(CHATBOT_ID, makeListItem().id));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('rowheader', { name: '3월_VOC.xlsx' })).not.toBeInTheDocument();
    expect(screen.getByText('분석을 삭제했습니다.')).toBeInTheDocument();
  });

  it('삭제 진행 중에는 확정 버튼이 disabled라 중복 실행되지 않는다', async () => {
    let resolve!: () => void;
    api.remove.mockReturnValue(new Promise<void>((r) => (resolve = r)));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '3월_VOC.xlsx 삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));

    const busy = await within(dialog).findByRole('button', { name: '삭제하는 중…' });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    expect(api.remove).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });

  it('409(처리 중)이면 대화상자 안에 원인+해결 문구를 보인다', async () => {
    api.remove.mockRejectedValue(new ApiError(409, 'x', 'INVALID_STATUS_TRANSITION'));
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '3월_VOC.xlsx 삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('처리 중인 분석은 삭제할 수 없습니다. 먼저 취소해 주세요.');
  });
});

describe('UtteranceAnalysisListPage — 취소 정리 중 삭제(M-A)', () => {
  it('취소 정리 중 409는 전용 문구를 보이고 대화상자는 열린 채 다시 삭제할 수 있다', async () => {
    api.remove
      .mockRejectedValueOnce(new ApiError(409, '취소를 정리하는 중입니다. 잠시 뒤 다시 삭제해 주세요.', 'INVALID_STATUS_TRANSITION'))
      .mockResolvedValueOnce(undefined);
    setup();
    await userEvent.click(await screen.findByRole('button', { name: '3월_VOC.xlsx 삭제' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('취소를 정리하는 중입니다. 잠시 뒤 다시 삭제해 주세요.');
    expect(within(dialog).getByRole('button', { name: '삭제' })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.remove).toHaveBeenCalledTimes(2);
  });
});

describe('UtteranceAnalysisListPage — 폴링(§2.3)', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('진행 행이 있으면 5초마다 목록을 다시 읽고, 완료되면 행이 완료로 바뀐다', async () => {
    const running = makeListItem({ status: 'RUNNING', stage: 'CLUSTERING', progress: 40, clusterCount: null, candidateCount: null });
    api.list.mockResolvedValue(page([running]));
    setup();
    expect(await screen.findByText('처리 중 · 묶는 중 40%')).toBeInTheDocument();
    const callsBefore = api.list.mock.calls.length;

    api.list.mockResolvedValue(page([makeListItem()]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });

    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(callsBefore));
    expect(await screen.findByText('완료')).toBeInTheDocument();
    // 진행 행이 없어지면 폴링이 멈춘다.
    const callsAfter = api.list.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(api.list.mock.calls.length).toBe(callsAfter);
  });

  it('진행 행이 없으면 폴링하지 않는다', async () => {
    setup();
    await screen.findByRole('table', { name: '발화 묶음 분석 목록' });
    const calls = api.list.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(api.list.mock.calls.length).toBe(calls);
  });
});
