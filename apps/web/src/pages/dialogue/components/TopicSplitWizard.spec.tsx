import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { TopicSplitPreview, TopicSplitResult } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeChatbot, makeTopic } from '../../../test/fixtures';
import { TopicSplitWizard } from './TopicSplitWizard';

const mockSplitPreview = vi.fn();
const mockSplit = vi.fn();
vi.mock('../../../api/topics', () => ({
  topicsApi: {
    splitPreview: (...args: unknown[]) => mockSplitPreview(...args),
    split: (...args: unknown[]) => mockSplit(...args),
  },
}));
vi.mock('../../../api/groups', () => ({
  groupsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }) },
}));

function basePreview(overrides: Partial<TopicSplitPreview> = {}): TopicSplitPreview {
  const counts = { intents: 8, keywords: 4, homonyms: 1, contexts: 0, dialogNodes: 10, faqs: 30, surveys: 0, intentExamples: 40, nodeIntentLinks: 0, nodeKeywordLinks: 0 };
  return {
    selected: counts,
    closureAdded: { ...counts, intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0, surveys: 0, intentExamples: 0, nodeIntentLinks: 0, nodeKeywordLinks: 0 },
    closureItems: { total: 0, items: [] },
    systemNodes: { start: true, fallback: true },
    trimmedLinks: { total: 0, items: [] },
    followedSystemLinks: { total: 0, items: [] },
    totals: counts,
    limits: { intents: 1000, keywords: 2000, homonyms: 1000, contexts: 200, dialogNodes: 500, faqs: 2000, surveys: 50, intentExamples: 20000, nodeIntentLinks: 0, nodeKeywordLinks: 0 },
    exceeded: [],
    closureDominates: false,
    apiConnectionsKept: 0,
    notCopied: ['CHANNELS'],
    ...overrides,
  };
}

function baseResult(): TopicSplitResult {
  return {
    chatbot: makeChatbot({ id: 'new-bot', name: '쇼핑몰 도우미 (분리)' }),
    totals: basePreview().totals,
    closureAdded: basePreview().closureAdded,
    trimmedLinks: 0,
    surveysCopied: 0,
    capturedAt: new Date('2026-09-25T10:12:00.000Z'),
    designCheck: { error: 0, warning: 1, info: 0 },
    reindexScheduled: true,
    notCopied: ['CHANNELS'],
  };
}

function renderWizard(onClose = vi.fn()) {
  const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true })];
  return render(
    <ToastProvider>
      <MemoryRouter>
        <TopicSplitWizard isOpen chatbotId="bot-1" topics={topics} onClose={onClose} />
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('TopicSplitWizard', () => {
  beforeEach(() => {
    mockSplitPreview.mockReset();
    mockSplit.mockReset();
  });

  it('토픽 미선택 + 공통 미포함이면 1단계 다음 버튼이 비활성이다', () => {
    renderWizard();
    expect(screen.getByText('1/4단계')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled();
  });

  it('토픽을 선택하면 다음 버튼이 활성화되고, 클릭 시 미리보기를 요청하며 2단계로 이동한다', async () => {
    const user = userEvent.setup();
    mockSplitPreview.mockResolvedValue(basePreview());
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    const nextButton = screen.getByRole('button', { name: '확인' });
    expect(nextButton).not.toBeDisabled();
    await user.click(nextButton);

    await waitFor(() => expect(mockSplitPreview).toHaveBeenCalledWith('bot-1', { topicIds: ['topic-1'], includeCommon: false, systemNodeLinks: 'TRIM' }));
    expect(await screen.findByText('2/4단계')).toBeInTheDocument();
  });

  it('①→②→①로 되돌아간 뒤 다시 다음을 누르면 미리보기를 재요청한다(캐시하지 않음)', async () => {
    const user = userEvent.setup();
    mockSplitPreview.mockResolvedValue(basePreview());
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('2/4단계');
    expect(mockSplitPreview).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '취소' })); // 2단계의 "이전"은 label이 취소
    await screen.findByText('1/4단계');
    await user.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(mockSplitPreview).toHaveBeenCalledTimes(2));
  });

  it('exceeded 종류가 있으면 2단계 다음 버튼이 비활성이고 상한 초과 배너가 보인다', async () => {
    const user = userEvent.setup();
    mockSplitPreview.mockResolvedValue(basePreview({ exceeded: ['keywords'] }));
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('2/4단계');

    expect(screen.getByText('선택 범위가 너무 큽니다. 토픽을 나누어 다시 시도해 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인' })).toBeDisabled();
  });

  it('3단계에서 분리 실행 시 split API를 호출하고 성공하면 4단계 결과 화면을 보여준다', async () => {
    const user = userEvent.setup();
    mockSplitPreview.mockResolvedValue(basePreview());
    mockSplit.mockResolvedValue(baseResult());
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('2/4단계');
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('3/4단계');

    await user.click(screen.getByRole('button', { name: '새 챗봇으로 분리' }));

    await waitFor(() => expect(mockSplit).toHaveBeenCalled());
    expect(await screen.findByText(/'쇼핑몰 도우미 \(분리\)'가 생성되었습니다\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '새 챗봇으로 이동 →' })).toBeInTheDocument();
  });

  it('409 TOPIC_SPLIT_BUSY면 3단계에 머물며 배너를 보여준다', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../../../api/client');
    mockSplitPreview.mockResolvedValue(basePreview());
    mockSplit.mockRejectedValue(new ApiError(409, '처리 중', 'TOPIC_SPLIT_BUSY'));
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('2/4단계');
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('3/4단계');
    await user.click(screen.getByRole('button', { name: '새 챗봇으로 분리' }));

    expect(await screen.findByText('지금 다른 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요.')).toBeInTheDocument();
    expect(screen.getByText('3/4단계')).toBeInTheDocument();
  });
});

