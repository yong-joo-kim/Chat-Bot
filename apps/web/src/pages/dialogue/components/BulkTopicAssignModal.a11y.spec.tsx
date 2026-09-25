import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { BulkTopicAssignModal } from './BulkTopicAssignModal';

expect.extend(toHaveNoViolations);

vi.mock('../../../api/topics', () => ({
  topicAssignmentsApi: { assign: vi.fn() },
}));

/** 일괄 지정 모달 axe 접근성 스캔(topic-system-ui-spec.md §6.4). */
describe('BulkTopicAssignModal — axe 접근성 스캔', () => {
  it('구조적 접근성 위반이 없다', async () => {
    const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true })];
    const { container } = render(
      <ToastProvider>
        <BulkTopicAssignModal
          isOpen
          chatbotId="bot-1"
          resourceKind="INTENT"
          resourceKindLabel="의도"
          selectedIds={['intent-1']}
          topics={topics}
          onClose={vi.fn()}
          onAssigned={vi.fn()}
        />
      </ToastProvider>,
    );
    await screen.findByRole('combobox', { name: /대상 토픽/ });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
