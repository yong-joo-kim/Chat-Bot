import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { TopicImpactPreview } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { TopicImpactPreviewDialog } from './TopicImpactPreviewDialog';

expect.extend(toHaveNoViolations);

const mockImpact = vi.fn();
vi.mock('../../../api/topics', () => ({
  topicsApi: { impact: (...args: unknown[]) => mockImpact(...args), enable: vi.fn(), disable: vi.fn() },
}));

function preview(overrides: Partial<TopicImpactPreview> = {}): TopicImpactPreview {
  return {
    topicId: 'topic-1',
    action: 'DISABLE',
    alreadyInState: false,
    entryPoints: { dialogNodes: 3, intents: 2, faqs: 1 },
    brokenRefs: { total: 0, items: [] },
    duplicateExamples: { total: 0, items: [] },
    liveEntryPointsAfter: 0,
    pendingRestoreSchedules: 0,
    ...overrides,
  };
}

/** [코드 리뷰 1회차 L-5] `TopicImpactPreviewDialog` axe 접근성 스캔. */
describe('TopicImpactPreviewDialog — axe 접근성 스캔', () => {
  it('미리보기 완료 상태에 구조적 접근성 위반이 없다', async () => {
    mockImpact.mockResolvedValue(preview());
    const topic = makeTopic({ id: 'topic-1', name: '보험청구', enabled: true });
    const { container } = render(
      <ToastProvider>
        <TopicImpactPreviewDialog isOpen chatbotId="bot-1" topic={topic} action="DISABLE" onClose={vi.fn()} onDone={vi.fn()} />
      </ToastProvider>,
    );
    await screen.findByRole('button', { name: '비활성화' });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
