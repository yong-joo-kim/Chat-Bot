/**
 * [신규 No.43] 외부 RAG 동기 응답·작업 완료 `result` 문자열 판정(§5.6 · FR-KB4-6) — 200인데
 * `"...실패."`인 함정을 다룬다. 접미 판정만 하고, 원문은 호출부가 저장·로그에 남기지 않는다.
 */
export type IngestResultTextJudgement = 'SUCCESS' | 'FAILURE' | 'UNKNOWN';

export function judgeIngestResultText(result: unknown): IngestResultTextJudgement {
  if (typeof result !== 'string') return 'UNKNOWN';
  if (/성공\.\s*$/.test(result)) return 'SUCCESS';
  if (/실패\.\s*$/.test(result)) return 'FAILURE';
  return 'UNKNOWN';
}
