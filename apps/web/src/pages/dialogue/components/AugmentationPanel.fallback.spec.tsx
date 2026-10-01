import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AugmentationListResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeDeployScheduleMeta } from '../../../test/fixtures';
import { resetDeployScheduleMetaCacheForTests } from '../../../lib/useDeployScheduleMeta';
import { axe, toHaveNoViolations } from 'jest-axe';
import { AugmentationPanel } from './AugmentationPanel';

/** K-1b/FR-L1-7 — 폴백 생성(`runResult.degraded && fallbackFrom`)일 때만 안내 1줄을 보인다. 원인 코드는 노출하지 않는다. */

const mockUseAuth = vi.fn();
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockList = vi.fn();
vi.mock('../../../api/augmentation', () => ({
  augmentationsApi: {
    list: (...args: unknown[]) => mockList(...args),
    generate: vi.fn(),
    accept: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock('../../../api/trainingJobs', () => ({
  trainingJobsApi: {
    get: vi.fn(),
  },
}));

const mockNotice = vi.fn();
const mockMeta = vi.fn();
vi.mock('../../../api/deploySchedules', () => ({
  deploySchedulesApi: {
    notice: (...args: unknown[]) => mockNotice(...args),
    meta: (...args: unknown[]) => mockMeta(...args),
  },
}));

function makeListResponse(overrides: Partial<AugmentationListResponse> = {}): AugmentationListResponse {
  return {
    items: [
      {
        id: 'suggestion-1',
        text: '환불 어떻게 해요?',
        similarityToSeed: 0.86,
        status: 'PENDING',
        providerId: 'rule',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        stale: false,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 20,
    capability: {
      providerId: 'rule',
      configuredProviderId: 'rule',
      degraded: false,
      embeddingReady: true,
      requiresNetwork: false,
    },
    sufficientExamples: false,
    ...overrides,
  };
}

function renderPanel(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <AugmentationPanel
          chatbotId="chatbot-1"
          intentId="intent-1"
          currentExampleCount={1}
          onExamplesAccepted={vi.fn()}
        />
      </ToastProvider>
    </MemoryRouter>,
  );
}

expect.extend(toHaveNoViolations);

const NOTICE = '고급 증강을 사용할 수 없어 기본 방식으로 생성했습니다.';
const baseRun = { generated: 3, accepted: 1, rejected: {}, providerId: 'rule' as const };

describe('AugmentationPanel — 폴백 안내(K-1b, FR-L1-7)', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ can: () => true });
    mockNotice.mockReset();
    mockNotice.mockResolvedValue({ upcomingRestore: null, activeCount: 0 });
    mockMeta.mockReset();
    mockMeta.mockResolvedValue(makeDeployScheduleMeta());
    resetDeployScheduleMetaCacheForTests();
  });

  it('폴백 요약이면 안내 1줄이 보이고 원인 코드는 노출되지 않으며 axe 위반이 없다', async () => {
    mockList.mockResolvedValue(
      makeListResponse({ runResult: { ...baseRun, degraded: true, fallbackFrom: 'local', fallbackCause: 'HTTP_5XX' } }),
    );
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <AugmentationPanel chatbotId="chatbot-1" intentId="intent-1" currentExampleCount={1} onExamplesAccepted={vi.fn()} />
        </ToastProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(container.textContent).not.toContain('HTTP_5XX');
    expect(await axe(container, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();
  });

  it.each([
    ['폴백 키 없음', { ...baseRun, degraded: false }],
    ['degraded만 true(fallbackFrom 없음)', { ...baseRun, degraded: true }],
    ['fallbackFrom만 있고 degraded false', { ...baseRun, degraded: false, fallbackFrom: 'gemini' as const }],
  ])('%s이면 안내가 표시되지 않는다', async (_label, runResult) => {
    mockList.mockResolvedValue(makeListResponse({ runResult }));
    renderPanel();
    await screen.findByText('환불 어떻게 해요?');
    expect(screen.queryByText(NOTICE)).not.toBeInTheDocument();
  });
});
