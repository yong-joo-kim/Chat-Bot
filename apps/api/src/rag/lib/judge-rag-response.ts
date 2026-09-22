import type { RagQueryResponseRaw } from './rag-response.schema';

export type RagJudgement =
  | { ok: true; response: RagQueryResponseRaw }
  | { ok: false; outcome: 'NO_EVIDENCE' | 'SCHEMA_INVALID' };

const LLM_ERROR_PREFIX = '답변 생성 중 오류가 발생했습니다';
const FAILURE_SUFFIX = '실패.';

/**
 * RAG 질의 성패 판정(FR-N2-17, §9.4, DD-78) — DB·Nest 무의존 순수 함수. HTTP 상태 코드는 이미
 * 200으로 전제하고(그 외는 호출부가 `judgeHttpOutcome`으로 먼저 걸러낸다), zod 파싱까지 끝난
 * 응답만 받는다.
 *
 * 성공 조건(전부 만족): ① zod 파싱 성공(호출부가 보장) ② `retrieval_success === 1`
 * ③ `result`가 비어 있지 않음 ④ `"답변 생성 중 오류가 발생했습니다"`로 시작하지 않음(§1.4 근거 3)
 * ⑤ `"실패."`로 끝나지 않음(§0-3).
 *
 * `source_info`로 성패를 판별하지 않는다(§1.4 근거 2, AC-N2-7) — `retrieval_success`가 유일한 기준이다.
 */
export function judgeRagResponse(response: RagQueryResponseRaw): RagJudgement {
  const trimmed = response.result.trim();

  if (response.retrieval_success !== 1) return { ok: false, outcome: 'NO_EVIDENCE' };
  if (trimmed === '') return { ok: false, outcome: 'NO_EVIDENCE' };
  if (trimmed.startsWith(LLM_ERROR_PREFIX)) return { ok: false, outcome: 'NO_EVIDENCE' };
  if (trimmed.endsWith(FAILURE_SUFFIX)) return { ok: false, outcome: 'NO_EVIDENCE' };

  return { ok: true, response };
}
