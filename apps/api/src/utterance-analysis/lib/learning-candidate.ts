/**
 * 학습 후보 판정(No.21 — 설계서 §9.3, FR-DC5-4). DB·Nest 무의존 순수 함수.
 *
 *   learningCandidate = !answered || (top1Score !== null && top1Score < threshold)
 *
 * 뜻: "챗봇이 답하지 못했거나, 가장 비슷한 예문과의 점수가 기준 미만". 의미 매칭이 꺼져 있거나 점수가 없으면
 * `!answered`만 본다. 기준을 0으로 두면 "답하지 못한 발화만"이 된다.
 */
export function isLearningCandidate(input: { answered: boolean; top1Score: number | null; threshold: number }): boolean {
  if (!input.answered) return true;
  return input.top1Score !== null && input.top1Score < input.threshold;
}
