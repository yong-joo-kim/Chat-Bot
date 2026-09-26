import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SurveyDetail, SurveyQuestionStats, SurveyResponseListItem, SurveyStatsSummary } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { SurveyResultsPage } from './SurveyResultsPage';

const mockFindOne = vi.fn();
const mockSummary = vi.fn();
const mockQuestions = vi.fn();
const mockResponses = vi.fn();
vi.mock('../../api/surveys', () => ({
  surveysApi: { findOne: (...args: unknown[]) => mockFindOne(...args) },
  surveyResultsApi: {
    summary: (...args: unknown[]) => mockSummary(...args),
    questions: (...args: unknown[]) => mockQuestions(...args),
    responses: (...args: unknown[]) => mockResponses(...args),
    textAnswers: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
    exportCsv: vi.fn(),
  },
}));

const mockContext: ChatbotDetailContext = {
  chatbot: makeChatbot({ id: 'bot-1', status: 'ACTIVE' }),
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));
// [신규 No.45] G7 배너가 `useAuth().user.governanceModeOn`을 읽는다(data-governance-ui-spec.md §3.10).
let mockGovernanceModeOn = false;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: '박편집', role: 'EDITOR', governanceModeOn: mockGovernanceModeOn }, can: () => true }),
}));

function makeSurveyDetail(overrides: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: 'survey-1',
    chatbotId: 'bot-1',
    name: '배송 만족도',
    description: undefined,
    status: 'OPEN',
    activeFrom: undefined,
    activeTo: undefined,
    introMessage: undefined,
    completionMessage: '감사합니다.',
    cancelKeywords: [],
    sessionTimeoutMinutes: 30,
    questions: [],
    structureVersion: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    locked: false,
    responseCount: 0,
    referencingNodeCount: 0,
    referencingNodes: [],
    ...overrides,
  };
}

function makeSummary(): SurveyStatsSummary {
  return {
    surveyId: 'survey-1',
    period: { from: '2026-08-26', to: '2026-09-24', granularity: 'day' },
    generatedAt: new Date('2026-09-24T00:00:00.000Z'),
    timezone: 'Asia/Seoul',
    filters: {},
    totals: {
      exposed: 1240,
      started: 610,
      completed: 512,
      inProgress: 10,
      inProgressStarted: 6,
      droppedAfterStart: 88,
      droppedBeforeStart: 3,
      duplicates: 7,
      participationRate: 0.492,
      completionRate: 0.414,
      dropoutRate: 0.148,
    },
    buckets: [],
    lowSample: false,
  };
}

