import { isLeaseExpired, secondsBetween } from '../../common/polling/lease';

/**
 * [신규 2026-09-23 No.28] tick 계획 순수 함수(§7.2, §7.5) — DB·Nest·시계 무의존. 도래 선정 ·
 * misfire · 재시도 창 · 임대 만료 · 앞선 HELD 판정을 챗봇당 **최대 1개**의 결정으로 만든다
 * (FR-D3-5 — 같은 챗봇 예약의 순서 보장).
 */

export interface DueScheduleRow {
  id: string;
  chatbotId: string;
  status: 'PENDING' | 'RUNNING';
  scheduledAt: Date;
  attemptCount: number;
  claimedAt: Date | null;
  claimToken: string | null;
}

export interface HeldScheduleRow {
  id: string;
  chatbotId: string;
  scheduledAt: Date;
}

export interface TickPlannerConfig {
  misfireGraceMs: number;
  pollIntervalMs: number;
  retryWindowMs: number;
  leaseMs: number;
}

export type TickDecision =
  | { kind: 'RECOVER'; id: string; claimToken: string }
  | { kind: 'SKIP'; id: string }
  | { kind: 'HOLD_BEHIND_HELD'; id: string; heldByScheduleId: string }
  | { kind: 'MISS'; id: string; delaySeconds: number }
  | { kind: 'EXPIRE_RETRY'; id: string }
  | { kind: 'EXECUTE'; id: string; expectAttemptCount: number };

/** §7.5 — "한 주기 지연"은 놓침이 아니다. 유예 0에서도 정상 가동 중 전부 MISSED가 되지 않게 한다. */
export function misfireTolerance(pollIntervalMs: number): number {
  return pollIntervalMs + 5_000;
}

export function planTick(rows: readonly DueScheduleRow[], heldBefore: readonly HeldScheduleRow[], now: Date, cfg: TickPlannerConfig): TickDecision[] {
  const byChatbot = new Map<string, DueScheduleRow[]>();
  for (const r of rows) {
    const list = byChatbot.get(r.chatbotId) ?? [];
    list.push(r);
    byChatbot.set(r.chatbotId, list);
  }

  const decisions: TickDecision[] = [];
  const tolerance = misfireTolerance(cfg.pollIntervalMs);

  for (const [chatbotId, group] of byChatbot) {
    const running = group.find((r) => r.status === 'RUNNING');
    if (running) {
      if (running.claimedAt && running.claimToken && isLeaseExpired(running.claimedAt, now, cfg.leaseMs)) {
        decisions.push({ kind: 'RECOVER', id: running.id, claimToken: running.claimToken });
      } else {
        decisions.push({ kind: 'SKIP', id: running.id });
      }
      continue;
    }

    const pendingSorted = group.filter((r) => r.status === 'PENDING').sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    if (pendingSorted.length === 0) continue;
    const p = pendingSorted[0];

    const heldBeforeP = heldBefore
      .filter((h) => h.chatbotId === chatbotId && h.scheduledAt.getTime() < p.scheduledAt.getTime())
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    if (heldBeforeP.length > 0) {
      decisions.push({ kind: 'HOLD_BEHIND_HELD', id: p.id, heldByScheduleId: heldBeforeP[0].id });
      continue;
    }

    const overdueMs = now.getTime() - p.scheduledAt.getTime();
    if (p.attemptCount === 0 && overdueMs > cfg.misfireGraceMs + tolerance) {
      decisions.push({ kind: 'MISS', id: p.id, delaySeconds: secondsBetween(p.scheduledAt, now) });
      continue;
    }
    if (p.attemptCount >= 1 && now.getTime() > p.scheduledAt.getTime() + cfg.retryWindowMs) {
      decisions.push({ kind: 'EXPIRE_RETRY', id: p.id });
      continue;
    }

    decisions.push({ kind: 'EXECUTE', id: p.id, expectAttemptCount: p.attemptCount });
  }

  return decisions;
}
