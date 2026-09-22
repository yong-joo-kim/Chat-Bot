import { AUDIT_LIMITS } from '@chat-bot/shared-types';

export interface ResolvedAuditRange {
  from: Date;
  to: Date;
  defaulted: boolean;
}

export class AuditRangeTooWideError extends Error {}
export class InvalidAuditRangeError extends Error {}

/**
 * 조회 기간 기본값·상한 판정(FR-13-17, NFR-M1). 기본 30일, 상한은 환경변수
 * (`AUDIT_QUERY_MAX_RANGE_DAYS`, 기본 90)로 서비스가 넘겨준다. UTC 기준으로 판정하고
 * 화면 표시만 Asia/Seoul이다(개발명세서 §4.1).
 */
export function resolveAuditRange(from: Date | undefined, to: Date | undefined, maxDays: number, now: Date = new Date()): ResolvedAuditRange {
  const resolvedTo = to ?? now;
  const resolvedFrom = from ?? new Date(resolvedTo.getTime() - AUDIT_LIMITS.defaultRangeDays * 86_400_000);

  if (resolvedFrom.getTime() > resolvedTo.getTime()) {
    throw new InvalidAuditRangeError('조회 시작일이 종료일보다 늦을 수 없습니다.');
  }

  const rangeDays = (resolvedTo.getTime() - resolvedFrom.getTime()) / 86_400_000;
  if (rangeDays > maxDays) {
    throw new AuditRangeTooWideError(`조회 기간은 최대 ${maxDays}일까지 지정할 수 있습니다.`);
  }

  return { from: resolvedFrom, to: resolvedTo, defaulted: from === undefined };
}
