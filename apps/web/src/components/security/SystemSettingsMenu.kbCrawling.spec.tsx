import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SystemSettingsMenu } from './SystemSettingsMenu';

const mockDeployScheduleSummary = vi.fn();
const mockWorkflowSummary = vi.fn();
const mockKbMeta = vi.fn();

vi.mock('../../api/deploySchedules', () => ({
  deploySchedulesApi: { summary: (...args: unknown[]) => mockDeployScheduleSummary(...args) },
}));
vi.mock('../../api/workflowRuns', () => ({
  workflowRunsApi: { summary: (...args: unknown[]) => mockWorkflowSummary(...args) },
}));
vi.mock('../../api/kbSources', () => ({
  kbSourcesApi: { meta: (...args: unknown[]) => mockKbMeta(...args) },
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

/** KB1/KB12 — `SystemSettingsMenu` "지식베이스 동기화" 항목(kb-crawling-ui-spec.md §3.9). */
describe('SystemSettingsMenu — 지식베이스 동기화 항목(No.43)', () => {
  beforeEach(() => {
    mockDeployScheduleSummary.mockReset();
    mockDeployScheduleSummary.mockResolvedValue({ needsAttention: { byChatbot: [], total: 0 } });
    mockWorkflowSummary.mockReset();
    mockWorkflowSummary.mockResolvedValue({ attention: { failingTargets: 0, failedRetained: 0, secretMissingTargets: 0, enqueueFailures24h: 0 } });
    mockKbMeta.mockReset();
  });

  it('meta 조회에 성공하면(기능 켜짐) "지식베이스 동기화" 항목이 보인다', async () => {
    mockKbMeta.mockResolvedValue({ enabled: true });
    render(
      <MemoryRouter>
        <SystemSettingsMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /시스템 설정/ }));

    expect(await screen.findByRole('menuitem', { name: '지식베이스 동기화' })).toBeInTheDocument();
  });

  it('meta가 404면(KB_SYNC_ENABLED=false) 항목 자체를 렌더하지 않는다(KB1)', async () => {
    const { ApiError } = await import('../../api/client');
    mockKbMeta.mockRejectedValue(new ApiError(404, '지식베이스 동기화 기능이 꺼져 있습니다.', 'NOT_FOUND'));
    render(
      <MemoryRouter>
        <SystemSettingsMenu />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /시스템 설정/ }));

    await screen.findByRole('menuitem', { name: 'API 연결' });
    await waitFor(() => expect(mockKbMeta).toHaveBeenCalled());
    expect(screen.queryByRole('menuitem', { name: '지식베이스 동기화' })).not.toBeInTheDocument();
  });
});
