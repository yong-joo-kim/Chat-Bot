import type { RetentionTargetKind } from '@chat-bot/shared-types';
import { CONVERSATION_RETENTION_KINDS } from '@chat-bot/shared-types';
import { KST_OFFSET_MINUTES } from '@chat-bot/shared-types';

/**
 * ★ 보존 정책 순수 함수(No.45, `data-governance-설계.md` §8.2) — 시각·행 주입. DB·Nest 무의존.
 */

export type RetentionDaysMap = Partial<Record<RetentionTargetKind, number | null>>;
/** 챗봇 재정의 저장값 — 'GLOBAL'은 "전역 따름"(키 제거와 동치인 명시값). */
export type ChatbotRetentionDaysMap = Partial<Record<RetentionTargetKind, number | null | 'GLOBAL'>>;
export interface RetentionPendingEntry {
  days: number | null | 'GLOBAL';
  effectiveAt: string; // ISO
}
export type RetentionPendingMap = Partial<Record<RetentionTargetKind, RetentionPendingEntry>>;

export interface RetentionBounds {
  minConversationDays: number;
  minAuditDays: number;
  maxDays: number;
  shortenGraceDays: number;
}

function minFor(kind: RetentionTargetKind, bounds: RetentionBounds): number {
  return kind === 'AUDIT_LOGS' ? bounds.minAuditDays : bounds.minConversationDays;
}

/** 전역 값 = (도래한 pending ? pending.days : days[kind]) — 키 없음 = 무기한(null). */
export function resolveGlobalStoredDays(kind: RetentionTargetKind, days: RetentionDaysMap, pending: RetentionPendingMap, now: Date): number | null {
  const p = pending[kind];
  if (p && new Date(p.effectiveAt).getTime() <= now.getTime()) {
    return p.days === 'GLOBAL' ? null : p.days;
  }
  return days[kind] ?? null;
}

/** 챗봇 값 = 같은 규칙 — 'GLOBAL'/키 없음이면 전역 값을 따른다. */
export function resolveChatbotStoredDays(
  kind: RetentionTargetKind,
  chatbotDays: ChatbotRetentionDaysMap,
  chatbotPending: RetentionPendingMap,
  globalResolved: number | null,
  now: Date,
): number | null {
  const p = chatbotPending[kind];
  if (p && new Date(p.effectiveAt).getTime() <= now.getTime()) {
    return p.days === 'GLOBAL' ? globalResolved : p.days;
  }
  const stored = chatbotDays[kind];
  if (stored === undefined || stored === 'GLOBAL') return globalResolved;
  return stored;
}

/**
 * 최종 유효 일수 — 전역 + (대화 원천 4종만) 챗봇 재정의 + 서버 하한 클램프(실행 시).
 * `null` = 무기한(클램프 대상 아님).
 */
export function resolveEffectiveDays(
  kind: RetentionTargetKind,
  globalDays: RetentionDaysMap,
  globalPending: RetentionPendingMap,
  chatbotDays: ChatbotRetentionDaysMap | null,
  chatbotPending: RetentionPendingMap | null,
  now: Date,
  bounds: RetentionBounds,
): number | null {
  const globalResolved = resolveGlobalStoredDays(kind, globalDays, globalPending, now);
  const isChatbotOverridable = (CONVERSATION_RETENTION_KINDS as readonly string[]).includes(kind);
  const stored =
    isChatbotOverridable && chatbotDays
      ? resolveChatbotStoredDays(kind, chatbotDays, chatbotPending ?? {}, globalResolved, now)
      : globalResolved;
  if (stored === null) return null;
  return Math.max(stored, minFor(kind, bounds));
}

/** cutoff = KST 자정(now) − days × 24h(UTC 순간). 같은 날 몇 번 돌아도 기준이 같다. */
export function computeCutoff(days: number, now: Date): Date {
  const kstNow = new Date(now.getTime() + KST_OFFSET_MINUTES * 60_000);
  const y = kstNow.getUTCFullYear();
  const m = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  const kstMidnightUtcMs = Date.UTC(y, m, d) - KST_OFFSET_MINUTES * 60_000;
  return new Date(kstMidnightUtcMs - days * 86_400_000);
}

export type ShortenJudgement = { shortening: true; effectiveAt: Date } | { shortening: false };

/** 단축 판정(무기한 → 유한 포함) — 유예 이후 시각을 함께 계산한다. */
export function judgeShorten(currentEffectiveDays: number | null, newDays: number | null, now: Date, graceDays: number): ShortenJudgement {
  const isShorten = newDays !== null && (currentEffectiveDays === null || newDays < currentEffectiveDays);
  if (!isShorten) return { shortening: false };
  return { shortening: true, effectiveAt: new Date(now.getTime() + graceDays * 86_400_000) };
}

/** 범위 검사(하한·상한). 위반이면 실패 사유 문자열을 반환, 통과면 null. */
export function validateRange(kind: RetentionTargetKind, days: number | null, bounds: RetentionBounds): string | null {
  if (days === null) return null;
  const min = minFor(kind, bounds);
  if (days < min) return `${kind}은(는) 최소 ${min}일 이상이어야 합니다.`;
  if (days > bounds.maxDays) return `${kind}은(는) 최대 ${bounds.maxDays}일까지 설정할 수 있습니다.`;
  return null;
}
