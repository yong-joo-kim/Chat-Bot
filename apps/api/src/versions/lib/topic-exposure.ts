import type { SnapshotEnvelope } from './snapshot-envelope';

export interface TopicExposureChange {
  exposed: number;
  hidden: number;
}

/**
 * [신규 No.22 — §11.3] 현재와 대상(정규화본)에 **모두 있는** 노드·의도·FAQ 중 복원으로 운영 노출이
 * 바뀌는 수를 센다(비활성 토픽 → 공통/활성 = `exposed`, 반대 = `hidden`). "현재 살아있는가"는
 * **현재 DB의 토픽 활성 상태**로 판정한다(토픽 정의·활성 상태는 복원하지 않는다 — AC-TP6-2).
 * DB·Nest 무의존 순수 함수 — 미리보기 경고 산출과 복원 확인 게이트(§25 PM 확정)가 공유한다.
 */
export function computeTopicExposureChange(
  topics: readonly { id: string; enabled: boolean }[],
  current: SnapshotEnvelope,
  normalizedTarget: SnapshotEnvelope,
): TopicExposureChange {
  const topicMap = new Map(topics.map((t) => [t.id, t.enabled]));
  const isLive = (topicId: string | undefined): boolean => !topicId || (topicMap.get(topicId) ?? false);

  let exposed = 0;
  let hidden = 0;
  const kinds: Array<'dialogNodes' | 'intents' | 'faqs'> = ['dialogNodes', 'intents', 'faqs'];
  for (const kind of kinds) {
    const currentById = new Map(current.assets[kind].map((a) => [a.id, a] as const));
    const targetById = new Map(normalizedTarget.assets[kind].map((a) => [a.id, a] as const));
    for (const [id, targetAsset] of targetById) {
      const currentAsset = currentById.get(id);
      if (!currentAsset) continue;
      const beforeLive = isLive(currentAsset.topicId);
      const afterLive = isLive(targetAsset.topicId);
      if (!beforeLive && afterLive) exposed += 1;
      if (beforeLive && !afterLive) hidden += 1;
    }
  }
  return { exposed, hidden };
}
