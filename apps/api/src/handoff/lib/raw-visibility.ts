import type { HandoffStatus, Permission, RoleName } from '@chat-bot/shared-types';

export interface RawVisibilityHandoff {
  status: HandoffStatus;
  assignedUserId: string;
}

export interface RawVisibilityViewer {
  id: string;
  role: RoleName;
  permissions: readonly Permission[];
}

/**
 * 원문 열람 판정(순수 함수, §9.3) — 담당 상담원·ADMIN · `cs:write` · 상담 중(`CONNECTED`) ·
 * 명시 요청(`includeRaw`)일 때만 참이다. 이 판정을 통과한 요청만 응답에 `rawText`를 싣고
 * `RAW_VIEW` 감사를 남긴다.
 */
export function canViewRaw(handoff: RawVisibilityHandoff, viewer: RawVisibilityViewer, includeRaw: boolean): boolean {
  if (!includeRaw) return false;
  if (handoff.status !== 'CONNECTED') return false;
  if (!viewer.permissions.includes('cs:write')) return false;
  return handoff.assignedUserId === viewer.id || viewer.role === 'ADMIN';
}
