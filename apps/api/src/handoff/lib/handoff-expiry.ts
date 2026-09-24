import type { HandoffEndReason, HandoffStatus } from '@chat-bot/shared-types';

export interface HandoffExpiryRow {
  status: HandoffStatus;
  startedAt: Date;
  connectedAt: Date | null;
  lastUserMessageAt: Date | null;
  lastAgentMessageAt: Date | null;
  firstAgentReplyAt: Date | null;
}

export interface HandoffExpirySettings {
  userIdleMinutes: number;
  agentNoReplyMinutes: number;
}

/**
 * 시간 기반 종료 판정(순수 함수, P-14, §8.4). 콘솔·공개 요청·정리 루프가 모두 이 함수를 호출한다
 * (같은 판정 1벌 — ADR-0036 §5). 우선순위 ① 채널 닫힘 ② 상담원 무응답(첫 응답 전) ③ 미전달(연결 전
 * 사용자 무응답) ④ 양쪽 무응답(연결 후).
 *
 * ④는 "양쪽 모두 `userIdleMinutes`간 침묵"이다(D-9) — 사용자 발화 뒤 상담원이 응답하지 않아도,
 * 상담원 발화 뒤 사용자가 응답하지 않아도 끝난다. 라벨은 "응답 없음으로 종료"로 고정한다.
 */
export function judgeHandoffExpiry(row: HandoffExpiryRow, settings: HandoffExpirySettings, channelOpen: boolean, now: Date): HandoffEndReason | null {
  if (row.status === 'ENDED') return null;
  if (!channelOpen) return 'CHANNEL_CLOSED';

  const agentNoReplyMs = settings.agentNoReplyMinutes * 60_000;
  const userIdleMs = settings.userIdleMinutes * 60_000;
  const nowMs = now.getTime();

  if (row.firstAgentReplyAt === null && nowMs - row.startedAt.getTime() >= agentNoReplyMs) {
    return 'AGENT_NO_REPLY';
  }
  if (row.status === 'CONNECTING' && nowMs - row.startedAt.getTime() >= userIdleMs) {
    return 'NOT_DELIVERED';
  }
  if (row.status === 'CONNECTED') {
    const lastActivityMs = Math.max(row.connectedAt?.getTime() ?? 0, row.lastUserMessageAt?.getTime() ?? 0, row.lastAgentMessageAt?.getTime() ?? 0);
    if (nowMs - lastActivityMs >= userIdleMs) return 'USER_IDLE';
  }

  return null;
}
