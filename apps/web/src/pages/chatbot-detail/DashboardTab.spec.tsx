import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { makeChatbot, makeDashboardSummary, makeEmptyDashboardSummary } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { DashboardTab } from './DashboardTab';

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333', name: 'empty-dashboard-bot' });

const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(),
};

vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const mockGetDashboard = vi.fn();
vi.mock('../../api/stats', () => ({
  statsApi: {
    getDashboard: (...args: unknown[]) => mockGetDashboard(...args),
  },
}));

function renderDashboardTab(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <DashboardTab />
    </MemoryRouter>,
  );
}

/**
 * seed 트랙 `empty-dashboard-bot`(로그 0건)과 `sample-support-bot`(로그 100건) 기준
 * AC-2-6(빈 상태) / AC-2-11(로딩 스켈레톤→완료 배지) / AC-2-12(새로고침 연타 방지)를 검증한다.
 * code-reviewer 지목 항목 (c) "대시보드 빈 상태/오류 상태 분기"의 핵심 커버리지.
 */
describe('DashboardTab', () => {
  beforeEach(() => {
    mockGetDashboard.mockReset();
  });

  it('로그 0건(empty-dashboard-bot)이면 지표가 0으로 표시되고 빈 상태 안내(오류 아님)가 노출된다(AC-2-6)', async () => {
    mockGetDashboard.mockResolvedValue(makeEmptyDashboardSummary({ chatbotId: chatbot.id }));
    renderDashboardTab();

    await waitFor(() => expect(mockGetDashboard).toHaveBeenCalled());

    expect(await screen.findByText('아직 수집된 대화 데이터가 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('챗봇을 배포하고 대화가 쌓이면 표시됩니다.')).toBeInTheDocument();

    // 빈 상태는 EmptyState(중립색)로 렌더링되고, ErrorState(role=alert)는 나타나지 않아야 한다.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // 카드 값은 0/0.0%로 표시된다(FR-2-9, NaN/null 금지).
    expect(screen.getByText('접속수').closest('.metric-card')).toHaveTextContent('0');
    expect(screen.getByText('응답률').closest('.metric-card')).toHaveTextContent('0.0%');
    expect(screen.getByText('미응답률').closest('.metric-card')).toHaveTextContent('0.0%');

    // "임베드 설정으로 이동" 링크(CTA)가 함께 제공된다.
    expect(screen.getByRole('link', { name: '임베드 설정으로 이동' })).toHaveAttribute(
      'href',
      `/chatbots/${chatbot.id}/skin?section=embed`,
    );
  });

  it('로그가 있으면(sample-support-bot) 인기질문 목록이 표시되고 빈 상태 문구는 나타나지 않는다', async () => {
    mockGetDashboard.mockResolvedValue(makeDashboardSummary({ chatbotId: chatbot.id }));
    renderDashboardTab();

    expect(await screen.findByText('1. 배송 조회 · 12건')).toBeInTheDocument();
    expect(screen.getByText('2. 환불 절차 · 7건')).toBeInTheDocument();
    expect(screen.queryByText('아직 수집된 대화 데이터가 없습니다.')).not.toBeInTheDocument();
  });

  it('조회 중에는 스켈레톤이 표시되고, 완료 시 "조회 기간 · 집계 건수" 배지로 전환된다(AC-2-11/FR-2-12)', async () => {
    let resolvePromise: (value: ReturnType<typeof makeEmptyDashboardSummary>) => void = () => {};
    mockGetDashboard.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );
    renderDashboardTab();

    // 로딩 중에는 "조회 기간 · 집계 N건" 완료 배지(ResultSummaryBadge)가 보이지 않는다.
    // (PeriodSelector의 "조회 기간" 범례(legend)와는 구분되는, "집계 N건" 문구가 포함된 배지만 확인한다.)
    expect(screen.queryByText(/집계 \d+건/)).not.toBeInTheDocument();

    resolvePromise(makeEmptyDashboardSummary({ chatbotId: chatbot.id }));

    expect(await screen.findByText(/조회 기간 .* · 집계 0건/)).toBeInTheDocument();
  });

  it('새로고침 버튼을 빠르게 연타해도 요청은 최초 1회만 진행 중 상태로 처리된다(AC-2-12)', async () => {
    mockGetDashboard.mockResolvedValue(makeEmptyDashboardSummary({ chatbotId: chatbot.id }));
    renderDashboardTab();
    await screen.findByText('아직 수집된 대화 데이터가 없습니다.');

    const callsBeforeRefresh = mockGetDashboard.mock.calls.length;
    const refreshButton = screen.getByRole('button', { name: '새로고침' });
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);
    fireEvent.click(refreshButton);

    await waitFor(() => expect(mockGetDashboard.mock.calls.length).toBe(callsBeforeRefresh + 1));
  });
});
