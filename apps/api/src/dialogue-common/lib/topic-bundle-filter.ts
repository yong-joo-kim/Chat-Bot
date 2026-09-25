import type { DialogueBundle } from '@chat-bot/shared-types';

/**
 * 비활성 토픽의 **응답 진입점**(노드·의도·FAQ)만 번들에서 뺀다(topic-system-설계.md §6.1).
 * 키워드·컨텍스트·동음이의어·설문은 그대로 둔다 — 사전형 자산이라 스스로 답하지 않는다(§1.6).
 * `inactiveTopicIds`가 비었으면 **입력 객체를 그대로 반환**한다(토픽 없는 챗봇 바이트 동일 — AC-TP1-1).
 */
export function filterInactiveTopicAssets(bundle: DialogueBundle, inactiveTopicIds: ReadonlySet<string>): DialogueBundle {
  if (inactiveTopicIds.size === 0) return bundle;

  return {
    ...bundle,
    dialogNodes: bundle.dialogNodes.filter((n) => !n.topicId || !inactiveTopicIds.has(n.topicId)),
    intents: bundle.intents.filter((i) => !i.topicId || !inactiveTopicIds.has(i.topicId)),
    faqs: bundle.faqs.filter((f) => !f.topicId || !inactiveTopicIds.has(f.topicId)),
  };
}
