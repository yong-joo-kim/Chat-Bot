/**
 * 위조 방어 — 로그 PK 1회 조회 결과를 결합 검증한다(§7.2, ADR-0038 §2). 행 없음·챗봇 불일치·세션
 * 불일치·평가 미제공 턴은 전부 같은 판정(false)이며 호출부가 동일한 `404 FEEDBACK_TARGET_NOT_FOUND`로
 * 맞춘다(존재 오라클 방지, NFR-FBS1). 순수 함수 — DB·Nest 무의존(NFR-FBM1).
 */
export function verifyFeedbackTarget(
  row: { id: string; chatbotId: string; sessionId: string | null; feedbackOffered: boolean } | null,
  target: { chatbotId: string; sessionId: string },
): boolean {
  if (!row) return false;
  if (row.chatbotId !== target.chatbotId) return false;
  if (row.sessionId !== target.sessionId) return false;
  if (!row.feedbackOffered) return false;
  return true;
}
