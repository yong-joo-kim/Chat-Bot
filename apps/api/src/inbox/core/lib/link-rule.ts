import type { CustomerLinkSource } from '@chat-bot/shared-types';

export interface ExistingLink {
  customerId: string;
  source: CustomerLinkSource;
}

export type ManualLinkDecision =
  | { action: 'CREATE' }
  | { action: 'NOOP' }
  | { action: 'REASSIGN' }
  | { action: 'LOCKED' };

/** [신규 No.42] 수동 연결 결정(§7.2 — 순수). */
export function decideManualLink(existing: ExistingLink | null, targetCustomerId: string): ManualLinkDecision {
  if (!existing) return { action: 'CREATE' };
  if (existing.customerId === targetCustomerId) return { action: 'NOOP' };
  if (existing.source === 'IDENTITY') return { action: 'LOCKED' };
  return { action: 'REASSIGN' };
}

export type UnlinkDecision = { action: 'REVERT' } | { action: 'DELETE' } | { action: 'ADMIN_ONLY' };

/** [신규 No.42] 분리 결정(§7.2·§7.3 — 순수). `IDENTITY`는 ADMIN 재검증이 필요하다(호출부가 수행). */
export function decideUnlink(existing: ExistingLink): UnlinkDecision {
  if (existing.source === 'IDENTITY') return { action: 'ADMIN_ONLY' };
  if (existing.source === 'MANUAL') return { action: 'REVERT' };
  return { action: 'DELETE' };
}
