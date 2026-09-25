import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WebChannelConfig } from '@chat-bot/shared-types';
import { WebChannelForm } from './WebChannelForm';

function makeConfig(overrides: Partial<WebChannelConfig> = {}): WebChannelConfig {
  return {
    allowedOrigins: [],
    greetingMessage: undefined,
    quickReplies: [],
    launcherPosition: 'RIGHT',
    showLauncher: true,
    ...overrides,
  };
}

/**
 * No.44 FB-CH — config 전체 교체 계약 회귀(feedback-loop-ui-spec.md §3.1 ⚠). `feedbackEnabled`를
 * 별도 요청으로 쪼개지 않고, 다른 필드를 건드리지 않아도 항상 같은 저장 요청에 포함해야 한다.
 */
describe('WebChannelForm — 답변 평가 받기(feedbackEnabled)', () => {
  it('초기값이 없으면(undefined) 미체크 상태로 시작하고, 저장 시 feedbackEnabled: false를 포함한다', async () => {
    const onSave = vi.fn();
    render(<WebChannelForm initial={makeConfig()} saving={false} onSave={onSave} onCancel={vi.fn()} />);

    const checkbox = screen.getByLabelText('답변 평가 받기');
    expect(checkbox).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ feedbackEnabled: false }));
  });

  it('저장된 값이 true면 체크 상태로 시작하고, 다른 필드만 바꿔도 feedbackEnabled: true가 유지된 채 저장된다', async () => {
    const onSave = vi.fn();
    render(
      <WebChannelForm
        initial={makeConfig({ feedbackEnabled: true, greetingMessage: '안녕하세요' })}
        saving={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    const checkbox = screen.getByLabelText('답변 평가 받기');
    expect(checkbox).toBeChecked();

    // 평가 스위치를 건드리지 않고 다른 필드(런처 표시)만 바꾼다.
    await userEvent.click(screen.getByLabelText('런처 버튼 표시'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ feedbackEnabled: true, showLauncher: false }));
  });

  it('체크박스를 켜고 저장하면 feedbackEnabled: true로 전송된다', async () => {
    const onSave = vi.fn();
    render(<WebChannelForm initial={makeConfig()} saving={false} onSave={onSave} onCancel={vi.fn()} />);

    await userEvent.click(screen.getByLabelText('답변 평가 받기'));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ feedbackEnabled: true }));
  });
});
