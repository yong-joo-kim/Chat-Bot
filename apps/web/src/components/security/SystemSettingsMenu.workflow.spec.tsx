import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SystemSettingsMenu } from './SystemSettingsMenu';

const mockDeployScheduleSummary = vi.fn();
const mockWorkflowSummary = vi.fn();

vi.mock('../../api/deploySchedules', () => ({
  deploySchedulesApi: { summary: (...args: unknown[]) => mockDeployScheduleSummary(...args) },
}));
vi.mock('../../api/workflowRuns', () => ({
  workflowRunsApi: { summary: (...args: unknown[]) => mockWorkflowSummary(...args) },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

/** WF10 — `SystemSettingsMenu` 항목 추가(workflow-automation-ui-spec.md §3.12). */
describe('SystemSettingsMenu — 업무 자동화 항목(No.41)', () => {
  beforeEach(() => {
    mockDeployScheduleSummary.mockReset();
    mockDeployScheduleSummary.mockResolvedValue({ needsAttention: { byChatbot: [], total: 0 } });
    mockWorkflowSummary.mockReset();
  });

  it('"API 연결" 다음, "데이터 거버넌스" 앞에 "업무 자동화" 항목이 보인다', async () => {
    mockWorkflowSummary.mockResolvedValue({ attention: { failingTargets: 0, failedRetained: 0, secretMissingTargets: 0, enqueueFailures24h: 0 } });
    render(
      <MemoryRouter>
        <SystemSettingsMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /시스템 설정/ }));

    const items = screen.getAllByRole('menuitem').map((el) => el.textContent);
    const apiIndex = items.findIndex((t) => t?.includes('API 연결'));
    const workflowIndex = items.findIndex((t) => t?.includes('업무 자동화'));
    const governanceIndex = items.findIndex((t) => t?.includes('데이터 거버넌스'));
    expect(apiIndex).toBeLessThan(workflowIndex);
    expect(workflowIndex).toBeLessThan(governanceIndex);
  });

  it('확인 필요 항목이 있으면 경량 점 배지(●)가 붙는다', async () => {
    mockWorkflowSummary.mockResolvedValue({ attention: { failingTargets: 1, failedRetained: 0, secretMissingTargets: 0, enqueueFailures24h: 0 } });
    render(
      <MemoryRouter>
        <SystemSettingsMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /시스템 설정/ }));

    expect(await screen.findByLabelText('확인이 필요한 항목이 있습니다')).toBeInTheDocument();
  });

  it('확인 필요 항목이 없으면 점 배지가 붙지 않는다', async () => {
    mockWorkflowSummary.mockResolvedValue({ attention: { failingTargets: 0, failedRetained: 0, secretMissingTargets: 0, enqueueFailures24h: 0 } });
    render(
      <MemoryRouter>
        <SystemSettingsMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /시스템 설정/ }));

    await screen.findByText('업무 자동화');
    expect(screen.queryByLabelText('확인이 필요한 항목이 있습니다')).not.toBeInTheDocument();
  });
});
