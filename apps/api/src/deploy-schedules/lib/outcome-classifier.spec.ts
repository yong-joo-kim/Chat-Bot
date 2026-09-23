import { ApiException } from '../../common/api.exception';
import { classifyExecutionError } from './outcome-classifier';

function apiError(code: string, status = 409) {
  return new ApiException(code as never, status, 'msg');
}

describe('classifyExecutionError(§7.6)', () => {
  it.each([
    ['RESTORE_BUSY', 'DB_BUSY'],
    ['RESTORE_BLOCKED_BY_ACTIVE_JOB', 'ACTIVE_JOB'],
    ['RESTORE_IN_PROGRESS', 'RESTORE_LOCKED'],
  ])('%s → TRANSIENT(%s)', (code, reason) => {
    expect(classifyExecutionError(apiError(code))).toEqual({ kind: 'TRANSIENT', reason });
  });

  it.each([
    ['RESTORE_PREVIEW_STALE', 'STATE_CHANGED'],
    ['NOT_FOUND', 'TARGET_VERSION_MISSING'],
    ['VERSION_INTEGRITY_FAILED', 'INTEGRITY_FAILED'],
    ['VERSION_SCHEMA_UNSUPPORTED', 'SCHEMA_UNSUPPORTED'],
    ['VERSION_SNAPSHOT_TOO_LARGE', 'BACKUP_TOO_LARGE'],
    ['CHATBOT_ARCHIVED', 'CHATBOT_ARCHIVED'],
    ['INVALID_STATUS_TRANSITION', 'INVALID_TRANSITION'],
    ['INTERNAL_ERROR', 'INTERNAL_ERROR'],
  ])('%s → PERMANENT(%s)', (code, reason) => {
    const result = classifyExecutionError(apiError(code, 422));
    expect(result.kind).toBe('PERMANENT');
    expect((result as { reason: string }).reason).toBe(reason);
  });

  it('원시 SQLITE_BUSY/database is locked(비-ApiException)는 TRANSIENT(DB_BUSY)다', () => {
    const busy = new Error('SQLITE_BUSY: database is locked');
    expect(classifyExecutionError(busy)).toEqual({ kind: 'TRANSIENT', reason: 'DB_BUSY' });
  });

  it('알 수 없는 코드는 PERMANENT(INTERNAL_ERROR)다(분류 불가 예외 포함)', () => {
    expect(classifyExecutionError(apiError('SOME_UNKNOWN_CODE', 400)).kind).toBe('PERMANENT');
    expect(classifyExecutionError(new Error('boom'))).toEqual({ kind: 'PERMANENT', reason: 'INTERNAL_ERROR' });
    expect(classifyExecutionError('not an error')).toEqual({ kind: 'PERMANENT', reason: 'INTERNAL_ERROR' });
  });
});
