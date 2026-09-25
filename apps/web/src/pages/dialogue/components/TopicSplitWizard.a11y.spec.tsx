import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { TopicSplitWizard } from './TopicSplitWizard';

expect.extend(toHaveNoViolations);

vi.mock('../../../api/topics', () => ({
  topicsApi: { splitPreview: vi.fn(), split: vi.fn() },
}));
vi.mock('../../../api/groups', () => ({
  groupsApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 }) },
}));

/** 분리 마법사(1단계) axe 접근성 스캔(topic-system-ui-spec.md §6.4). */
describe('TopicSplitWizard — axe 접근성 스캔', () => {
  it('1단계(토픽 선택) 화면에 구조적 접근성 위반이 없다', async () => {
    const topics = [makeTopic({ id: 'topic-1', name: '배송', enabled: true }), makeTopic({ id: 'topic-2', name: '보험청구', enabled: false })];
    const { container } = render(
      <ToastProvider>
        <MemoryRouter>
          <TopicSplitWizard isOpen chatbotId="bot-1" topics={topics} onClose={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>,
    );
    await screen.findByText('1/4단계');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
