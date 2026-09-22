import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AugmentationListResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { AugmentationPanel } from './AugmentationPanel';

/**
 * FR-L3-9/AC-L3-4 — VIEWER에게는 증강 생성·승인·거절 버튼이 렌더되지 않는다(프론트 게이팅).
 * 백엔드 403 게이팅은 `apps/api/src/integration/learning-augmentation.integration.spec.ts`에서
 * 별도로 검증한다 — 이 스펙은 "프론트가 애초에 버튼을 그리지 않는다"만 증명한다.
 */

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
    <ToastProvider>
      <AugmentationPanel
        chatbotId="chatbot-1"
        intentId="intent-1"
        currentExampleCount={1}
        onExamplesAccepted={vi.fn()}
      />
    </ToastProvider>,
  );
}

describe('AugmentationPanel — VIEWER 렌더 게이팅(FR-L3-9, AC-L3-4)', () => {
  it('VIEWER(dialogue:write 없음)는 생성 버튼이 렌더되지 않는다', async () => {
    mockUseAuth.mockReturnValue({ can: () => false });
    mockList.mockResolvedValue(makeListResponse({ items: [], total: 0, sufficientExamples: false }));

    renderPanel();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const toggle = screen.getAllByRole('button')[0];
    toggle.click();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '새로 생성하기' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '다시 생성하기' })).not.toBeInTheDocument();
    });
  });

  it('VIEWER는 제안 목록이 있어도 체크박스·승인·거절 액션이 렌더되지 않는다', async () => {
    mockUseAuth.mockReturnValue({ can: () => false });
    mockList.mockResolvedValue(makeListResponse());

    renderPanel();

    // 제안이 1건 이상이면 패널이 자동으로 펼쳐진다(hasAutoExpandedRef 로직) — 별도 토글 불필요.
    await waitFor(() => {
      expect(screen.getByText('환불 어떻게 해요?')).toBeInTheDocument();
    });

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '거절' })).not.toBeInTheDocument();
    expect(screen.queryByText(/건 선택됨/)).not.toBeInTheDocument();
  });

  it('EDITOR(dialogue:write 있음)는 생성 버튼이 렌더된다', async () => {
    mockUseAuth.mockReturnValue({ can: () => true });
    mockList.mockResolvedValue(makeListResponse({ items: [], total: 0, sufficientExamples: false }));

    renderPanel();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const toggle = screen.getAllByRole('button')[0];
    toggle.click();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '새로 생성하기' })).toBeInTheDocument();
    });
  });

  it('EDITOR는 제안 목록에서 체크박스·승인·거절 액션을 볼 수 있다', async () => {
    mockUseAuth.mockReturnValue({ can: () => true });
    mockList.mockResolvedValue(makeListResponse());

    renderPanel();

    await waitFor(() => {
      expect(screen.getByText('환불 어떻게 해요?')).toBeInTheDocument();
    });

    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '승인' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '거절' })).toBeInTheDocument();
  });
});
