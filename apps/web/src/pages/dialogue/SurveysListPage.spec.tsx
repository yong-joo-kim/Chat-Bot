import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SurveyListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../components/Toast';
import { ApiError } from '../../api/client';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { SurveysListPage } from './SurveysListPage';

const mockList = vi.fn();
const mockRemove = vi.fn();
const mockUpdate = vi.fn();
const mockCopy = vi.fn();
vi.mock('../../api/surveys', () => ({
  surveysApi: {
    list: (...args: unknown[]) => mockList(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    copy: (...args: unknown[]) => mockCopy(...args),
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

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

function makeSurvey(overrides: Partial<SurveyListItem> = {}): SurveyListItem {
  return {
    id: 'survey-1',
    name: '배송 만족도',
    status: 'OPEN',
    activeFrom: undefined,
    activeTo: undefined,
    questionCount: 3,
    structureVersion: 1,
    locked: true,
    referencingNodeCount: 2,
    last30d: { exposed: 1240, completed: 512 },
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/chatbots/bot-1/dialogue/surveys']}>
        <Routes>
          <Route path="/chatbots/:chatbotId/dialogue/surveys" element={<SurveysListPage />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
}

describe('SurveysListPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockRemove.mockReset();
    mockUpdate.mockReset();
    mockCopy.mockReset();
  });

  it('목록을 불러와 이름·상태·응답 잠금 배지·참조 노드 수를 표시한다', async () => {
    mockList.mockResolvedValue({ items: [makeSurvey()] });
    renderPage();

    expect(await screen.findByText('배송 만족도')).toBeInTheDocument();
    expect(screen.getByText('진행 중')).toBeInTheDocument();
    expect(screen.getByText('응답 잠금')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('설문이 0건이면 빈 상태와 "설문 추가" 안내를 보여준다', async () => {
    mockList.mockResolvedValue({ items: [] });
    renderPage();

    expect(await screen.findByText('등록된 설문이 없습니다.')).toBeInTheDocument();
  });

  it('삭제가 409 SURVEY_IN_USE로 거부되면 참조 노드 안내 배너가 표시된다', async () => {
    mockList.mockResolvedValue({ items: [makeSurvey({ locked: false })] });
    mockRemove.mockRejectedValue(
      new ApiError(409, '이 설문을 참조하는 대화 노드가 1건 있습니다.', 'SURVEY_IN_USE', [{ field: 'node-1', message: '배송완료_안내' }]),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('배송 만족도');
    await user.click(screen.getByRole('button', { name: '배송 만족도 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(await screen.findByText(/이 설문을 사용하는 노드가 1건 있습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '배송완료_안내' })).toBeInTheDocument();
  });

  it('삭제가 409 SURVEY_HAS_RESPONSES로 거부되면 마감하기 대안 버튼이 표시된다', async () => {
    mockList.mockResolvedValue({ items: [makeSurvey({ locked: true })] });
    mockRemove.mockRejectedValue(new ApiError(409, '응답이 있는 설문은 삭제할 수 없어요.', 'SURVEY_HAS_RESPONSES'));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('배송 만족도');
    await user.click(screen.getByRole('button', { name: '배송 만족도 관리' }));
    await user.click(screen.getByRole('menuitem', { name: '삭제' }));
    await user.click(screen.getByRole('button', { name: '삭제' }));

    expect(await screen.findByText(/응답이 있는 설문은 삭제할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '마감하기' })).toBeInTheDocument();
  });
});
