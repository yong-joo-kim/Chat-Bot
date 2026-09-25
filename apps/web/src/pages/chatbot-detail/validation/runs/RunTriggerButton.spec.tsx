import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { EnvironmentStatus } from '@chat-bot/shared-types';
import { RunTriggerButton } from './RunTriggerButton';

expect.extend(toHaveNoViolations);

const mockStart = vi.fn();
const mockList = vi.fn();
vi.mock('../../../../api/validation', () => ({
  testRunsApi: {
    start: (...args: unknown[]) => mockStart(...args),
    list: (...args: unknown[]) => mockList(...args),
  },
}));

const mockVersionsList = vi.fn();
vi.mock('../../../../api/versions', () => ({
  versionsApi: { list: (...args: unknown[]) => mockVersionsList(...args) },
}));

const ENV_ENABLED: EnvironmentStatus = {
  enabled: true,
  enabledAt: new Date('2026-09-20T00:00:00.000Z'),
  prod: { versionId: 'ver-43', versionNo: 43, capturedAt: new Date(), label: null, switchedAt: new Date(), legacyTiebreak: false, readFailed: false, semanticPending: 0 },
  staging: { versionId: 'ver-44', versionNo: 44, capturedAt: new Date(), label: null, legacyTiebreak: false, semanticPending: 0 },
  draft: { contentHash: 'a'.repeat(64), sameAsProd: false, sameAsStaging: false },
  gate: { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 },
  activeSwitchSchedule: null,
} as EnvironmentStatus;

const SETS = [{ id: 'set-1', name: '정기 회귀', caseCount: 10 }];

/** [신규 No.40] `RunTriggerButton` 고급 옵션의 대상 선택(`environment-separation-ui-spec.md` §4.14). */
describe('RunTriggerButton — 대상 선택(No.40)', () => {
  beforeEach(() => {
    mockStart.mockReset();
    mockList.mockReset();
    mockVersionsList.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
  });

  it('environmentStatus가 없으면 고급 옵션에 대상 선택 컨트롤이 없다', async () => {
    const user = userEvent.setup();
    render(<RunTriggerButton chatbotId="bot-1" sets={SETS} onStarted={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: '실행하기' }));
    await user.click(screen.getByRole('button', { name: /고급 옵션/ }));
    expect(screen.queryByLabelText('대상')).not.toBeInTheDocument();
  });

  it('environmentStatus가 켜져 있으면 대상을 선택할 수 있고, 실행 시작 요청에 target이 실린다', async () => {
    const user = userEvent.setup();
    mockStart.mockResolvedValue({ runId: 'run-1', status: 'QUEUED' });
    render(<RunTriggerButton chatbotId="bot-1" sets={SETS} onStarted={vi.fn()} environmentStatus={ENV_ENABLED} />);

    await user.click(screen.getByRole('button', { name: '실행하기' }));
    await user.click(screen.getByRole('button', { name: /고급 옵션/ }));
    await user.selectOptions(screen.getByLabelText('대상'), '스테이징(v44)');
    await user.click(screen.getByRole('button', { name: '실행 시작' }));

    await waitFor(() =>
      expect(mockStart).toHaveBeenCalledWith('bot-1', 'set-1', expect.objectContaining({ target: { kind: 'STAGING' } })),
    );
  });

  it('대상을 바꾸지 않으면(초안) target을 보내지 않는다', async () => {
    const user = userEvent.setup();
    mockStart.mockResolvedValue({ runId: 'run-1', status: 'QUEUED' });
    render(<RunTriggerButton chatbotId="bot-1" sets={SETS} onStarted={vi.fn()} environmentStatus={ENV_ENABLED} />);

    await user.click(screen.getByRole('button', { name: '실행하기' }));
    await user.click(screen.getByRole('button', { name: '실행 시작' }));

    await waitFor(() => expect(mockStart).toHaveBeenCalled());
    expect(mockStart.mock.calls[0][2].target).toBeUndefined();
  });

  it('대상 선택 컨트롤을 포함한 고급 옵션 — axe 스캔 위반 0건', async () => {
    const user = userEvent.setup();
    const { container } = render(<RunTriggerButton chatbotId="bot-1" sets={SETS} onStarted={vi.fn()} environmentStatus={ENV_ENABLED} />);
    await user.click(screen.getByRole('button', { name: '실행하기' }));
    await user.click(screen.getByRole('button', { name: /고급 옵션/ }));
    await screen.findByLabelText('대상');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
