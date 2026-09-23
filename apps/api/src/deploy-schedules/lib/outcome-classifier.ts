import type { DeployScheduleFailureReason, DeployScheduleTransientReason } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import { isBusyError } from '../../common/prisma/busy-error';

export type ClassifiedError = { kind: 'TRANSIENT'; reason: DeployScheduleTransientReason } | { kind: 'PERMANENT'; reason: DeployScheduleFailureReason; detailCode?: string };

/**
 * [신규 2026-09-23 No.28] 실행 오류 분류표 단일 소스(§7.6, J-7). 실행기(`executors/*.executor.ts`)의
 * catch 블록에서 이 함수 1개만 호출한다 — NOOP(성공 반환값)과 misfire/재시도창 만료는 이 함수의
 * 책임이 아니다(planner·finalize의 몫). 분류는 `ApiException.code` **문자열**로 한다(메시지 파싱 금지).
 */
export function classifyExecutionError(e: unknown): ClassifiedError {
  if (e instanceof ApiException) {
    const body = e.getResponse() as { code?: string };
    switch (body.code) {
      case 'RESTORE_BUSY':
        return { kind: 'TRANSIENT', reason: 'DB_BUSY' };
      case 'RESTORE_BLOCKED_BY_ACTIVE_JOB':
        return { kind: 'TRANSIENT', reason: 'ACTIVE_JOB' };
      case 'RESTORE_IN_PROGRESS':
        return { kind: 'TRANSIENT', reason: 'RESTORE_LOCKED' };
      case 'RESTORE_PREVIEW_STALE':
        return { kind: 'PERMANENT', reason: 'STATE_CHANGED' };
      case 'NOT_FOUND':
        return { kind: 'PERMANENT', reason: 'TARGET_VERSION_MISSING' };
      case 'VERSION_INTEGRITY_FAILED':
        return { kind: 'PERMANENT', reason: 'INTEGRITY_FAILED' };
      case 'VERSION_SCHEMA_UNSUPPORTED':
        return { kind: 'PERMANENT', reason: 'SCHEMA_UNSUPPORTED' };
      case 'VERSION_SNAPSHOT_TOO_LARGE':
        return { kind: 'PERMANENT', reason: 'BACKUP_TOO_LARGE' };
      case 'CHATBOT_ARCHIVED':
        return { kind: 'PERMANENT', reason: 'CHATBOT_ARCHIVED' };
      case 'INVALID_STATUS_TRANSITION':
        return { kind: 'PERMANENT', reason: 'INVALID_TRANSITION' };
      case 'INTERNAL_ERROR':
        return { kind: 'PERMANENT', reason: 'INTERNAL_ERROR', detailCode: body.code };
      default:
        return { kind: 'PERMANENT', reason: 'INTERNAL_ERROR', detailCode: body.code };
    }
  }
  if (isBusyError(e)) return { kind: 'TRANSIENT', reason: 'DB_BUSY' };
  // 분류 불가 예외 — at-most-once 우선, 모르는 오류를 반복하지 않는다.
  return { kind: 'PERMANENT', reason: 'INTERNAL_ERROR' };
}
