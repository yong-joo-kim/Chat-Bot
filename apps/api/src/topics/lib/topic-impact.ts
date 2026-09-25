import { normalizeText } from '@chat-bot/shared-types';
import type { DialogueBundle, TopicImpactPreview, TopicRef, TopicRefEndpoint } from '@chat-bot/shared-types';
import { TOPIC_LIMITS } from '@chat-bot/shared-types';
import { collectAssetRefs } from '../../dialogue-common/lib/asset-ref-graph';
import { ENTRY_POINT_KINDS, INACTIVE_REF_EDGES, buildEntityIndex, topicLabel } from './topic-boundary';
import type { EntityInfo, TopicRow } from './topic-boundary';

/** 영향 미리보기(topic-system-설계.md §7.4) — DB·Nest 무의존 순수 함수. `pendingRestoreSchedules`는
 * 호출자(서비스)가 DB 조회 후 합성한다. */
export type TopicImpactPure = Omit<TopicImpactPreview, 'pendingRestoreSchedules'>;

function toEndpoint(entity: EntityInfo, topicMap: Map<string, TopicRow>): TopicRefEndpoint {
  const label = topicLabel(entity.topicId, topicMap);
  return {
    kind: entity.kind,
    id: entity.id,
    name: entity.name,
    topicId: entity.topicId,
    topicName: label.name,
    topicEnabled: label.enabled,
  };
}

export function computeTopicImpact(
  bundle: DialogueBundle,
  topics: readonly TopicRow[],
  ctx: { handoffEndButtonNodeId?: string | null },
  topicId: string,
  action: 'ENABLE' | 'DISABLE',
): TopicImpactPure {
  const topicMap = new Map(topics.map((t) => [t.id, t]));
  const target = topicMap.get(topicId);
  const currentlyEnabled = target?.enabled ?? true;
  const alreadyInState = action === 'ENABLE' ? currentlyEnabled : !currentlyEnabled;

  const entryPoints = {
    dialogNodes: bundle.dialogNodes.filter((n) => n.topicId === topicId).length,
    intents: bundle.intents.filter((i) => i.topicId === topicId).length,
    faqs: bundle.faqs.filter((f) => f.topicId === topicId).length,
  };

  const topicMapAfter = new Map(topics.map((t) => [t.id, t.id === topicId ? { ...t, enabled: action === 'ENABLE' } : t]));
  const isLiveAfter = (tid: string | null): boolean => !tid || (topicMapAfter.get(tid)?.enabled ?? false);

  const entities = buildEntityIndex(bundle);
  const refs = collectAssetRefs(bundle, ctx);

  const brokenRefItems: TopicRef[] = [];
  for (const ref of refs) {
    if (!INACTIVE_REF_EDGES.has(ref.edge)) continue;
    const from = entities.get(ref.fromId);
    const to = entities.get(ref.toId);
    if (!from || !to || !ENTRY_POINT_KINDS.has(to.kind)) continue;
    const matches = action === 'DISABLE' ? to.topicId === topicId && isLiveAfter(from.topicId) : from.topicId === topicId && !isLiveAfter(to.topicId);
    if (!matches) continue;
    brokenRefItems.push({ edge: ref.edge, from: toEndpoint(from, topicMap), to: toEndpoint(to, topicMap) });
  }
  const brokenRefsSorted = [...brokenRefItems].sort((a, b) => a.from.name.localeCompare(b.from.name) || a.to.name.localeCompare(b.to.name));

  let duplicateExamples: TopicImpactPure['duplicateExamples'] = { total: 0, items: [] };
  if (action === 'ENABLE') {
    const thisIntents = bundle.intents.filter((i) => i.topicId === topicId);
    const otherLiveIntents = bundle.intents.filter((i) => i.topicId !== topicId && isLiveAfter(i.topicId ?? null));
    const otherByExample = new Map<string, typeof otherLiveIntents>();
    for (const other of otherLiveIntents) {
      for (const example of other.examples) {
        const key = normalizeText(example);
        const list = otherByExample.get(key) ?? [];
        list.push(other);
        otherByExample.set(key, list);
      }
    }
    const items: TopicImpactPure['duplicateExamples']['items'] = [];
    for (const intent of thisIntents) {
      for (const example of intent.examples) {
        const key = normalizeText(example);
        const others = otherByExample.get(key);
        if (!others) continue;
        for (const other of others) {
          const label = topicLabel(other.topicId ?? null, topicMap);
          items.push({ example, intentId: other.id, intentName: other.name, topicName: label.name });
        }
      }
    }
    duplicateExamples = { total: items.length, items: items.slice(0, TOPIC_LIMITS.impactRefsTop) };
  }

  const liveEntryPointsAfter =
    bundle.dialogNodes.filter(
      (n) => isLiveAfter(n.topicId ?? null) && n.enabled && n.nodeType === 'NORMAL' && n.intentIds.length + n.keywordIds.length + (n.contextVariableId ? 1 : 0) >= 1,
    ).length + bundle.faqs.filter((f) => isLiveAfter(f.topicId ?? null) && f.enabled).length;

  return {
    topicId,
    action,
    alreadyInState,
    entryPoints,
    brokenRefs: { total: brokenRefsSorted.length, items: brokenRefsSorted.slice(0, TOPIC_LIMITS.impactRefsTop) },
    duplicateExamples,
    liveEntryPointsAfter,
  };
}