function makeQuestionStats(): SurveyQuestionStats {
  return {
    surveyId: 'survey-1',
    period: { from: '2026-08-26', to: '2026-09-24' },
    generatedAt: new Date('2026-09-24T00:00:00.000Z'),
    questions: [],
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/surveys/survey-1/results']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/surveys/:surveyId/results" element={<SurveyResultsPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('SurveyResultsPage', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockSummary.mockReset();
    mockQuestions.mockReset();
    mockResponses.mockReset();
    mockGovernanceModeOn = false;
  });

  it('요약 카드에 노출/시작/완료 수와 분자/분모 캡션을 표시한다(NFR-SVA3)', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockSummary.mockResolvedValue(makeSummary());
    mockQuestions.mockResolvedValue(makeQuestionStats());
    mockResponses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('1240')).toBeInTheDocument();
    expect(screen.getByText(/49\.2% \(610\/1240\)/)).toBeInTheDocument();
  });

  it('요약 조회가 실패하면 오류 상태와 다시 시도 버튼을 보여준다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockSummary.mockRejectedValue(new Error('network'));
    mockQuestions.mockResolvedValue(makeQuestionStats());
    mockResponses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('결과를 불러오지 못했습니다.')).toBeInTheDocument();
  });

  // [No.27 코드 리뷰 1회차 H2] 요약 조회가 실패해도 직전에 성공한 카드 값은 화면에 남아 있어야 한다.
  it('요약 재조회가 실패해도 직전 카드 값은 유지된 채 오류 배너만 함께 뜬다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockQuestions.mockResolvedValue(makeQuestionStats());
    mockResponses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    mockSummary.mockResolvedValueOnce(makeSummary());
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('1240')).toBeInTheDocument();

    mockSummary.mockRejectedValueOnce(new Error('network'));
    await user.click(screen.getByLabelText('주'));

    expect(await screen.findByText('결과를 불러오지 못했습니다.')).toBeInTheDocument();
    // 직전 성공값(노출 1240)은 그대로 남아 있어야 한다.
    expect(screen.getByText('1240')).toBeInTheDocument();
  });

  // [No.27 코드 리뷰 1회차 H2] 일/주/월 선택 UI가 있고, 바꾸면 그 값으로 재요청한다.
  it('일/주/월 단위를 바꾸면 그 granularity로 요약·문항별을 재조회한다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockSummary.mockResolvedValue(makeSummary());
    mockQuestions.mockResolvedValue(makeQuestionStats());
    mockResponses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('1240');
    mockSummary.mockClear();
    await user.click(screen.getByLabelText('월'));

    await waitFor(() => expect(mockSummary).toHaveBeenCalled());
    expect(mockSummary.mock.calls[0][2]).toMatchObject({ granularity: 'month' });
  });

  // [No.27 코드 리뷰 1회차 H2] 기간이 366일을 넘으면(서버 `assertSurveyPeriod` 상한) 요청 전에 인라인
  // 오류를 보여주고 API를 호출하지 않는다.
  it('조회 기간이 366일을 넘으면 인라인 오류를 보여주고 요약을 요청하지 않는다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockSummary.mockResolvedValue(makeSummary());
    mockQuestions.mockResolvedValue(makeQuestionStats());
    mockResponses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderPage();

    await screen.findByText('1240');
    mockSummary.mockClear();

    const fromInput = screen.getByLabelText('조회 시작일') as HTMLInputElement;
    fireEvent.change(fromInput, { target: { value: '2025-01-01' } });

    expect(await screen.findByText('조회 기간은 최대 366일까지 가능합니다.')).toBeInTheDocument();
    expect(mockSummary).not.toHaveBeenCalled();
  });

  // [No.27 코드 리뷰 1회차 H3] 응답 목록에 문항별 답(라벨·점수·마스킹 텍스트·건너뜀)을 표시한다.
  it('응답 목록에 문항별 답 컬럼이 표시된다', async () => {
    mockFindOne.mockResolvedValue(
      makeSurveyDetail({
        questions: [
          { key: 'q1', type: 'SCALE', prompt: '배송 속도는 어떠셨나요?', required: true, scale: 'STAR_5' },
          { key: 'q2', type: 'TEXT', prompt: '더 하고 싶은 말씀', required: false, maxLength: 300 },
        ],
      }),
    );
    mockSummary.mockResolvedValue(makeSummary());
    mockQuestions.mockResolvedValue(makeQuestionStats());
    const responseItem: SurveyResponseListItem = {
      responseNo: 'A1B2C3D4',
      exposedAt: new Date('2026-09-24T01:02:13.000Z'),
      displayStatus: 'COMPLETED',
      started: true,
      duplicate: false,
      channelType: 'WEB',
      completedAt: new Date('2026-09-24T01:03:40.000Z'),
      missingRequiredCount: 0,
      answers: [
        { questionKey: 'q1', kind: 'ANSWERED', display: '4점' },
        { questionKey: 'q2', kind: 'SKIPPED', display: '' },
      ],
    };
    mockResponses.mockResolvedValue({ items: [responseItem], total: 1, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('A1B2C3D4')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '배송 속도는 어떠셨나요?' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '더 하고 싶은 말씀' })).toBeInTheDocument();
    expect(screen.getByText('4점')).toBeInTheDocument();
    expect(screen.getByText('건너뜀')).toBeInTheDocument();
  });

  /** [신규 No.45] G5 — purged:true인 답은 "보존기간 경과로 파기됨"으로 표시된다(data-governance-ui-spec.md §3.7). */
  it('응답 목록의 답이 purged:true면 "보존기간 경과로 파기됨"으로 표시된다', async () => {
    mockFindOne.mockResolvedValue(
      makeSurveyDetail({ questions: [{ key: 'q1', type: 'TEXT', prompt: '더 하고 싶은 말씀', required: false, maxLength: 300 }] }),
    );
    mockSummary.mockResolvedValue(makeSummary());
    mockQuestions.mockResolvedValue(makeQuestionStats());
    const responseItem: SurveyResponseListItem = {
      responseNo: 'A1B2C3D4',
      exposedAt: new Date('2026-09-24T01:02:13.000Z'),
      displayStatus: 'COMPLETED',
      started: true,
      duplicate: false,
      channelType: 'WEB',
      completedAt: new Date('2026-09-24T01:03:40.000Z'),
      missingRequiredCount: 0,
      answers: [{ questionKey: 'q1', kind: 'ANSWERED', display: '', purged: true }],
    };
    mockResponses.mockResolvedValue({ items: [responseItem], total: 1, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('보존기간 경과로 파기됨')).toBeInTheDocument();
  });

  /** [신규 No.45] G7 — 설문 응답 목록(V-4)·자유 텍스트 목록(V-5) 공용 배너. */
  it('governanceModeOn=true면 상단에 G7 배너를 보여준다', async () => {
    mockGovernanceModeOn = true;
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockSummary.mockResolvedValue(makeSummary());
    mockQuestions.mockResolvedValue(makeQuestionStats());
    mockResponses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderPage();

    expect(await screen.findByText('이 화면 열람은 감사로그에 기록됩니다.')).toBeInTheDocument();
  });

  // [No.27 코드 리뷰 1회차 M2] 문항별 로더에도 요청 순번 가드가 적용되어야 한다.
  it('문항별 조회 — 빠르게 필터를 바꿔도 늦게 도착한 이전 응답이 최신 결과를 덮어쓰지 않는다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockSummary.mockResolvedValue(makeSummary());
    mockResponses.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    let resolveStale: (value: SurveyQuestionStats) => void = () => undefined;
    const stalePromise = new Promise<SurveyQuestionStats>((resolve) => {
      resolveStale = resolve;
    });
    mockQuestions
      .mockImplementationOnce(() => stalePromise)
      .mockImplementationOnce(() => Promise.resolve({ ...makeQuestionStats(), questions: [] }));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('1240');

    await user.click(screen.getByLabelText('중복 포함'));
    await waitFor(() => expect(mockQuestions).toHaveBeenCalledTimes(2));

    resolveStale({
      ...makeQuestionStats(),
      questions: [
        {
          questionKey: 'stale',
          prompt: '오래된 문항',
          type: 'TEXT',
          kind: 'TEXT',
          reached: 1,
          answered: 1,
          skipped: 0,
          lowSample: false,
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText('오래된 문항')).not.toBeInTheDocument();
  });
});
