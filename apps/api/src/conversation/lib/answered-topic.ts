import type { DialogueBundle } from '@chat-bot/shared-types';

export interface AnsweredTopicResolutionInput {
  matchedNodeId?: string;
  matchedFaqId?: string;
  matchedIntentId?: string;
}

/**
 * [신규 No.22 — §6.6] 답한 자산(노드 → FAQ → 의도 순 첫 매칭)의 토픽을 반환한다. 처음 존재하는
 * 매칭 자산에서 멈춘다 — 그 자산이 공통이면 `undefined`(다음 단계로 넘어가지 않는다). 미응답·차단
 * 턴은 호출부가 `isAnswered=false`로 걸러 `undefined`를 받는다. DB·Nest 무의존 순수 함수.
 */
export function resolveAnsweredTopicId(bundle: DialogueBundle, result: AnsweredTopicResolutionInput, isAnswered: boolean): string | undefined {
  if (!isAnswered) return undefined;
  if (result.matchedNodeId) {
    return bundle.dialogNodes.find((n) => n.id === result.matchedNodeId)?.topicId;
  }
  if (result.matchedFaqId) {
    return bundle.faqs.find((f) => f.id === result.matchedFaqId)?.topicId;
  }
  if (result.matchedIntentId) {
    return bundle.intents.find((i) => i.id === result.matchedIntentId)?.topicId;
  }
  return undefined;
}
