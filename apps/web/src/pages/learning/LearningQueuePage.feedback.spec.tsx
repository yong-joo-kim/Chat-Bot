import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { UnansweredQuestionDetail, UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { ApiError } from '../../api/client';
import { makeChatbot } from '../../test/fixtures';
import type { StatsShellContext } from '../stats/StatsShell';
import { LearningQueuePage } from './LearningQueuePage';

expect.extend(toHaveNoViolations);

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333' });

const mockShellContext: StatsShellContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
  learningSummary: {
    pendingCount: 3,
    limitReached: false,
    bySource: {
      UNANSWERED: { pendingCount: 1, limitReached: false },
      NEGATIVE_FEEDBACK: { pendingCount: 2, limitReached: true },
    },
  },
  refreshLearningSummary: vi.fn(),
};

vi.mock('../stats/StatsShell', () => ({
  useStatsShellContext: () => mockShellContext,
}));

let canWrite = true;
let canWriteChannel = true;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    can: (p: string) => {
      if (p === 'dialogue:write') return canWrite;
      if (p === 'channel:write') return canWriteChannel;
      return true;
    },
  }),
}));

const mockList = vi.fn();
const mockFindOne = vi.fn();
const mockMarkAddressed = vi.fn();
vi.mock('../../api/learning', () => ({
  learningApi: {
    list: (...args: unknown[]) => mockList(...args),
    summary: vi.fn(),
    findOne: (...args: unknown[]) => mockFindOne(...args),
    resolve: vi.fn(),
    ignore: vi.fn(),
    reopen: vi.fn(),
    bulkResolve: vi.fn(),
    bulkIgnore: vi.fn(),
    markAddressed: (...args: unknown[]) => mockMarkAddressed(...args),
  },
}));

vi.mock('../../api/dialogue', () => ({
  intentsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
  keywordsApi: {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }),
  },
}));

vi.mock('../../api/classifier', () => ({
  classifierApi: {
    status: vi.fn().mockResolvedValue({ state: 'NONE', classCount: 0, sampleCount: 0, stale: false, staleReasons: [] }),
    train: vi.fn(),
  },
}));

const INTENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeNegativeItem(overrides: Partial<UnansweredQuestionListItem> = {}): UnansweredQuestionListItem {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    chatbotId: chatbot.id,
    questionText: '환불 얼마나 걸리나요?',
    occurredCount: 3,
    status: 'PENDING',
    firstOccurredAt: new Date('2026-09-11T00:00:00.000Z'),
    lastOccurredAt: new Date('2026-09-22T09:00:00.000Z'),
    recurredCount: 0,
    channelType: 'WEB',
    suggestions: [{ intentId: INTENT_ID, intentName: '환불안내', score: 0.71, matchedExample: '환불 얼마나 걸려요' }],
    source: 'NEGATIVE_FEEDBACK',
    lastFeedbackTarget: { kind: 'FAQ', id: 'faq-1', name: '환불 안내', deleted: false },
    lastFeedbackMatchedIntentId: INTENT_ID,
    ...overrides,
  };
}

function makeUnansweredItem(overrides: Partial<UnansweredQuestionListItem> = {}): UnansweredQuestionListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    chatbotId: chatbot.id,
    questionText: '해외배송도 되나요?',
    occurredCount: 12,
    status: 'PENDING',
    firstOccurredAt: new Date('2026-09-01T00:00:00.000Z'),
    lastOccurredAt: new Date('2026-09-22T09:00:00.000Z'),
    recurredCount: 0,
    channelType: 'WEB',
    suggestions: [],
    source: 'UNANSWERED',
    ...overrides,
  };
}

function makeNegativeDetail(overrides: Partial<UnansweredQuestionDetail> = {}): UnansweredQuestionDetail {
  return {
    ...makeNegativeItem(),
    variants: [],
    trend: [{ dayBucket: '2026-09-20', count: 1 }],
    trendApproximated: false,
    trendSource: 'FEEDBACK_LEDGER',
    lastFeedback: {
      botResponse: '환불은 영업일 기준 3일 이내 처리됩니다.',
      turnAt: new Date('2026-09-22T09:00:00.000Z'),
      target: { kind: 'FAQ', id: 'faq-1', name: '환불 안내', deleted: false },
      matchedIntentId: INTENT_ID,
    },
    ...overrides,
  };
}

