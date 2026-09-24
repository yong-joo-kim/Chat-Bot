import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { HandoffSettings } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { HandoffSettingsSection } from './HandoffSettingsSection';
import { handoffApi } from '../../../api/handoff';

expect.extend(toHaveNoViolations);

vi.mock('../../../api/handoff', () => ({ handoffApi: { getSettings: vi.fn(), updateSettings: vi.fn() } }));
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

const SETTINGS: HandoffSettings = {
  chatbotId: 'bot-1',
  enabled: false,
  draining: false,
  cautionThreshold: 2,
  warningThreshold: 3,
  activeWindowMinutes: 10,
  userIdleMinutes: 10,
  agentNoReplyMinutes: 5,
  connectNotice: '상담원이 연결되었어요. 잠시만 기다려 주세요.',
  endNotice: '상담이 종료되었어요. 이제 챗봇이 도와드릴게요.',
  failNotice: '지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요.',
  endButtonLabel: null,
  endButtonNodeId: null,
  createdAt: new Date('2026-09-20T00:00:00.000Z'),
  updatedAt: new Date('2026-09-20T00:00:00.000Z'),
};

/** M2(코드 리뷰 1회차) — HS1(상담 연계 설정 섹션) axe 접근성 스캔. */
describe('HandoffSettingsSection — axe 접근성 스캔', () => {
  it('설정 섹션에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.getSettings).mockResolvedValue(SETTINGS);
    const { container } = render(
      <ToastProvider>
        <MemoryRouter>
          <HandoffSettingsSection chatbotId="bot-1" isArchived={false} />
        </MemoryRouter>
      </ToastProvider>,
    );
    await screen.findByText('상담 연계');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
