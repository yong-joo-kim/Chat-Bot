import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SurveyDetail } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { SurveyFormPage } from './SurveyFormPage';

const mockContext: ChatbotDetailContext = {
  chatbot: makeChatbot({ id: 'bot-1', status: 'ACTIVE' }),
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };
vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

const QUESTION_KEY = '33333333-3333-4333-8333-333333333333';
const CHOICE_KEY_1 = '44444444-4444-4444-8444-444444444444';
const CHOICE_KEY_2 = '55555555-5555-4555-8555-555555555555';

function makeSurveyDetail(overrides: Partial<SurveyDetail> = {}): SurveyDetail {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    chatbotId: 'bot-1',
    name: '배송 만족도',
    description: undefined,
    status: 'DRAFT',
    activeFrom: undefined,
    activeTo: undefined,
    introMessage: undefined,
    completionMessage: '설문에 참여해 주셔서 감사합니다.',
    cancelKeywords: ['그만', '취소', '설문 종료'],
    sessionTimeoutMinutes: 30,
    questions: [
      {
        key: QUESTION_KEY,
        type: 'SINGLE_CHOICE',
        prompt: '배송은 만족스러우셨나요?',
        required: true,
        choices: [
          { key: CHOICE_KEY_1, label: '매우 만족' },
          { key: CHOICE_KEY_2, label: '불만족' },
        ],
      },
    ],
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

const mockFindOne = vi.fn();
const mockUpdate = vi.fn();
vi.mock('../../api/surveys', () => ({
  surveysApi: {
    findOne: (...args: unknown[]) => mockFindOne(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    create: vi.fn(),
    copy: vi.fn(),
    remove: vi.fn(),
  },
}));

function renderPage(surveyId = '66666666-6666-4666-8666-666666666666'): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[`/chatbots/bot-1/dialogue/surveys/${surveyId}`]}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/surveys/:surveyId" element={<SurveyFormPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

/**
 * PATCH 시 기존 문항·선택지 key 보존(survey-management-ui-spec.md §3.2, 설계서 §13.1 "구조 판정").
 * 문구만 수정했을 때 요청 body의 questions[].key/choices[].key가 서버에서 불러온 값 그대로 유지되어야
 * "구조 변경"으로 오판되지 않는다(AC-SV4-2).
 */
describe('SurveyFormPage — PATCH key 보존', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockUpdate.mockReset();
  });

  it('문항 문구만 수정해 저장하면 요청 body에 기존 문항·선택지 key가 그대로 담긴다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockUpdate.mockResolvedValue(makeSurveyDetail());
    const user = userEvent.setup();
    renderPage();

    const promptField = await screen.findByLabelText(/^문구/);
    await user.clear(promptField);
    await user.type(promptField, '배송 속도는 어떠셨나요?');

    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, , dto] = mockUpdate.mock.calls[0] as [string, string, { questions: Array<{ key?: string; choices: Array<{ key?: string }> }> }];
    expect(dto.questions).toHaveLength(1);
    expect(dto.questions[0].key).toBe(QUESTION_KEY);
    expect(dto.questions[0].choices[0].key).toBe(CHOICE_KEY_1);
    expect(dto.questions[0].choices[1].key).toBe(CHOICE_KEY_2);
  });

  it('신규 문항을 추가해 저장하면 새 문항은 key 없이 전송된다(서버가 발급)', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockUpdate.mockResolvedValue(makeSurveyDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText(/^문구/);
    await user.click(screen.getByRole('button', { name: '+ 문항 추가' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, , dto] = mockUpdate.mock.calls[0] as [string, string, { questions: Array<{ key?: string }> }];
    expect(dto.questions).toHaveLength(2);
    expect(dto.questions[0].key).toBe(QUESTION_KEY);
    expect(dto.questions[1].key).toBeUndefined();
  });

  // [No.27 코드 리뷰 1회차 L2] 순서만 바꿔도 key는 유지되며 배열 순서만 바뀐다(ui-spec §3.2 4항).
  it('문항 순서를 바꿔 저장해도 각 문항의 key는 그대로 유지된 채 순서만 바뀐다', async () => {
    const SECOND_QUESTION_KEY = '77777777-7777-4777-8777-777777777777';
    mockFindOne.mockResolvedValue(
      makeSurveyDetail({
        questions: [
          {
            key: QUESTION_KEY,
            type: 'SINGLE_CHOICE',
            prompt: '배송은 만족스러우셨나요?',
            required: true,
            choices: [
              { key: CHOICE_KEY_1, label: '매우 만족' },
              { key: CHOICE_KEY_2, label: '불만족' },
            ],
          },
          { key: SECOND_QUESTION_KEY, type: 'TEXT', prompt: '더 하고 싶은 말씀', required: false, maxLength: 300 },
        ],
      }),
    );
    mockUpdate.mockResolvedValue(makeSurveyDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByDisplayValue('배송은 만족스러우셨나요?');
    await user.click(screen.getByRole('button', { name: '1번째 문항(배송은 만족스러우셨나요?) 아래로' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, , dto] = mockUpdate.mock.calls[0] as [string, string, { questions: Array<{ key?: string }> }];
    expect(dto.questions).toHaveLength(2);
    // 순서가 바뀌어 2번째 문항이 먼저 온다 — 그러나 key는 각 문항 원래 값 그대로다.
    expect(dto.questions[0].key).toBe(SECOND_QUESTION_KEY);
    expect(dto.questions[1].key).toBe(QUESTION_KEY);
  });

  // [No.27 코드 리뷰 1회차 L2] 유형 전환(선택 기반 → 다른 유형)은 구조 변경이라 선택지가 새로
  // 초기화되며, 기존 선택지 key는 새 유형의 선택지에 넘어가지 않는다(문항 자체의 key는 유지).
  it('문항 유형을 전환하면 기존 선택지 key는 사라지고 문항 자체의 key만 유지된다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockUpdate.mockResolvedValue(makeSurveyDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText(/^문구/);
    await user.selectOptions(screen.getByLabelText('유형'), '다중 선택');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, , dto] = mockUpdate.mock.calls[0] as [string, string, { questions: Array<{ key?: string; type: string; choices: Array<{ key?: string }> }> }];
    expect(dto.questions[0].key).toBe(QUESTION_KEY);
    expect(dto.questions[0].type).toBe('MULTI_CHOICE');
    expect(dto.questions[0].choices.every((c) => c.key === undefined)).toBe(true);
  });
});

/** [No.27 코드 리뷰 1회차 L1] 구조 잠금(응답 있음) 시 삭제 버튼은 숨기지 않고 비활성으로 보여 준다. */
describe('SurveyFormPage — 구조 잠금(응답 있음)', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockUpdate.mockReset();
  });

  it('응답이 있으면 문항·선택지 삭제 버튼이 숨겨지지 않고 비활성 상태로 표시된다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail({ locked: true, responseCount: 43 }));
    renderPage();

    const deleteQuestionButton = await screen.findByRole('button', { name: '1번째 문항(배송은 만족스러우셨나요?) 삭제' });
    expect(deleteQuestionButton).toBeInTheDocument();
    expect(deleteQuestionButton).toBeDisabled();

    const deleteChoiceButton = screen.getByRole('button', { name: '1번째 선택지(매우 만족) 삭제' });
    expect(deleteChoiceButton).toBeInTheDocument();
    expect(deleteChoiceButton).toBeDisabled();

    // [리뷰 2회차] 추가 버튼도 숨기지 않고 비활성으로 보여 준다(ui-spec §2.2).
    expect(screen.getByRole('button', { name: '+ 문항 추가' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+ 선택지' })).toBeDisabled();
  });
});