/** [후속 — 백엔드 TopicSplitTrimmedLinkSchema 확장] 간선 라벨(NODE_MOVE/NODE_BUTTON) + `reason` 표시. */
describe('TopicSplitWizard — 잘라낸/따라간 연결의 간선 라벨·사유', () => {
  beforeEach(() => {
    mockSplitPreview.mockReset();
    mockSplit.mockReset();
  });

  it('잘라낸 연결에 간선 라벨(이동/버튼)이 붙는다', async () => {
    const user = userEvent.setup();
    mockSplitPreview.mockResolvedValue(
      basePreview({
        trimmedLinks: {
          total: 2,
          items: [
            { nodeId: 'start-1', nodeName: '시작', edge: 'NODE_MOVE', targetName: '보험접수_안내', targetTopicName: '보험청구' },
            { nodeId: 'start-1', nodeName: '시작', edge: 'NODE_BUTTON', targetName: '메뉴_보험', targetTopicName: '보험청구' },
          ],
        },
      }),
    );
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('2/4단계');

    expect(screen.getByText((_, el) => el?.tagName === 'LI' && el.textContent === '[이동] 시작 → 보험접수_안내(보험청구)')).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === 'LI' && el.textContent === '[버튼] 시작 → 메뉴_보험(보험청구)')).toBeInTheDocument();
  });

  it("followedSystemLinks에 reason:'TRIM_WOULD_EMPTY' 항목이 있으면 사유 문구가 함께 렌더된다", async () => {
    const user = userEvent.setup();
    mockSplitPreview.mockResolvedValue(
      basePreview({
        followedSystemLinks: {
          total: 1,
          items: [
            {
              nodeId: 'start-1',
              nodeName: '시작',
              edge: 'NODE_API_BRANCH',
              targetName: '외부연동_노드',
              targetTopicName: '보험청구',
              reason: 'TRIM_WOULD_EMPTY',
            },
          ],
        },
      }),
    );
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('2/4단계');

    const item = screen.getByText((_, el) => el?.tagName === 'LI' && Boolean(el.textContent?.startsWith('[API 분기] 시작 → 외부연동_노드(보험청구)')));
    expect(item).toHaveTextContent('잘라내면 출력이 없어져 대신 따라갔습니다.');
  });

  it('reason이 없는 따라간 연결 항목에는 사유 문구가 붙지 않는다', async () => {
    const user = userEvent.setup();
    mockSplitPreview.mockResolvedValue(
      basePreview({
        followedSystemLinks: {
          total: 1,
          items: [{ nodeId: 'start-1', nodeName: '시작', edge: 'NODE_MOVE', targetName: '메뉴_보험', targetTopicName: '보험청구' }],
        },
      }),
    );
    renderWizard();

    await user.click(screen.getByRole('checkbox', { name: /배송/ }));
    await user.click(screen.getByRole('button', { name: '확인' }));
    await screen.findByText('2/4단계');

    const item = screen.getByText((_, el) => el?.tagName === 'LI' && el.textContent === '[이동] 시작 → 메뉴_보험(보험청구)');
    expect(item).not.toHaveTextContent('잘라내면 출력이 없어져 대신 따라갔습니다.');
  });
});
