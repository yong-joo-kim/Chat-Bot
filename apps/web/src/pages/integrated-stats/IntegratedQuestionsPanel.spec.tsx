import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { IntegratedQuestions } from '@chat-bot/shared-types';
import { IntegratedQuestionsPanel } from './IntegratedQuestionsPanel';

function makeQuestions(overrides: Partial<IntegratedQuestions> = {}): IntegratedQuestions {
  return {
    scope: 'ALL',
    groupId: null,
    backfillPending: false,
    generatedAt: new Date('2026-09-24T00:00:00.000Z'),
    timezone: 'Asia/Seoul',
    periodStart: new Date('2026-08-24T00:00:00.000Z'),
    periodEnd: new Date('2026-09-22T23:59:59.999Z'),
    granularity: 'DAY',
    topQuestions: [{ question: '배송 언제 오나요', count: 1204, topChatbotId: 'bot-1', topChatbotName: '배송봇' }],
    topUnansweredQuestions: [{ question: '해외배송도 되나요', count: 44, topChatbotId: 'bot-2', topChatbotName: '세무상담봇' }],
    approximated: false,
    candidateLimit: 500,
    includeArchivedChatbots: true,
    ...overrides,
  };
}

function renderPanel(props: Partial<Parameters<typeof IntegratedQuestionsPanel>[0]> = {}): ReturnType<typeof render> {
  const defaults = { questions: makeQuestions(), includeArchivedChatbots: true, onIncludeArchivedChange: vi.fn() };
  return render(
    <MemoryRouter>
      <IntegratedQuestionsPanel {...defaults} {...props} />
    </MemoryRouter>,
  );
}

describe('IntegratedQuestionsPanel', () => {
  it('"최다 챗봇" 링크가 있는 질문 목록을 렌더한다', () => {
    renderPanel();
    expect(screen.getByText(/배송 언제 오나요/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '배송봇 통계 보기 →' });
    expect(link).toHaveAttribute('href', '/chatbots/bot-1/stats/overview');
  });

  it('topChatbotName이 없으면 "해당 없음"을 텍스트로 보여준다', () => {
    renderPanel({ questions: makeQuestions({ topQuestions: [{ question: '문의', count: 1, topChatbotId: null, topChatbotName: null }] }) });
    expect(screen.getByText(/해당 없음/)).toBeInTheDocument();
  });

  it('"보관 챗봇 포함" 체크박스는 기본 체크되어 있고 토글하면 콜백이 호출된다', () => {
    const onIncludeArchivedChange = vi.fn();
    renderPanel({ onIncludeArchivedChange });
    const checkbox = screen.getByRole('checkbox', { name: '보관 챗봇 포함' });
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(onIncludeArchivedChange).toHaveBeenCalledWith(false);
  });

  it('질문이 없으면 빈 상태 문구를 보여준다', () => {
    renderPanel({ questions: makeQuestions({ topQuestions: [], topUnansweredQuestions: [] }) });
    expect(screen.getAllByText('데이터가 없습니다.')).toHaveLength(2);
  });

  /**
   * No.29 AC-I5-3/EX-I-* — approximated:true(후보 500건 초과)일 때 근사 안내 캡션이 두 목록
   * 제목(인기 질문·인기 미응답 질문)에 각각 붙는지. 기존 시험은 항상 approximated:false만 썼다.
   */
  it('approximated:true면 두 목록 제목에 "(근사, 상위 N건 후보 기준)" 캡션이 붙는다', () => {
    renderPanel({ questions: makeQuestions({ approximated: true, candidateLimit: 500 }) });
    const captions = screen.getAllByText(/\(근사, 상위 500건 후보 기준\)/);
    expect(captions).toHaveLength(2);
  });
});
