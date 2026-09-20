import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChannelListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { ChannelCard } from './ChannelCard';

const mockUpsert = vi.fn();
const mockRemove = vi.fn();
vi.mock('../../../api/channels', () => ({
  channelsApi: {
    upsert: (...args: unknown[]) => mockUpsert(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    list: vi.fn(),
  },
}));

function makeWebItem(overrides: Partial<ChannelListItem> = {}): ChannelListItem {
  return {
    type: 'WEB',
    label: '웹',
    implementation: 'IMPLEMENTED',
    configured: false,
    enabled: false,
    config: { allowedOrigins: [], greetingMessage: undefined, quickReplies: [], launcherPosition: 'RIGHT', showLauncher: true },
    updatedAt: null,
    ...overrides,
  } as ChannelListItem;
}

function makeKakaoItem(overrides: Partial<ChannelListItem> = {}): ChannelListItem {
  return {
    type: 'KAKAOTALK',
    label: '카카오톡',
    implementation: 'CONFIG_ONLY',
    configured: false,
    enabled: false,
    config: { note: undefined },
    updatedAt: null,
    ...overrides,
  } as ChannelListItem;
}

function renderCard(item: ChannelListItem, isArchived = false): { onChanged: ReturnType<typeof vi.fn>; onRemoved: ReturnType<typeof vi.fn> } {
  const onChanged = vi.fn();
  const onRemoved = vi.fn();
  render(
    <ToastProvider>
      <ChannelCard chatbotId="bot-1" item={item} isArchived={isArchived} onChanged={onChanged} onRemoved={onRemoved} />
    </ToastProvider>,
  );
  return { onChanged, onRemoved };
}

describe('ChannelCard — aria-disabled 동작(NFR-A3, AC-11-12) — WEB만 활성화 가능, 나머지는 준비 중 안내', () => {
  beforeEach(() => {
    mockUpsert.mockReset();
    mockRemove.mockReset();
  });

  it('WEB(IMPLEMENTED) 채널의 토글은 잠기지 않고 클릭하면 활성화 요청이 간다', async () => {
    mockUpsert.mockResolvedValue(makeWebItem({ enabled: true, configured: true }));
    renderCard(makeWebItem());
    const user = userEvent.setup();

    const toggle = screen.getByRole('switch', { name: /사용 안 함/ });
    expect(toggle).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(toggle);

    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith('bot-1', 'WEB', { enabled: true });
  });

  it('CONFIG_ONLY(KAKAOTALK) 채널의 토글은 aria-disabled이며 준비 중 사유가 함께 읽히고, 클릭해도 요청이 가지 않는다(AC-11-3/EX-11-1)', async () => {
    renderCard(makeKakaoItem());
    const user = userEvent.setup();

    const toggle = screen.getByRole('switch', { name: /사용 안 함/ });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');

    const reasonId = toggle.getAttribute('aria-describedby');
    expect(reasonId).toBeTruthy();
    const reasonEl = document.getElementById(reasonId as string);
    expect(reasonEl).toHaveTextContent('이 채널은 아직 연동을 제공하지 않습니다. 설정만 미리 저장할 수 있습니다.');

    // disabled가 아니라 aria-disabled이므로 포커스는 받을 수 있어야 한다(스크린리더가 사유에 도달 가능).
    toggle.focus();
    expect(toggle).toHaveFocus();

    await user.click(toggle);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('ARCHIVED 챗봇에서는 WEB 채널도 잠기고 보관 사유가 표시된다(FR-0-22)', () => {
    renderCard(makeWebItem({ configured: true }), true);
    const toggle = screen.getByRole('switch', { name: /사용 안 함/ });
    expect(toggle).toHaveAttribute('aria-disabled', 'true');
    const reasonId = toggle.getAttribute('aria-describedby') as string;
    expect(document.getElementById(reasonId)).toHaveTextContent('보관된 챗봇은 채널을 변경할 수 없습니다. 먼저 초안으로 복구하세요.');
  });

  it('서버가 409 CHANNEL_NOT_IMPLEMENTED를 반환하면(방어선 우회 시나리오) 오류 메시지가 토스트로 표시된다', async () => {
    mockUpsert.mockRejectedValue(new ApiError(409, '이 채널은 아직 연동을 제공하지 않습니다.', 'CHANNEL_NOT_IMPLEMENTED'));
    renderCard(makeWebItem());
    const user = userEvent.setup();

    await user.click(screen.getByRole('switch', { name: /사용 안 함/ }));

    expect(await screen.findByText('이 채널은 아직 연동을 제공하지 않습니다.')).toBeInTheDocument();
  });
});
