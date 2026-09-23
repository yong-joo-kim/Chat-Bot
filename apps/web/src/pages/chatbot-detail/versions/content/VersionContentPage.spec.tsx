import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Chatbot, ChatbotVersionDetail, VersionContentPage as VersionContentPageType } from '@chat-bot/shared-types';
import type { ChatbotDetailContext } from '../../../ChatbotDetailLayout';
import { VersionContentPage } from './VersionContentPage';

const chatbot: Chatbot = {
  id: 'bot-1',
  groupId: 'group-1',
  name: '주문 상담봇',
  avatarUrl: undefined,
  description: undefined,
  slug: 'order-bot',
  status: 'ACTIVE',
  skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  updatedAt: new Date('2026-09-18T00:00:00.000Z'),
};

const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};

vi.mock('../../../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const mockDetail = vi.fn();
const mockContent = vi.fn();

vi.mock('../../../../api/versions', () => ({
  versionsApi: {
    detail: (...args: unknown[]) => mockDetail(...args),
    content: (...args: unknown[]) => mockContent(...args),
  },
}));

function makeVersionDetail(overrides: Partial<ChatbotVersionDetail> = {}): ChatbotVersionDetail {
  return {
    id: 'ver-14',
    versionNo: 14,
    trigger: 'MANUAL',
    triggerLabel: '수동 저장',
    triggerContext: null,
    schemaVersion: 1,
    schemaSupported: true,
    contentHash: 'a'.repeat(64),
    counts: {
      intents: 1,
      intentExamples: 1,
      keywords: 0,
      homonyms: 0,
      contexts: 0,
      dialogNodes: 0,
      nodeIntentLinks: 0,
      nodeKeywordLinks: 0,
      faqs: 0,
      answerSetting: 0,
    },
    sizeBytes: 100,
    integrityWarningCount: 0,
    label: null,
    memo: null,
    pinned: false,
    restoredFromVersionNo: null,
    createdById: 'user-1',
    createdByEmail: 'editor@chat-bot.local',
    createdAt: new Date('2026-09-20T09:51:00.000Z'),
    updatedAt: new Date('2026-09-20T09:51:00.000Z'),
    integrityWarnings: [],
    payloadStatus: 'OK',
    ...overrides,
  };
}

function makeContentPage(overrides: Partial<VersionContentPageType> = {}): VersionContentPageType {
  return {
    kind: 'INTENT',
    schemaSupported: true,
    items: [],
    total: 0,
    page: 1,
    pageSize: 50,
    ...overrides,
  };
}

function renderPage(path = '/chatbots/bot-1/versions/ver-14/content'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chatbots/:chatbotId/versions/:versionId/content" element={<VersionContentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * L3 버전 내용 보기(읽기 전용, `version-history-ui-spec.md` §4.3, FR-H2-12). 이전에는 전용
 * 컴포넌트 시험이 없었다(2026-09-23 신규 — No.25 커버리지 공백 보강).
 */
describe('VersionContentPage', () => {
  beforeEach(() => {
    mockDetail.mockReset();
    mockContent.mockReset();
  });

  it('마운트 시 detail()로 버전 번호를 가져와 제목에 표시하고, 기본 종류(INTENT)로 content()를 호출한다', async () => {
    mockDetail.mockResolvedValue(makeVersionDetail({ versionNo: 14 }));
    mockContent.mockResolvedValue(makeContentPage({ kind: 'INTENT', items: [{ id: 'i-1', name: '환불규정문의', description: undefined, examples: ['환불 어떻게 하나요'] }], total: 1 }));

    renderPage();

    await screen.findByRole('heading', { name: 'v14 내용 보기' });
    await waitFor(() => expect(mockContent).toHaveBeenCalledWith('bot-1', 'ver-14', { kind: 'INTENT', q: undefined, page: 1, pageSize: 50 }));
    expect(await screen.findByText('환불규정문의')).toBeInTheDocument();
  });

  it('종류 탭을 클릭하면 해당 kind로 content()를 다시 호출하고 페이지가 초기화된다', async () => {
    mockDetail.mockResolvedValue(makeVersionDetail());
    mockContent.mockResolvedValue(makeContentPage({ kind: 'INTENT', items: [], total: 0 }));

    renderPage();
    await waitFor(() => expect(mockContent).toHaveBeenCalledWith('bot-1', 'ver-14', { kind: 'INTENT', q: undefined, page: 1, pageSize: 50 }));

    mockContent.mockResolvedValue(makeContentPage({ kind: 'FAQ', items: [{ question: 'Q1', answer: 'A1', altQuestions: [] }], total: 1 }));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'FAQ' }));

    await waitFor(() => expect(mockContent).toHaveBeenCalledWith('bot-1', 'ver-14', { kind: 'FAQ', q: undefined, page: 1, pageSize: 50 }));
    expect(await screen.findByText('Q1')).toBeInTheDocument();
  });

  it('항목이 0건이면 빈 상태 안내를 표시한다', async () => {
    mockDetail.mockResolvedValue(makeVersionDetail());
    mockContent.mockResolvedValue(makeContentPage({ kind: 'INTENT', items: [], total: 0 }));

    renderPage();

    expect(await screen.findByText('이 버전에는 의도이(가) 없습니다.')).toBeInTheDocument();
  });

  it('ANSWER_SETTING 종류에서 항목 0건이면 전용 안내("복원 시 기본값") 문구를 쓴다', async () => {
    mockDetail.mockResolvedValue(makeVersionDetail());
    mockContent.mockResolvedValue(makeContentPage({ kind: 'ANSWER_SETTING', items: [], total: 0 }));

    renderPage('/chatbots/bot-1/versions/ver-14/content?kind=ANSWER_SETTING');

    expect(await screen.findByText('이 버전에는 답변설정이 없습니다(복원 시 기본값이 됩니다).')).toBeInTheDocument();
  });

  it('schemaSupported:false면 원형 데이터 안내 배너를 표시한다(S-10)', async () => {
    mockDetail.mockResolvedValue(makeVersionDetail({ schemaVersion: 0, schemaSupported: false }));
    mockContent.mockResolvedValue(makeContentPage({ kind: 'INTENT', schemaSupported: false, items: [{ raw: true }], total: 1 }));

    renderPage();

    expect(await screen.findByText('이 버전은 원형 데이터로 표시됩니다(현재 형식으로 변환할 수 없음).')).toBeInTheDocument();
  });

  it('content() 조회가 실패하면 오류 상태와 재시도 버튼을 표시한다', async () => {
    mockDetail.mockResolvedValue(makeVersionDetail());
    mockContent.mockRejectedValueOnce(new Error('network down'));

    renderPage();

    const retryButton = await screen.findByRole('button', { name: /다시 시도|재시도/ });
    expect(retryButton).toBeInTheDocument();
  });

  it('검색어를 입력하면 q 파라미터와 함께 content()를 다시 호출한다', async () => {
    mockDetail.mockResolvedValue(makeVersionDetail());
    mockContent.mockResolvedValue(makeContentPage({ kind: 'INTENT', items: [], total: 0 }));

    renderPage();
    await waitFor(() => expect(mockContent).toHaveBeenCalledWith('bot-1', 'ver-14', { kind: 'INTENT', q: undefined, page: 1, pageSize: 50 }));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('검색'), '환불');

    await waitFor(() => expect(mockContent).toHaveBeenCalledWith('bot-1', 'ver-14', { kind: 'INTENT', q: '환불', page: 1, pageSize: 50 }));
  });
});