/** [No.27 코드 리뷰 1회차 H1] activeTo 배타적 경계 — 화면 표시/저장 왕복 변환. */
describe('SurveyFormPage — 종료일(activeTo) 경계 변환', () => {
  beforeEach(() => {
    mockFindOne.mockReset();
    mockUpdate.mockReset();
  });

  it('서버의 activeTo(다음날 00:00+09:00)를 불러오면 화면에는 사용자가 고른 종료일 당일이 표시된다', async () => {
    mockFindOne.mockResolvedValue(
      makeSurveyDetail({ activeFrom: new Date('2026-09-25T00:00:00+09:00'), activeTo: new Date('2026-11-01T00:00:00+09:00') }),
    );
    renderPage();

    await screen.findByLabelText(/^문구/);
    expect((document.getElementById('survey-active-from') as HTMLInputElement).value).toBe('2026-09-25');
    expect((document.getElementById('survey-active-to') as HTMLInputElement).value).toBe('2026-10-31');
  });

  it('종료일을 10/31로 입력해 저장하면 요청에는 11/01 00:00+09:00으로 전송된다', async () => {
    mockFindOne.mockResolvedValue(makeSurveyDetail());
    mockUpdate.mockResolvedValue(makeSurveyDetail());
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText(/^문구/);
    fireEvent.change(document.getElementById('survey-active-to') as HTMLInputElement, { target: { value: '2026-10-31' } });
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const [, , dto] = mockUpdate.mock.calls[0] as [string, string, { activeTo?: string }];
    expect(dto.activeTo).toBe('2026-11-01T00:00:00+09:00');
  });
});
