import { parseTaskStatus } from './parse-task-status';

describe('parseTaskStatus — API_RAG.md 472~528행 응답 예시 픽스처', () => {
  it('running → PENDING', () => {
    const result = parseTaskStatus({ networkError: false, httpStatus: 200, body: { status: 'success', task_id: 't', task_info: { status: 'running', start_time: 1, progress: 0 } } });
    expect(result).toEqual({ outcome: 'PENDING' });
  });

  it('cancelling → PENDING(짧은 중간 상태 — running과 동일 취급)', () => {
    const result = parseTaskStatus({ networkError: false, httpStatus: 200, body: { task_info: { status: 'cancelling' } } });
    expect(result).toEqual({ outcome: 'PENDING' });
  });

  it('completed + "...성공." → SUCCEEDED', () => {
    const result = parseTaskStatus({ networkError: false, httpStatus: 200, body: { task_info: { status: 'completed', result: 'RAG Vector DB 추가 성공.', end_time: 2 } } });
    expect(result).toEqual({ outcome: 'SUCCEEDED' });
  });

  it('★ completed인데 "...실패." → RAG_REPORTED_FAILURE(재시도)', () => {
    const result = parseTaskStatus({ networkError: false, httpStatus: 200, body: { task_info: { status: 'completed', result: 'RAG Vector DB 추가 실패.' } } });
    expect(result).toEqual({ outcome: 'RESULT_CODE', resultCode: 'RAG_REPORTED_FAILURE', retryAfterMs: null });
  });

  it('failed → TASK_FAILED(error 원문은 반환값에 없음)', () => {
    const result = parseTaskStatus({ networkError: false, httpStatus: 200, body: { task_info: { status: 'failed', error: '민감한 스택 트레이스' } } });
    expect(result).toEqual({ outcome: 'RESULT_CODE', resultCode: 'TASK_FAILED', retryAfterMs: null });
    expect(JSON.stringify(result)).not.toContain('스택');
  });

  it('cancelled → TASK_CANCELLED', () => {
    expect(parseTaskStatus({ networkError: false, httpStatus: 200, body: { task_info: { status: 'cancelled' } } })).toEqual({
      outcome: 'RESULT_CODE',
      resultCode: 'TASK_CANCELLED',
      retryAfterMs: null,
    });
  });

  it('★ not_found(재시작) → NOT_FOUND — 실패가 아니라 재전송 신호', () => {
    expect(parseTaskStatus({ networkError: false, httpStatus: 200, body: { status: 'success', task_id: 'x', task_info: { status: 'not_found' } } })).toEqual({ outcome: 'NOT_FOUND' });
  });

  it('429 → POLL_AGAIN(rateLimited — 작업 상태는 그대로 두고 다음 조회만 미룬다 · Retry-After 있으면 함께 돌려준다)', () => {
    expect(parseTaskStatus({ networkError: false, httpStatus: 429, body: {} })).toEqual({ outcome: 'POLL_AGAIN', rateLimited: true, retryAfterMs: null });
    expect(parseTaskStatus({ networkError: false, httpStatus: 429, body: {}, retryAfterMs: 7_000 })).toEqual({ outcome: 'POLL_AGAIN', rateLimited: true, retryAfterMs: 7_000 });
  });

  it('★ 5xx(500·502·503) → POLL_AGAIN — 재전송이 아니라 재조회다(설계 §5.6: 재전송은 not_found뿐)', () => {
    for (const httpStatus of [500, 502, 503, 504]) {
      expect(parseTaskStatus({ networkError: false, httpStatus, body: { error: '서버 오류 원문' } })).toEqual({ outcome: 'POLL_AGAIN', rateLimited: false, retryAfterMs: null });
    }
  });

  it('네트워크 오류 → POLL_AGAIN(작업의 성패를 알 수 없으므로 재조회)', () => {
    expect(parseTaskStatus({ networkError: true })).toEqual({ outcome: 'POLL_AGAIN', rateLimited: false, retryAfterMs: null });
  });

  it('그 밖의 비 2xx(4xx) → UPSTREAM_ERROR(재시도 경로 — 무한 재조회로 가리지 않는다)', () => {
    expect(parseTaskStatus({ networkError: false, httpStatus: 404, body: {} })).toEqual({ outcome: 'RESULT_CODE', resultCode: 'UPSTREAM_ERROR', retryAfterMs: null });
  });

  it('completed인데 성공·실패 접미가 모두 아닌 문자열 → UPSTREAM_ERROR', () => {
    expect(parseTaskStatus({ networkError: false, httpStatus: 200, body: { task_info: { status: 'completed', result: '알 수 없는 결과' } } })).toEqual({
      outcome: 'RESULT_CODE',
      resultCode: 'UPSTREAM_ERROR',
      retryAfterMs: null,
    });
  });
});
