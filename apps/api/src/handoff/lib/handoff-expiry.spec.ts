import { judgeHandoffExpiry } from './handoff-expiry';
import type { HandoffExpiryRow } from './handoff-expiry';

const SETTINGS = { userIdleMinutes: 10, agentNoReplyMinutes: 5 };

function row(overrides: Partial<HandoffExpiryRow> = {}): HandoffExpiryRow {
  return {
    status: 'CONNECTED',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    connectedAt: new Date('2026-01-01T00:00:00Z'),
    lastUserMessageAt: null,
    lastAgentMessageAt: null,
    firstAgentReplyAt: new Date('2026-01-01T00:00:01Z'),
    ...overrides,
  };
}

describe('judgeHandoffExpiry — P-14·§8.4', () => {
  it('이미 종료된 상담은 null이다', () => {
    expect(judgeHandoffExpiry(row({ status: 'ENDED' }), SETTINGS, true, new Date())).toBeNull();
  });

  it('채널이 닫혀 있으면 CHANNEL_CLOSED가 최우선이다', () => {
    const now = new Date('2026-01-01T00:00:05Z');
    expect(judgeHandoffExpiry(row(), SETTINGS, false, now)).toBe('CHANNEL_CLOSED');
  });

  it('첫 응답 전 상담원 무응답 5분 경과 → AGENT_NO_REPLY', () => {
    const now = new Date('2026-01-01T00:05:00Z');
    expect(judgeHandoffExpiry(row({ firstAgentReplyAt: null }), SETTINGS, true, now)).toBe('AGENT_NO_REPLY');
  });

  it('4분 59초는 아직 AGENT_NO_REPLY가 아니다(경계값)', () => {
    const now = new Date('2026-01-01T00:04:59Z');
    expect(judgeHandoffExpiry(row({ firstAgentReplyAt: null }), SETTINGS, true, now)).toBeNull();
  });

  it('CONNECTING 상태에서 사용자 무응답 10분 → NOT_DELIVERED', () => {
    const now = new Date('2026-01-01T00:10:00Z');
    const r = row({ status: 'CONNECTING', connectedAt: null, firstAgentReplyAt: new Date('2026-01-01T00:00:01Z') });
    expect(judgeHandoffExpiry(r, SETTINGS, true, now)).toBe('NOT_DELIVERED');
  });

  it('CONNECTED 상태에서 양쪽 모두 10분 침묵 → USER_IDLE', () => {
    const now = new Date('2026-01-01T00:10:00Z');
    expect(judgeHandoffExpiry(row(), SETTINGS, true, now)).toBe('USER_IDLE');
  });

  it('9:59는 아직 USER_IDLE이 아니다(경계값)', () => {
    const now = new Date('2026-01-01T00:09:59Z');
    expect(judgeHandoffExpiry(row(), SETTINGS, true, now)).toBeNull();
  });

  it('상담원이 방금 답했지만 사용자가 10분간 답하지 않아도 USER_IDLE이다(D-9 — 양쪽 침묵)', () => {
    const now = new Date('2026-01-01T00:15:00Z');
    const r = row({ lastAgentMessageAt: new Date('2026-01-01T00:04:00Z') });
    expect(judgeHandoffExpiry(r, SETTINGS, true, now)).toBe('USER_IDLE');
  });

  it('사용자가 최근에 말했으면 USER_IDLE이 아니다', () => {
    const now = new Date('2026-01-01T00:10:00Z');
    const r = row({ lastUserMessageAt: new Date('2026-01-01T00:09:00Z') });
    expect(judgeHandoffExpiry(r, SETTINGS, true, now)).toBeNull();
  });
});
