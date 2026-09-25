import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { makeChatbot } from '../../test/fixtures';
import type { ChatbotDetailContext } from '../ChatbotDetailLayout';
import { ApiCallLogPage } from './ApiCallLogPage';

expect.extend(toHaveNoViolations);

const chatbot = makeChatbot({ id: '33333333-3333-4333-8333-333333333333' });
const mockContext: ChatbotDetailContext = {
  chatbot,
  reload: vi.fn().mockResolvedValue(undefined),
  setUnsavedGuard: vi.fn(), learningSummary: null, refreshLearningSummary: vi.fn() };

vi.mock('../ChatbotDetailLayout', () => ({
  useChatbotDetailContext: () => mockContext,
}));

const mockSummary = vi.fn();
const mockList = vi.fn();
vi.mock('../../api/apiCallLogs', () => ({
  apiCallLogsApi: {
    summary: (...args: unknown[]) => mockSummary(...args),
    list: (...args: unknown[]) => mockList(...args),
  },
}));
vi.mock('../../api/apiConnections', () => ({
  apiConnectionsApi: { list: vi.fn().mockResolvedValue({ items: [] }) },
}));

function makeLogItem(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    createdAt: new Date('2026-09-24T01:02:03.000Z'),
    connectionId: '22222222-2222-2222-2222-222222222222',
    connectionName: 'ERP 주문',
    source: 'PUBLIC',
    method: 'GET',
    pathTemplate: '/orders/{0}',
    outcome: 'SUCCESS',
    httpStatus: 200,
    latencyMs: 212,
    branch: 'CONDITION',
    conditionIndex: 0,
    personalDataMasked: true,
    ...overrides,
  };
}

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <ApiCallLogPage />
    </MemoryRouter>,
  );
}

/** L1 — 외부 연동 로그 axe 접근성 스캔(legacy-api-integration-ui-spec.md §3.8, AC-L8-2). */
describe('ApiCallLogPage — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockSummary.mockReset();
    mockList.mockReset();
  });

  it('호출 이력이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    mockSummary.mockResolvedValue({
      total: 1,
      success: 1,
      successRate: 1,
      byOutcome: { SUCCESS: 1 },
      p95LatencyMs: 212,
      byConnection: [],
    });
    mockList.mockResolvedValue({ items: [makeLogItem()], total: 1, page: 1, pageSize: 50 });

    const { container } = renderPage();
    await screen.findAllByText('ERP 주문');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('기간 내 호출 0건(빈 상태)에도 접근성 위반이 없다', async () => {
    mockSummary.mockResolvedValue({ total: 0, success: 0, successRate: 0, byOutcome: {}, p95LatencyMs: 0, byConnection: [] });
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });

    const { container } = renderPage();
    await screen.findByText('선택한 기간에 외부 API 호출 기록이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
