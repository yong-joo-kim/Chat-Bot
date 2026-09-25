import type { DialogueBundle, TopicAssetCounts } from '@chat-bot/shared-types';
import { TOPIC_FILTER_COMMON } from '@chat-bot/shared-types';
import type { AssetRef } from '../../dialogue-common/lib/asset-ref-graph';

/** 설문 간선은 교차 참조 집계에서 제외한다(설문은 토픽 비소속 — topic-system-설계.md §7.2 ②). */
const SURVEY_EDGES = new Set(['NODE_SURVEY', 'NODE_SURVEY_COMPLETE']);

export interface TopicSummaryEntry {
  counts: TopicAssetCounts;
  outgoingCrossRefs: number;
  incomingCrossRefs: number;
}

function emptyCounts(): TopicAssetCounts {
  return { intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 };
}

/** 자산 id → 토픽 키(`topicId ?? 'common'`) 맵 — 설문·상담설정은 이 맵에 없다(토픽 비소속). */
function buildAssetTopicKeyMap(bundle: DialogueBundle): Map<string, string> {
  const map = new Map<string, string>();
  for (const i of bundle.intents) map.set(i.id, i.topicId ?? TOPIC_FILTER_COMMON);
  for (const k of bundle.keywords) map.set(k.id, k.topicId ?? TOPIC_FILTER_COMMON);
  for (const h of bundle.homonyms) map.set(h.id, h.topicId ?? TOPIC_FILTER_COMMON);
  for (const c of bundle.contexts) map.set(c.id, c.topicId ?? TOPIC_FILTER_COMMON);
  for (const n of bundle.dialogNodes) map.set(n.id, n.topicId ?? TOPIC_FILTER_COMMON);
  for (const f of bundle.faqs) map.set(f.id, f.topicId ?? TOPIC_FILTER_COMMON);
  return map;
}

/**
 * 토픽별 자산 수·교차 참조 수를 계산한다(§5.3·§7.2 ②) — `build()` 1회 + 참조 열거 1회 위에서 도는
 * 순수 계산(추가 쿼리 0, D-1). `refs`는 `collectAssetRefs(bundle, extras)` 결과를 그대로 넘긴다.
 */
export function summarizeTopics(
  bundle: DialogueBundle,
  topicIds: readonly string[],
  refs: readonly AssetRef[],
): { byTopicId: Map<string, TopicSummaryEntry>; common: TopicSummaryEntry } {
  const byKey = new Map<string, TopicSummaryEntry>();
  const ensure = (key: string): TopicSummaryEntry => {
    let entry = byKey.get(key);
    if (!entry) {
      entry = { counts: emptyCounts(), outgoingCrossRefs: 0, incomingCrossRefs: 0 };
      byKey.set(key, entry);
    }
    return entry;
  };
  for (const id of [...topicIds, TOPIC_FILTER_COMMON]) ensure(id);

  for (const i of bundle.intents) ensure(i.topicId ?? TOPIC_FILTER_COMMON).counts.intents += 1;
  for (const k of bundle.keywords) ensure(k.topicId ?? TOPIC_FILTER_COMMON).counts.keywords += 1;
  for (const h of bundle.homonyms) ensure(h.topicId ?? TOPIC_FILTER_COMMON).counts.homonyms += 1;
  for (const c of bundle.contexts) ensure(c.topicId ?? TOPIC_FILTER_COMMON).counts.contexts += 1;
  for (const n of bundle.dialogNodes) ensure(n.topicId ?? TOPIC_FILTER_COMMON).counts.dialogNodes += 1;
  for (const f of bundle.faqs) ensure(f.topicId ?? TOPIC_FILTER_COMMON).counts.faqs += 1;

  const assetTopicKey = buildAssetTopicKeyMap(bundle);
  for (const ref of refs) {
    if (SURVEY_EDGES.has(ref.edge)) continue;
    const fromKey = assetTopicKey.get(ref.fromId) ?? TOPIC_FILTER_COMMON;
    const toKey = assetTopicKey.get(ref.toId);
    if (toKey === undefined) continue; // 설문·상담설정 등 토픽 비소속 대상은 교차 참조로 세지 않는다.
    if (fromKey === toKey) continue;
    if (toKey !== TOPIC_FILTER_COMMON) ensure(fromKey).outgoingCrossRefs += 1;
    ensure(toKey).incomingCrossRefs += 1;
  }

  const common = byKey.get(TOPIC_FILTER_COMMON)!;
  const byTopicId = new Map<string, TopicSummaryEntry>();
  for (const id of topicIds) byTopicId.set(id, byKey.get(id)!);
  return { byTopicId, common };
}
