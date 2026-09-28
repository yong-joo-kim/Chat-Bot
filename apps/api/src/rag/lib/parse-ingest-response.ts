import { toRagTaskId } from './rag-task-id';
import type { RagTaskId } from './rag-task-id';
import { judgeIngestResultText } from './judge-ingest-result-text';
import type { KbIngestResultCode } from '@chat-bot/shared-types';

/**
 * [신규 No.43] `POST /api/documents/ingest` 응답 판정(순수 함수 — §5.6 · `API_RAG.md` 245~285행).
 * 입력은 `RagHttpClient.ingest()`가 돌려주는 `RagSendResult` 형태(네트워크 오류·HTTP 상태·본문).
 * `retryAfterMs`(항목⑤)는 429·503 응답의 `Retry-After` 해석값 — 있으면 고정 백오프보다 우선한다.
 */
export interface RagIngestRawResult {
  networkError: boolean;
  httpStatus?: number;
  body?: unknown;
  retryAfterMs?: number | null;
}

export type ParsedIngestResponse =
  | { outcome: 'ACCEPTED'; taskId: RagTaskId }
  | { outcome: 'SUCCEEDED' }
  | { outcome: 'RESULT_CODE'; resultCode: KbIngestResultCode; retryAfterMs: number | null };

export function parseIngestResponse(result: RagIngestRawResult): ParsedIngestResponse {
  if (result.networkError) return { outcome: 'RESULT_CODE', resultCode: 'NETWORK_ERROR', retryAfterMs: null };

  const status = result.httpStatus ?? 0;
  const body = (result.body ?? {}) as Record<string, unknown>;
  const retryAfterMs = result.retryAfterMs ?? null;

  if (status >= 200 && status < 300) {
    if (body.status === 'async_started') {
      const taskId = typeof body.task_id === 'string' ? toRagTaskId(body.task_id) : null;
      if (!taskId) return { outcome: 'RESULT_CODE', resultCode: 'INVALID_TASK_ID', retryAfterMs: null };
      return { outcome: 'ACCEPTED', taskId };
    }
    // 동기 응답 — { result: "...성공." | "...실패." } (200이지만 실패일 수 있다).
    const judged = judgeIngestResultText(body.result);
    if (judged === 'SUCCESS') return { outcome: 'SUCCEEDED' };
    if (judged === 'FAILURE') return { outcome: 'RESULT_CODE', resultCode: 'RAG_REPORTED_FAILURE', retryAfterMs: null };
    return { outcome: 'RESULT_CODE', resultCode: 'UPSTREAM_ERROR', retryAfterMs: null };
  }
  if (status === 400) return { outcome: 'RESULT_CODE', resultCode: 'HTTP_400', retryAfterMs: null };
  if (status === 429) return { outcome: 'RESULT_CODE', resultCode: 'RATE_LIMITED', retryAfterMs };
  if (status === 503) return { outcome: 'RESULT_CODE', resultCode: 'OVERLOADED', retryAfterMs };
  return { outcome: 'RESULT_CODE', resultCode: 'UPSTREAM_ERROR', retryAfterMs: null };
}
