import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ToastProvider } from '../../../components/Toast';
import { SimulatorPanel } from './SimulatorPanel';

expect.extend(toHaveNoViolations);

vi.mock('../../../api/simulation', () => ({
  simulationApi: { simulate: vi.fn(), compare: vi.fn() },
}));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
const mockListOk = () => Promise.resolve({ items: [], total: 0 });
vi.mock('../../../api/dialogue', () => ({
  dialogNodesApi: { list: () => mockListOk(), findOne: vi.fn() },
  intentsApi: { list: () => mockListOk() },
  keywordsApi: { list: () => mockListOk() },
  homonymsApi: { list: () => mockListOk() },
  contextsApi: { list: () => mockListOk() },
  faqsApi: { list: () => mockListOk() },
}));

/** SIM-ext "비활성 토픽 포함" 토글 axe 접근성 스캔(topic-system-ui-spec.md §6.4). */
describe('SimulatorPanel(비활성 토픽 포함 토글) — axe 접근성 스캔', () => {
  it('구조적 접근성 위반이 없다', async () => {
    const { container } = render(
      <ToastProvider>
        <SimulatorPanel chatbotId="bot-1" isArchived={false} mode="tab" />
      </ToastProvider>,
    );
    await screen.findByRole('checkbox', { name: '비활성 토픽 포함' });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
