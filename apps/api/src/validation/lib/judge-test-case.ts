import type { TestCaseExpectedKind, TestCaseResultKind } from '@chat-bot/shared-types';

/**
 * 판정 4값 순수 함수(J-4, FR-V1-26, ADR-0029 §3) — **매칭 대상 ID 일치**만을 유일한 축으로 삼는다.
 * DB·Nest 무의존. `liveIds`는 실행 시작 시 1회 로드한 번들에서 만든다(TC마다 DB를 조회하지 않는다) —
 * 그래서 실행 도중 자산이 삭제돼도 그 실행은 일관되고, 삭제는 **다음 실행부터** UNRESOLVED로 드러난다.
 */
export interface JudgeTestCaseExpected {
  kind: TestCaseExpectedKind;
  targetId?: string | null;
}

export interface JudgeTestCaseMatched {
  matchedIntentId?: string;
  matchedFaqId?: string;
  matchedNodeId?: string;
}

export interface JudgeTestCaseLiveIds {
  intents: ReadonlySet<string>;
  faqs: ReadonlySet<string>;
  nodes: ReadonlySet<string>;
}

export function judgeTestCase(expected: JudgeTestCaseExpected, matched: JudgeTestCaseMatched, liveIds: JudgeTestCaseLiveIds): TestCaseResultKind {
  switch (expected.kind) {
    case 'ANY':
      return 'NOT_JUDGED';
    case 'FALLBACK':
      return !matched.matchedIntentId && !matched.matchedFaqId && !matched.matchedNodeId ? 'PASS' : 'FAIL';
    case 'INTENT':
      if (!expected.targetId || !liveIds.intents.has(expected.targetId)) return 'UNRESOLVED';
      return matched.matchedIntentId === expected.targetId ? 'PASS' : 'FAIL';
    case 'FAQ':
      if (!expected.targetId || !liveIds.faqs.has(expected.targetId)) return 'UNRESOLVED';
      return matched.matchedFaqId === expected.targetId ? 'PASS' : 'FAIL';
    case 'NODE':
      if (!expected.targetId || !liveIds.nodes.has(expected.targetId)) return 'UNRESOLVED';
      return matched.matchedNodeId === expected.targetId ? 'PASS' : 'FAIL';
    default:
      return 'NOT_JUDGED';
  }
}
