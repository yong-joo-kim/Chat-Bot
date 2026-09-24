/**
 * [신규 No.27] 질문 순위 groupBy(userMessage) 5곳(대시보드 topQuestions · 질문 순위 인기/미응답 ·
 * 통합 인기/미응답 · 통합 귀속)이 공유하는 조건 1벌(§9.6, FR-SV10-5, J-14). 설문이 소비한 턴은
 * 답변자 전원이 같은 값을 반복해 질문 순위를 오염시키므로 제외한다. 기존 행은 전부 false라
 * 기존 수치가 불변이다(FR-0-113).
 */
export const QUESTION_RANKING_LOG_FILTER = { surveyTurn: false } as const;
