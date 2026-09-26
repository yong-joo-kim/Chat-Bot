import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { HandoffHistoryDetailResponse } from '@chat-bot/shared-types';
import { HandoffHistoryDetailPage } from './HandoffHistoryDetailPage';
import { handoffApi } from '../../api/handoff';

expect.extend(toHaveNoViolations);

vi.mock('../../api/handoff', () => ({ handoffApi: { historyDetail: vi.fn() } }));
// [신규 No.42] OI-10 — 상담 이력 상세도 `SessionLinkCard`를 렌더한다(2026-09-26 계약 보강, `handoff.sessionRef`).
vi.mock('../../api/inbox', () => ({ inboxApi: { sessionLink: vi.fn().mockResolvedValue({ participating: false }) } }));
vi.mock('./HandoffConsoleChatbotShell', () => ({
  useHandoffConsoleChatbotContext: () => ({ chatbotId: 'bot-1', chatbotName: '쇼핑몰 도우미' }),
}));
// [신규 No.45] G7 배너가 `useAuth().user.governanceModeOn`을 읽는다(data-governance-ui-spec.md §3.10).
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: '박관리', role: 'ADMIN', governanceModeOn: false }, can: () => true }),
}));

const DETAIL: HandoffHistoryDetailResponse = {
  handoff: {
    id: 'h1',
    alias: 'a1b2c3',
    sessionRef: 'a'.repeat(16),
    startedAt: new Date('2026-09-24T01:00:00.000Z'),
    connectedAt: new Date('2026-09-24T01:00:05.000Z'),
    endedAt: new Date('2026-09-24T01:10:00.000Z'),
    assignedUserName: '김상담',
    endReason: 'AGENT_ENDED',
    userMessageCount: 4,
    agentMessageCount: 5,
    firstResponseSec: 42,
    alertLevelAtStart: 'WARNING',
    clientMode: 'MODERN',
  },
  entries: [
    {
      kind: 'HANDOFF',
      messageId: 'm1',
      handoffId: 'h1',
      seq: 1,
      at: new Date('2026-09-24T01:00:10.000Z'),
      sender: 'AGENT',
      text: '네, 확인했습니다',
      senderName: '김상담',
    },
  ],
};

/** M2(코드 리뷰 1회차) — HC4 axe 접근성 스캔. */
describe('HandoffHistoryDetailPage — axe 접근성 스캔', () => {
  it('상담 이력 상세 화면에 구조적 접근성 위반이 없다', async () => {
    vi.mocked(handoffApi.historyDetail).mockResolvedValue(DETAIL);
    const { container } = render(
      <MemoryRouter initialEntries={['/handoff-console/bot-1/history/h1']}>
        <Routes>
          <Route path="/handoff-console/:chatbotId/history/:handoffId" element={<HandoffHistoryDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('네, 확인했습니다');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