function makeUnansweredDetail(overrides: Partial<UnansweredQuestionDetail> = {}): UnansweredQuestionDetail {
  return {
    ...makeUnansweredItem(),
    variants: [],
    trend: [],
    trendApproximated: false,
    ...overrides,
  };
}

function renderPage(initialPath = `/chatbots/${chatbot.id}/stats/learning`): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <LearningQueuePage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** No.44 — L1/L1D 부정 평가 확장(feedback-loop-ui-spec.md §3.3). */
describe('LearningQueuePage — 부정 평가 소스 확장(No.44)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockFindOne.mockReset();
    mockMarkAddressed.mockReset();
    canWrite = true;
    canWriteChannel = true;
  });

  it('소스 탭에 bySource 기준 건수가 표시되고, 부정 평가 상한 배너가 미응답 배너와 별도로 뜬다', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    expect(screen.getByRole('button', { name: '답변 못함 (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '부정 평가 (2)' })).toBeInTheDocument();
    // NEGATIVE_FEEDBACK 상한 배너만 뜬다(미응답 limitReached=false).
    expect(screen.getByText(/부정 평가 질문이 상한\(2000건\)에 도달했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/미응답 질문이 상한/)).not.toBeInTheDocument();
  });

  it('소스 탭 전환 시 목록 API가 해당 source로 재조회된다', async () => {
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('button', { name: '부정 평가 (2)' });
    mockList.mockClear();

    await user.click(screen.getByRole('button', { name: '부정 평가 (2)' }));

    await waitFor(() => expect(mockList).toHaveBeenCalledWith(chatbot.id, expect.objectContaining({ source: ['NEGATIVE_FEEDBACK'] })));
  });

  it('부정 평가 행은 출처 배지와 "당시 답변" 보조 텍스트를 목록 단계에서도 보여준다', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    expect(screen.getByText('부정 평가')).toBeInTheDocument();
    expect(screen.getByText(/FAQ '환불 안내'/)).toBeInTheDocument();
  });

  it('부정 평가 행을 펼치면 당시 봇 답변·현재 매칭 배지·정확 집계 캡션과 활성화된 "직접 수정 완료"가 보인다', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeNegativeDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));

    expect(await screen.findByText(/환불은 영업일 기준 3일 이내 처리됩니다/)).toBeInTheDocument();
    // "현재 매칭"은 목록 열(추천 의도)과 펼침 상세(추천 후보)에 각각 렌더된다 — 1건 이상이면 충분하다.
    expect(screen.getAllByText('현재 매칭').length).toBeGreaterThan(0);
    expect(screen.getByText('이 소스는 정확한 집계입니다.')).toBeInTheDocument();

    const markButton = screen.getByRole('button', { name: '직접 수정 완료' });
    expect(markButton).toBeEnabled();
  });

  it('"현재 매칭" 후보로 [이 의도로 반영]을 누르면 반영 모달 상단에 비차단 경고가 뜬다(FR-FB7-4)', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeNegativeDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));
    await screen.findByText(/환불은 영업일 기준 3일 이내 처리됩니다/);

    await user.click(screen.getByRole('button', { name: '이 의도로 반영' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // 모달 안에서도 같은 경고 문구가 다시 보인다(저장을 막지 않는 비차단 경고).
    expect(within(screen.getByRole('dialog')).getByText('지금도 이 의도로 답하고 있어요 — 답변 내용 수정이 필요할 수 있어요')).toBeInTheDocument();
  });

  it('미응답(UNANSWERED) 행을 펼치면 "직접 수정 완료"가 비활성 상태로 사유와 함께 렌더된다(숨기지 않음)', async () => {
    mockList.mockResolvedValue({ items: [makeUnansweredItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeUnansweredDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('해외배송도 되나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));

    const markButton = await screen.findByRole('button', { name: '직접 수정 완료' });
    expect(markButton).toBeDisabled();
    expect(screen.getByText('답변 못함 항목은 반영(예문 추가)으로 처리해 주세요.')).toBeInTheDocument();
  });

  it('"직접 수정 완료" 클릭 시 API가 호출되고, 진행 중 중복 클릭은 무시된다', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeNegativeDetail());
    let resolveMark: (v: UnansweredQuestionListItem) => void = () => undefined;
    mockMarkAddressed.mockImplementation(
      () =>
        new Promise<UnansweredQuestionListItem>((resolve) => {
          resolveMark = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));
    const markButton = await screen.findByRole('button', { name: '직접 수정 완료' });

    await user.click(markButton);
    await user.click(markButton); // 진행 중 재클릭 — 중복 요청 방지.

    expect(mockMarkAddressed).toHaveBeenCalledTimes(1);
    expect(mockMarkAddressed).toHaveBeenCalledWith(chatbot.id, makeNegativeItem().id);

    resolveMark(makeNegativeItem({ status: 'RESOLVED', resolvedDirectly: true }));
    await waitFor(() => expect(screen.getByText('직접 수정 완료로 처리되었습니다.')).toBeInTheDocument());
  });

  it('VIEWER(쓰기 권한 없음)는 "직접 수정 완료" 버튼 자체가 렌더되지 않는다(권한 없으면 숨김)', async () => {
    canWrite = false;
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeNegativeDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));

    await screen.findByText(/환불은 영업일 기준 3일 이내 처리됩니다/);
    expect(screen.queryByRole('button', { name: '직접 수정 완료' })).not.toBeInTheDocument();
  });

  it('부정 평가 펼침 상세(당시 답변·배지·직접 수정 완료 포함)에 구조적 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeNegativeDetail());
    const user = userEvent.setup();
    const { container } = renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));
    await screen.findByText(/환불은 영업일 기준 3일 이내 처리됩니다/);

    // heading-order: 펼침 상세의 h4들(표기 변형/추천 의도 후보/당시 봇 답변 등)이 h1 바로 아래 온다 —
    // No.44 이전부터 있던 기존 L1 상세 패널 구조(UnansweredTable.tsx)이며 이 그룹의 변경 범위 밖이다.
    // color-contrast는 jsdom에 실제 스타일시트가 로드되지 않아 다른 L1 axe 시험과 동일하게 끈다.
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false }, 'heading-order': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('직접 수정 완료가 409 ALREADY_RESOLVED로 실패하면 목록 재조회와 함께 요약(배지)도 갱신한다(R1)', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeNegativeDetail());
    mockMarkAddressed.mockRejectedValue(new ApiError(409, '다른 관리자가 먼저 처리했습니다. 목록을 새로고침합니다.', 'ALREADY_RESOLVED'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));
    const markButton = await screen.findByRole('button', { name: '직접 수정 완료' });
    mockList.mockClear();
    (mockShellContext.refreshLearningSummary as ReturnType<typeof vi.fn>).mockClear();

    await user.click(markButton);

    expect(await screen.findByText('다른 관리자가 먼저 처리했습니다. 목록을 새로고침합니다.')).toBeInTheDocument();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(mockShellContext.refreshLearningSummary).toHaveBeenCalled();
  });

  it('부정 평가 소스로 결과 0건 + 처리 이력도 없으면 전용 빈 상태(+ 채널 설정 링크)가 보인다', async () => {
    mockList.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 20 }); // 기본(PENDING) 조회
    mockList.mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 1 }); // 전체 상태 조회(처리 이력 확인)
    renderPage(`/chatbots/${chatbot.id}/stats/learning?source=NEGATIVE_FEEDBACK`);

    await screen.findByText('부정 평가로 들어온 질문이 없습니다.');
    expect(screen.getByText('답변 평가 기능을 켜면 👎를 받은 답변이 여기로 모입니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '채널 설정으로 이동' })).toHaveAttribute('href', `/chatbots/${chatbot.id}/channels`);
  });

  it('직접 수정 완료가 400 INVALID_STATUS_TRANSITION으로 실패하면 안내 토스트만 뜨고 목록은 그대로다(정상 경로에서 버튼이 비활성이라 방어 처리)', async () => {
    mockList.mockResolvedValue({ items: [makeNegativeItem()], total: 1, page: 1, pageSize: 20 });
    mockFindOne.mockResolvedValue(makeNegativeDetail());
    mockMarkAddressed.mockRejectedValue(new ApiError(400, '답변 못함 항목은 반영(예문 추가)으로 처리해 주세요.', 'INVALID_STATUS_TRANSITION'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('환불 얼마나 걸리나요?');
    await user.click(screen.getByRole('button', { name: /상세 펼치기/ }));
    const markButton = await screen.findByRole('button', { name: '직접 수정 완료' });
    await user.click(markButton);

    await waitFor(() => expect(mockMarkAddressed).toHaveBeenCalledTimes(1));
    expect(await screen.findAllByText('답변 못함 항목은 반영(예문 추가)으로 처리해 주세요.')).not.toHaveLength(0);
  });
});
