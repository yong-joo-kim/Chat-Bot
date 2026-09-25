import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { DeleteTopicConfirmDialog } from './DeleteTopicConfirmDialog';

expect.extend(toHaveNoViolations);

vi.mock('../../../api/topics', () => ({
  topicsApi: { remove: vi.fn() },
}));

/** [코드 리뷰 1회차 L-5] `DeleteTopicConfirmDialog` axe 접근성 스캔(자산 0건/자산 있음 두 상태). */
describe('DeleteTopicConfirmDialog — axe 접근성 스캔', () => {
  it('자산 0건(즉시 삭제) 상태에 구조적 접근성 위반이 없다', async () => {
    const topic = makeTopic({ id: 'topic-1', name: '배송' });
    const { container } = render(
      <ToastProvider>
        <DeleteTopicConfirmDialog
          isOpen
          chatbotId="bot-1"
          topic={topic}
          counts={{ intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 }}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </ToastProvider>,
    );
    await screen.findByText("'배송' 삭제");

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('자산이 있는(공통으로 옮기고 삭제) 상태에도 접근성 위반이 없다', async () => {
    const topic = makeTopic({ id: 'topic-2', name: '보험청구' });
    const { container } = render(
      <ToastProvider>
        <DeleteTopicConfirmDialog
          isOpen
          chatbotId="bot-1"
          topic={topic}
          counts={{ intents: 8, keywords: 10, homonyms: 1, contexts: 2, dialogNodes: 6, faqs: 9 }}
          onClose={vi.fn()}
          onDeleted={vi.fn()}
        />
      </ToastProvider>,
    );
    await screen.findByRole('button', { name: '공통으로 옮기고 삭제' });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
