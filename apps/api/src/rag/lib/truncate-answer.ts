/** 외부 RAG 답변 절단 길이(글자 수) — 사용자 노출 상한. 운영 경로와 시뮬레이터 미리보기가 같은 값을 쓴다(L-3). */
export const ANSWER_MAX_LENGTH = 2000;

/** 2,000자 초과 시 잘라 `…`를 붙인다(순수 함수 — 운영 `RagAnswerService`와 시뮬레이터 `ragPreview` 공용). */
export function truncateAnswer(text: string): string {
  return text.length <= ANSWER_MAX_LENGTH ? text : `${text.slice(0, ANSWER_MAX_LENGTH)}…`;
}
