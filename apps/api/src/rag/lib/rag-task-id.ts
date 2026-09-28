/**
 * [신규 No.43] 외부 RAG 작업 id 브랜드 타입(KB-5) — `RagHttpClient.taskStatus()`의 경로 뒤에는
 * 이 타입을 만드는 `toRagTaskId()`를 통과한 값만 붙는다. 이 파일 밖에서 `as RagTaskId`로 캐스팅하지
 * 않는다(정적 검사가 단언한다).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type RagTaskId = string & { readonly __brand: 'RagTaskId' };

/** UUID 형식(소문자화 후 검사)이 아니면 `null` — 비UUID·경로 문자(`../`) 등은 여기서 걸러진다. */
export function toRagTaskId(raw: string): RagTaskId | null {
  if (typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  if (!UUID_RE.test(lower)) return null;
  return lower as RagTaskId;
}
