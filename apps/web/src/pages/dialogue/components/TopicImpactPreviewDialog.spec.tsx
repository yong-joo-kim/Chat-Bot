import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TopicImpactPreview } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { makeTopic } from '../../../test/fixtures';
import { TopicImpactPreviewDialog } from './TopicImpactPreviewDialog';

const mockImpact = vi.fn();
const mockEnable = vi.fn();
const mockDisable = vi.fn();
vi.mock('../../../api/topics', () => ({
  topicsApi: {
    impact: (...args: unknown[]) => mockImpact(...args),
    enable: (...args: unknown[]) => mockEnable(...args),
    disable: (...args: unknown[]) => mockDisable(...args),
  },
}));

function basePreview(overrides: Partial<TopicImpactPreview> = {}): TopicImpactPreview {
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

function renderDialog(action: 'ENABLE' | 'DISABLE' = 'DISABLE', onDone = vi.fn()) {
  const topic = makeTopic({ id: 'topic-1', name: '보험청구', enabled: action === 'DISABLE' });
  return render(
    <ToastProvider>
      <TopicImpactPreviewDialog isOpen chatbotId="bot-1" topic={topic} action={action} onClose={vi.fn()} onDone={onDone} />
    </ToastProvider>,
  );
}

/**
 * `topic-system-ui-spec.md` §3.2 — 미리보기 응답을 받기 전까지 확인 버튼을 내주지 않는 게이팅
 * (D-7, 프런트가 유일한 방어선)을 검증한다.
 */
describe('TopicImpactPreviewDialog — 비활성화 게이팅', () => {
  beforeEach(() => {
    mockImpact.mockReset();
    mockEnable.mockReset();
    mockDisable.mockReset();
  });

  it('미리보기 응답을 받기 전에는 확인(비활성화) 버튼이 비활성 상태다', async () => {
    let resolveImpact: (v: TopicImpactPreview) => void = () => {};
    mockImpact.mockReturnValue(new Promise<TopicImpactPreview>((resolve) => (resolveImpact = resolve)));
    renderDialog();

    expect(screen.getByText('영향을 확인하는 중…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '비활성화' })).not.toBeInTheDocument();

    resolveImpact(basePreview());
    const confirmButton = await screen.findByRole('button', { name: '비활성화' });
    expect(confirmButton).not.toBeDisabled();
  });

  it('오픈 즉시 impact API를 자동 호출한다(별도 "미리보기" 버튼 없음)', async () => {
    mockImpact.mockResolvedValue(basePreview());
    renderDialog();
    await waitFor(() => expect(mockImpact).toHaveBeenCalledWith('bot-1', 'topic-1', 'DISABLE'));
  });

  it('이미 그 상태(alreadyInState)면 안내 문구만 보이고 확인 버튼이 렌더되지 않는다', async () => {
    mockImpact.mockResolvedValue(basePreview({ alreadyInState: true }));
    renderDialog();

    await screen.findByText(/이미 비활성 상태입니다/);
    expect(screen.queryByRole('button', { name: '비활성화' })).not.toBeInTheDocument();
  });

  it('미리보기 완료 후 확인 클릭 시 disable API를 호출하고 onDone을 부른다', async () => {
    const user = userEvent.setup();
    mockImpact.mockResolvedValue(basePreview());
    mockDisable.mockResolvedValue(makeTopic({ id: 'topic-1', name: '보험청구', enabled: false }));
    const onDone = vi.fn();
    renderDialog('DISABLE', onDone);

    const confirmButton = await screen.findByRole('button', { name: '비활성화' });
    await user.click(confirmButton);

    await waitFor(() => expect(mockDisable).toHaveBeenCalledWith('bot-1', 'topic-1'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('미리보기 오류 시 확인 버튼이 계속 비활성이고 다시 시도 버튼이 보인다', async () => {
    mockImpact.mockRejectedValue(new Error('network'));
    renderDialog();

    await screen.findByRole('button', { name: '다시 시도' });
    expect(screen.queryByRole('button', { name: '비활성화' })).not.toBeInTheDocument();
  });
});
