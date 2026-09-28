import { judgeIngestResultText } from './judge-ingest-result-text';
import type { KbIngestResultCode } from '@chat-bot/shared-types';

/**
 * [신규 No.43] `GET /api/async_task_status/{id}` 응답 판정(순수 함수 — §5.6 · `API_RAG.md` 472~528행).
 * `task_info.status`로 완료 여부를, `task_info.result`로 성패를 판정한다(`completed`인데 실패 문자열인
 * 경우를 놓치지 않는다). `task_info.error` 원문은 반환값에 담지 않는다(로그·저장 0 — KB-15).
 * `retryAfterMs`(항목⑤)는 429 응답의 `Retry-After` 해석값 — 다음 조회 간격의 하한으로 쓴다.
 */
export interface RagTaskStatusRawResult {
  networkError: boolean;
  httpStatus?: number;
  body?: unknown;
  retryAfterMs?: number | null;
}

/**
 * `POLL_AGAIN` — 작업 조회 **자체**가 일시적으로 실패한 경우(네트워크 오류·5xx·429). 외부 작업의 성패에
 * 대한 정보가 없으므로 작업 상태를 바꾸지 않고 다시 조회만 한다(§5.6 · §5.8 — 재전송은 `not_found`뿐이다).
 * 이 응답을 "제출 실패"처럼 재시도(재전송) 경로에 태우면 이미 접수돼 진행 중인 작업이 중복 적재된다.
 * `rateLimited`면 다음 조회를 `KB_INGEST_POLL_MS × 2`로 미룬다.
 */
export type ParsedTaskStatus =
  | { outcome: 'PENDING' }
  | { outcome: 'SUCCEEDED' }
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'POLL_AGAIN'; rateLimited: boolean; retryAfterMs: number | null }
  | { outcome: 'RESULT_CODE'; resultCode: KbIngestResultCode; retryAfterMs: number | null };

export function parseTaskStatus(result: RagTaskStatusRawResult): ParsedTaskStatus {
  if (result.networkError) return { outcome: 'POLL_AGAIN', rateLimited: false, retryAfterMs: null };

  const status = result.httpStatus ?? 0;
  const retryAfterMs = result.retryAfterMs ?? null;
  if (status === 429) return { outcome: 'POLL_AGAIN', rateLimited: true, retryAfterMs };
  if (status >= 500) return { outcome: 'POLL_AGAIN', rateLimited: false, retryAfterMs: null };
  if (status < 200 || status >= 300) return { outcome: 'RESULT_CODE', resultCode: 'UPSTREAM_ERROR', retryAfterMs: null };

  const body = (result.body ?? {}) as Record<string, unknown>;
  const taskInfo = (body.task_info ?? {}) as Record<string, unknown>;
  const taskStatus = taskInfo.status;

  if (taskStatus === 'running' || taskStatus === 'cancelling') return { outcome: 'PENDING' };
  if (taskStatus === 'not_found') return { outcome: 'NOT_FOUND' };
  if (taskStatus === 'cancelled') return { outcome: 'RESULT_CODE', resultCode: 'TASK_CANCELLED', retryAfterMs: null };
  if (taskStatus === 'failed') return { outcome: 'RESULT_CODE', resultCode: 'TASK_FAILED', retryAfterMs: null };
  if (taskStatus === 'completed') {
    const judged = judgeIngestResultText(taskInfo.result);
    if (judged === 'SUCCESS') return { outcome: 'SUCCEEDED' };
    if (judged === 'FAILURE') return { outcome: 'RESULT_CODE', resultCode: 'RAG_REPORTED_FAILURE', retryAfterMs: null };
    return { outcome: 'RESULT_CODE', resultCode: 'UPSTREAM_ERROR', retryAfterMs: null };
  }
  return { outcome: 'RESULT_CODE', resultCode: 'UPSTREAM_ERROR', retryAfterMs: null };
}
