import type { TimelineUnit } from '@chat-bot/shared-types';

/**
 * [신규 No.42] 타임라인 병합·커서(§9.2 — 순수). 두 원천(대화 단위·항목 단위)을 시각 역순으로
 * 병합해 페이지 크기만큼 자르고, 다음 커서(마지막 단위 시각의 ISO 문자열)를 계산한다.
 */
export function assembleTimeline(units: TimelineUnit[], pageSize: number): { units: TimelineUnit[]; nextCursor: string | null } {
  const sorted = [...units].sort((a, b) => b.at.getTime() - a.at.getTime());
  const page = sorted.slice(0, pageSize);
  const nextCursor = page.length === pageSize && page.length > 0 ? page[page.length - 1].at.toISOString() : null;
  return { units: page, nextCursor };
}
