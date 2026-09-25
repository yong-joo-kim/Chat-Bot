import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EnvironmentGateSettings } from '@chat-bot/shared-types';
import { GateSettingsPanel } from './GateSettingsPanel';

const mockUpdateGate = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    updateGate: (...args: unknown[]) => mockUpdateGate(...args),
  },
}));

vi.mock('../../../api/validation', () => ({
  testSetsApi: { list: vi.fn().mockResolvedValue({ items: [{ id: 'set-1', name: '정기 회귀' }], total: 1, page: 1, pageSize: 100 }) },
}));

const WARN_GATE: EnvironmentGateSettings = { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 };

/** EN1-e 게이트 설정(`environment-separation-ui-spec.md` §4.7). */
describe('GateSettingsPanel', () => {
  beforeEach(() => {
    mockUpdateGate.mockReset();
  });

  it('접힌 상태에서는 요약 문구만 보이고 폼은 렌더되지 않는다', () => {
    render(<GateSettingsPanel chatbotId="bot-1" gate={WARN_GATE} canWrite onSaved={vi.fn()} />);
    expect(screen.getByText('게이트: 경고만 표시')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('펼치면 현재 값을 담은 폼이 보인다', async () => {
    const user = userEvent.setup();
    render(<GateSettingsPanel chatbotId="bot-1" gate={WARN_GATE} canWrite onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /게이트 설정/ }));

    expect(await screen.findByRole('radio', { name: /경고만 표시/ })).toBeChecked();
  });

  it('차단 모드에서 TC 세트를 선택하지 않고 저장하면 인라인 오류가 뜨고 저장 API가 호출되지 않는다', async () => {
    const user = userEvent.setup();
    render(<GateSettingsPanel chatbotId="bot-1" gate={WARN_GATE} canWrite onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /게이트 설정/ }));
    await user.click(await screen.findByRole('radio', { name: /차단/ }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    await screen.findByText('차단 모드에서는 필수 TC 세트를 선택해야 합니다.');
    expect(mockUpdateGate).not.toHaveBeenCalled();
  });

  it('유효한 값으로 저장하면 updateGate를 호출하고 접힌다', async () => {
    const user = userEvent.setup();
    mockUpdateGate.mockResolvedValue({ mode: 'WARN', testSetId: null, minPassRate: 90, validHours: 24 });
    const onSaved = vi.fn();
    render(<GateSettingsPanel chatbotId="bot-1" gate={WARN_GATE} canWrite onSaved={onSaved} />);
    await user.click(screen.getByRole('button', { name: /게이트 설정/ }));
    await screen.findByRole('radio', { name: /경고만 표시/ });
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(mockUpdateGate).toHaveBeenCalledWith('bot-1', { mode: 'WARN', testSetId: null, minPassRate: 95, validHours: 24 }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('canWrite=false면 저장 버튼이 렌더되지 않는다(§6)', async () => {
    const user = userEvent.setup();
    render(<GateSettingsPanel chatbotId="bot-1" gate={WARN_GATE} canWrite={false} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /게이트 설정/ }));
    await screen.findByRole('radio', { name: /경고만 표시/ });
    expect(screen.queryByRole('button', { name: '저장' })).not.toBeInTheDocument();
  });

  it('initiallyExpanded=true면 펼쳐진 채로 시작한다(§4.6(c) GATE_CONFIG_ERROR 링크 진입)', () => {
    render(<GateSettingsPanel chatbotId="bot-1" gate={WARN_GATE} canWrite onSaved={vi.fn()} initiallyExpanded />);
    expect(screen.getByRole('button', { name: /게이트 설정/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: /경고만 표시/ })).toBeInTheDocument();
  });

  it('접힌 상태에서 currentTestSetName이 있으면 TC 세트 조회 전에도 이름이 보인다(§4.6(d))', () => {
    const BLOCK_GATE: EnvironmentGateSettings = { mode: 'BLOCK', testSetId: 'set-1', minPassRate: 95, validHours: 24 };
    render(<GateSettingsPanel chatbotId="bot-1" gate={BLOCK_GATE} canWrite onSaved={vi.fn()} currentTestSetName="정기 회귀" />);
    expect(screen.getByText('게이트: 차단(정기 회귀 · 95% 이상)')).toBeInTheDocument();
  });
});
