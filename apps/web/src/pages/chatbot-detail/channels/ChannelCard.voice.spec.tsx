import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChannelListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ChannelCard } from './ChannelCard';

vi.mock('../../../api/channels', () => ({ channelsApi: { upsert: vi.fn(), remove: vi.fn(), list: vi.fn() } }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: () => ({ can: () => true }) }));

const mockGetOverview = vi.fn();
vi.mock('../../../api/voice', () => ({
  voiceApi: {
    getOverview: (...a: unknown[]) => mockGetOverview(...a),
    saveSettings: vi.fn(),
    getStats: vi.fn().mockResolvedValue({ from: '2026-09-25', to: '2026-10-01', totals: { requested: 0, ok: 0, empty: 0, invalid: 0, failed: 0, busy: 0 }, daily: [] }),
  },
}));
vi.mock('../../../api/proactive', () => ({ proactiveApi: { getOverview: vi.fn().mockReturnValue(new Promise(() => undefined)) } }));
vi.mock('../../../api/chatbots', () => ({ chatbotsApi: { embedCode: vi.fn().mockResolvedValue({ publicUrl: '', pc: '', mobile: '' }) } }));
vi.mock('../../../api/dialogue', () => ({ dialogNodesApi: { findOne: vi.fn(), list: vi.fn().mockResolvedValue({ items: [] }) } }));

function item(type: 'WEB' | 'KAKAOTALK'): ChannelListItem {
  return type === 'WEB'
    ? ({ type: 'WEB', label: '웹', implementation: 'IMPLEMENTED', configured: true, enabled: true, config: { allowedOrigins: [], quickReplies: [], launcherPosition: 'RIGHT', showLauncher: true }, updatedAt: null } as ChannelListItem)
    : ({ type: 'KAKAOTALK', label: '카카오톡', implementation: 'CONFIG_ONLY', configured: false, enabled: false, config: {}, updatedAt: null } as ChannelListItem);
}

function renderCard(i: ChannelListItem): void {
  render(
    <ToastProvider>
      <ChannelCard chatbotId="bot-1" item={i} isArchived={false} onChanged={vi.fn()} onRemoved={vi.fn()} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockGetOverview.mockReset().mockResolvedValue({
    settings: { inputEnabled: true, ttsEnabled: false, autoReadToggleVisible: true, rateMultiplier: 1, defaultTone: 'CALM', toneByKind: {}, nodeTones: [], updatedAt: null },
    server: { enabled: true, provider: 'local', inputAvailable: true },
    context: { webChannelEnabled: true, chatbotStatus: 'ACTIVE' },
    limits: { nodeTonesMax: 200 },
  });
});

/** VO-C1 — WEB 카드의 "음성" 진입점(새 라우트·새 탭 0). */
describe('ChannelCard — 음성 진입점(No.32)', () => {
  it('WEB 카드에만 "음성" 버튼이 있다(다른 채널 카드에는 없다)', () => {
    renderCard(item('KAKAOTALK'));
    expect(screen.queryByRole('button', { name: '음성' })).toBeNull();
  });

  it('펼치기 전에는 서버 호출·요약 배지가 없고, 펼치면 1회 조회 후 요약 배지(글자)가 보이며 aria-expanded가 바뀐다', async () => {
    renderCard(item('WEB'));
    const button = screen.getByRole('button', { name: '음성' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(mockGetOverview).not.toHaveBeenCalled();
    expect(screen.queryByText(/입력 켜짐|입력 꺼짐/)).toBeNull();
    await userEvent.click(button);
    expect(await screen.findByRole('switch', { name: '음성 입력 사용' })).toBeInTheDocument();
    expect(mockGetOverview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '음성 닫기' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('입력 켜짐')).toBeInTheDocument();
    // 닫으면 섹션이 사라지고 요약 배지는 남는다
    await userEvent.click(screen.getByRole('button', { name: '음성 닫기' }));
    expect(screen.queryByRole('switch', { name: '음성 입력 사용' })).toBeNull();
    expect(screen.getByText('입력 켜짐')).toBeInTheDocument();
  });

  it('"설정 열기"·"선제 안내"와 독립적으로 동시에 펼칠 수 있다', async () => {
    renderCard(item('WEB'));
    await userEvent.click(screen.getByRole('button', { name: '설정 열기' }));
    await userEvent.click(screen.getByRole('button', { name: '선제 안내' }));
    await userEvent.click(screen.getByRole('button', { name: '음성' }));
    expect(screen.getByRole('button', { name: '설정 닫기' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '선제 안내 닫기' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '음성 닫기' })).toHaveAttribute('aria-expanded', 'true');
  });
});
