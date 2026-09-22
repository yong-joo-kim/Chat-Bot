import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { IntentClassifierStatus } from '@chat-bot/shared-types';
import { ClassifierStatusPanel } from './ClassifierStatusPanel';

/**
 * FR-L3-9/AC-L3-4 — VIEWER에게는 분류기 재학습 버튼이 렌더되지 않는다(프론트 게이팅).
 * `ClassifierStatusPanel`은 `canWrite`를 부모(`LearningQueuePage`, `can('dialogue:write')`)로부터
 * prop으로 전달받으므로, 이 스펙은 그 prop 분기가 실제로 버튼 렌더를 좌우함을 증명한다.
 * 백엔드 403 게이팅은 `apps/api/src/integration/learning-augmentation.integration.spec.ts` 참고.
 */

const mockStatus = vi.fn();
vi.mock('../../api/classifier', () => ({
  classifierApi: {
    status: (...args: unknown[]) => mockStatus(...args),
    train: vi.fn(),
  },
}));

vi.mock('../../api/trainingJobs', () => ({
  trainingJobsApi: {
    get: vi.fn(),
  },
}));

function makeStatus(overrides: Partial<IntentClassifierStatus> = {}): IntentClassifierStatus {
  return {
    state: 'READY',
    classCount: 3,
    sampleCount: 24,
    stale: false,
    staleReasons: [],
    ...overrides,
  };
}

describe('ClassifierStatusPanel — VIEWER 렌더 게이팅(FR-L3-9, AC-L3-4)', () => {
  it('canWrite=false(VIEWER)면 재학습 버튼이 렌더되지 않는다', async () => {
    mockStatus.mockResolvedValue(makeStatus());
    render(<ClassifierStatusPanel chatbotId="chatbot-1" canWrite={false} />);

    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '지금 재학습' })).not.toBeInTheDocument();
    });
  });

  it('canWrite=true(EDITOR 이상)면 재학습 버튼이 렌더된다', async () => {
    mockStatus.mockResolvedValue(makeStatus());
    render(<ClassifierStatusPanel chatbotId="chatbot-1" canWrite={true} />);

    await waitFor(() => expect(mockStatus).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '지금 재학습' })).toBeInTheDocument();
    });
  });
});
