import type { SnapshotEnvelope } from './snapshot-envelope';

export interface NormalizeSnapshotTopicsResult {
  envelope: SnapshotEnvelope;
  missingCount: number;
  changed: boolean;
}

/**
 * [신규 No.22 — §11.2] 대상 스냅샷을 **현재 토픽 기준으로 정규화**한다. 자산 6종의 `topicId`가
 * `existingTopicIds`에 없으면 제거(= 공통)하고, START/FALLBACK 노드의 `topicId`는 무조건 제거한다
 * (방어 — 원래도 항상 null이어야 한다). DB·Nest 무의존 순수 함수. `changed`가 true면 호출자가
 * 기대 해시를 정규화본으로 다시 계산해야 한다(사후 검증과의 충돌 해소).
 */
export function normalizeSnapshotTopics(envelope: SnapshotEnvelope, existingTopicIds: ReadonlySet<string>): NormalizeSnapshotTopicsResult {
  let missingCount = 0;
  let changed = false;

  const normalizeTopicId = (topicId: string | undefined): string | undefined => {
    if (topicId === undefined) return undefined;
    if (!existingTopicIds.has(topicId)) {
      missingCount += 1;
      changed = true;
      return undefined;
    }
    return topicId;
  };

  const intents = envelope.assets.intents.map((i) => ({ ...i, topicId: normalizeTopicId(i.topicId) }));
  const keywords = envelope.assets.keywords.map((k) => ({ ...k, topicId: normalizeTopicId(k.topicId) }));
  const homonyms = envelope.assets.homonyms.map((h) => ({ ...h, topicId: normalizeTopicId(h.topicId) }));
  const contexts = envelope.assets.contexts.map((c) => ({ ...c, topicId: normalizeTopicId(c.topicId) }));
  const faqs = envelope.assets.faqs.map((f) => ({ ...f, topicId: normalizeTopicId(f.topicId) }));
  const dialogNodes = envelope.assets.dialogNodes.map((n) => {
    if (n.nodeType === 'START' || n.nodeType === 'FALLBACK') {
      if (n.topicId !== undefined) changed = true;
      return { ...n, topicId: undefined };
    }
    return { ...n, topicId: normalizeTopicId(n.topicId) };
  });

  if (!changed) return { envelope, missingCount: 0, changed: false };

  return {
    envelope: { ...envelope, assets: { intents, keywords, homonyms, contexts, dialogNodes, faqs } },
    missingCount,
    changed: true,
  };
}
