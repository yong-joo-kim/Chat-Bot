import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { ProactiveOverviewResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ProactiveSection } from './ProactiveSection';

expect.extend(toHaveNoViolations);

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

const mockGetOverview = vi.fn();
vi.mock('../../../api/proactive', () => ({
  proactiveApi: {
    getOverview: (...args: unknown[]) => mockGetOverview(...args),
    saveSettings: vi.fn(),
    createRule: vi.fn(),
    updateRule: vi.fn(),
    deleteRule: vi.fn(),
    enableRule: vi.fn(),
    disableRule: vi.fn(),
    moveRule: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock('../../../api/chatbots', () => ({
  chatbotsApi: { embedCode: vi.fn().mockResolvedValue({ publicUrl: 'https://example.test', pc: '<script data-chatbot="x"></script>', mobile: '' }) },
}));

function makeOverview(overrides: Partial<ProactiveOverviewResponse> = {}): ProactiveOverviewResponse {
  return {
    settings: { enabled: true, maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300, updatedAt: null },
    serverEnabled: true,
    context: { chatbotStatus: 'ACTIVE', webChannelEnabled: true, launcherHidden: false, environmentMode: false },
    limits: { rulesMax: 20, enabledRulesMax: 10 },
    rules: [],
    ...overrides,
  };
}

/** 설계서 §16.1 — 선제 안내(No.35) 콘솔 섹션 axe 접근성 스캔(Medium #4). */
describe('ProactiveSection — axe 접근성 스캔', () => {
  it('규칙이 0개인 빈 상태 화면에 구조적 접근성 위반이 없다', async () => {
    mockGetOverview.mockResolvedValue(makeOverview());
    const { container } = render(
      <ToastProvider>
        <ProactiveSection chatbotId="bot-1" isArchived={false} primaryColor="#4F46E5" />
      </ToastProvider>,
    );
    await screen.findByText('아직 선제 안내 규칙이 없습니다');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('규칙이 있는 목록 화면에 구조적 접근성 위반이 없다', async () => {
    mockGetOverview.mockResolvedValue(
      makeOverview({
        rules: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: '배송조회 도움',
            enabled: true,
            position: 0,
            trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 5 },
            text: '주문·배송 조회를 도와드릴까요?',
            buttons: [],
            devices: ['DESKTOP', 'MOBILE'],
            startsAt: null,
            endsAt: null,
            schedule: null,
            periodState: 'ALWAYS',
            issues: [],
            warnings: [],
            last7d: { shown: 12, clicked: 3, dismissed: 1, optedOut: 0 },
          },
        ],
      }),
    );
    const { container } = render(
      <ToastProvider>
        <ProactiveSection chatbotId="bot-1" isArchived={false} primaryColor="#4F46E5" />
      </ToastProvider>,
    );
    await screen.findByText('배송조회 도움');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
