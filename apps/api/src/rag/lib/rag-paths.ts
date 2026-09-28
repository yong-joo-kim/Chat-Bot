/**
 * 외부 RAG 서버 경로 문자열의 **유일한 거처**다(ADR-0022, DD-77). allowlist 3개뿐이며,
 * `RagHttpClient`만 이 상수를 참조한다(AC-N4-6). 문서 초기화·전체 삭제·서버 전역 설정·
 * 프롬프트 관리 등 **파괴적 엔드포인트의 경로 문자열은 이 파일을 포함한 저장소 어디에도
 * 존재하지 않는다** — `rag-allowlist.spec.ts`가 강제한다(구체적인 금지 문자열 목록은 그
 * 테스트 파일 자신도 인용을 피하려고 조각으로 조립해 두었다).
 */
export const RAG_PATHS = Object.freeze({
  QUERY: '/api/rag/query',
  STATUS: '/api/status',
  DOCUMENT_METADATA: '/api/documents/metadata',
  // [신규 No.43] 적재 — 파일 업로드(multipart)만. 호출부는 `kb-sync/engine/kb-ingest.runner.ts` 1파일뿐이다.
  INGEST: '/api/documents/ingest',
  // [신규 No.43] 작업 개별 조회 — 뒤에는 `RagTaskId`(UUID 브랜드 값)만 붙는다. 목록·취소 경로는 금지어(KB-2).
  TASK_STATUS: '/api/async_task_status/',
} as const);

export type RagPathKey = keyof typeof RAG_PATHS;
