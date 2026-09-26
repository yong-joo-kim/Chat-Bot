/**
 * [신규 No.27] 질문 순위 groupBy(userMessage) 5곳(대시보드 topQuestions · 질문 순위 인기/미응답 ·
 * 통합 인기/미응답 · 통합 귀속)이 공유하는 조건 1벌(§9.6, FR-SV10-5, J-14). 설문이 소비한 턴은
 * 답변자 전원이 같은 값을 반복해 질문 순위를 오염시키므로 제외한다. 기존 행은 전부 false라
 * 기존 수치가 불변이다(FR-0-113).
 * [No.24 추가] `handoffTurn`(상담 구간 사용자 턴)도 같은 이유로 제외한다 — "네"·"감사합니다" 같은
 * 입력이 질문 순위를 오염시킨다(ADR-0036 §1, FR-CS11-2). 기존 행은 전부 false라 기존 수치가 불변이다.
 * [No.45 추가] `textPurgedAt: null` — 보존기간 경과로 텍스트가 소거된 행을 제외한다(빈 문자열이
 * 순위 1위로 뭉치지 않게, AC-DG5-2). 기존 행은 전부 null이라 기존 수치가 불변이다.
 */
export const QUESTION_RANKING_LOG_FILTER = { surveyTurn: false, handoffTurn: false, textPurgedAt: null } as const;
