import type { DialogueBundle, TopicSplitCounts, TopicSplitSelection } from '@chat-bot/shared-types';
import { collectUuidLeaves } from '../../dialogue-common/lib/asset-ref-graph';
import { trimSystemNodeOutputs } from './system-node-trim';
import type { FollowedLinkReport, TrimmedLinkReport } from './system-node-trim';

export type TransferKind = 'INTENT' | 'KEYWORD' | 'HOMONYM' | 'CONTEXT' | 'NODE' | 'FAQ' | 'SURVEY';
export type TransferReason = 'SELECTED' | 'CLOSURE' | 'SYSTEM';

export interface TransferSource {
  chatbotId: string;
  bundle: DialogueBundle; // 필터 없음(전체 자산) · surveys 포함
  topics: Array<{ id: string; name: string; description: string | null; sortOrder: number; enabled: boolean }>;
  capturedAt: Date;
}

export interface TransferSubset {
  ids: Record<TransferKind, Set<string>>;
  reasons: Map<string, TransferReason>;
  closureItems: Array<{ kind: TransferKind; id: string; name: string }>;
  /** 시스템 노드별 최종 아웃풋(트림 적용분) — 변경된 노드만 담는다. */
  trimmedOutputs: Map<string, DialogueBundle['dialogNodes'][number]['outputs']>;
  trimmedLinks: Array<{ nodeId: string; nodeName: string; link: TrimmedLinkReport }>;
  followedSystemLinks: Array<{ nodeId: string; nodeName: string; link: FollowedLinkReport }>;
  systemNodes: { start: string | null; fallback: string | null };
  /** 선택된 토픽 id(닫힌 목록) — `transfer-plan.ts`가 새 `Topic` 행을 만드는 대상(§9.5 ④). */
  selectedTopicIds: string[];
  totals: TopicSplitCounts;
  selectedTotals: TopicSplitCounts;
  closureAddedTotals: TopicSplitCounts;
}

function emptyCounts(): TopicSplitCounts {
  return { intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0, surveys: 0, intentExamples: 0, nodeIntentLinks: 0, nodeKeywordLinks: 0 };
}

interface Indexes {
  intents: Map<string, DialogueBundle['intents'][number]>;
  keywords: Map<string, DialogueBundle['keywords'][number]>;
  homonyms: Map<string, DialogueBundle['homonyms'][number]>;
  contexts: Map<string, DialogueBundle['contexts'][number]>;
  nodes: Map<string, DialogueBundle['dialogNodes'][number]>;
  faqs: Map<string, DialogueBundle['faqs'][number]>;
  surveys: Map<string, NonNullable<DialogueBundle['surveys']>[number]>;
  /** 자산 id → 종류(UUID 잎 매칭용, asset-ref-graph.ts와 같은 판정 규칙). */
  kindOf: Map<string, TransferKind>;
}

function buildIndexes(bundle: DialogueBundle): Indexes {
  const intents = new Map(bundle.intents.map((i) => [i.id, i]));
  const keywords = new Map(bundle.keywords.map((k) => [k.id, k]));
  const homonyms = new Map(bundle.homonyms.map((h) => [h.id, h]));
  const contexts = new Map(bundle.contexts.map((c) => [c.id, c]));
  const nodes = new Map(bundle.dialogNodes.map((n) => [n.id, n]));
  const faqs = new Map(bundle.faqs.map((f) => [f.id, f]));
  const surveys = new Map((bundle.surveys ?? []).map((s) => [s.id, s]));
  const kindOf = new Map<string, TransferKind>();
  for (const id of intents.keys()) kindOf.set(id, 'INTENT');
  for (const id of keywords.keys()) kindOf.set(id, 'KEYWORD');
  for (const id of homonyms.keys()) kindOf.set(id, 'HOMONYM');
  for (const id of contexts.keys()) kindOf.set(id, 'CONTEXT');
  for (const id of nodes.keys()) kindOf.set(id, 'NODE');
  for (const id of faqs.keys()) kindOf.set(id, 'FAQ');
  for (const id of surveys.keys()) kindOf.set(id, 'SURVEY');
  return { intents, keywords, homonyms, contexts, nodes, faqs, surveys, kindOf };
}

function emptySets(): Record<TransferKind, Set<string>> {
  return { INTENT: new Set(), KEYWORD: new Set(), HOMONYM: new Set(), CONTEXT: new Set(), NODE: new Set(), FAQ: new Set(), SURVEY: new Set() };
}

/** 자산 하나의 나가는 참조(UUID 잎 규칙 — §9.2) id 목록. */
function outgoingIdsOf(kind: TransferKind, id: string, idx: Indexes): string[] {
  const out = new Set<string>();
  if (kind === 'NODE') {
    const node = idx.nodes.get(id);
    if (!node) return [];
    node.intentIds.forEach((i) => out.add(i));
    node.keywordIds.forEach((k) => out.add(k));
    if (node.contextVariableId) out.add(node.contextVariableId);
    for (const leaf of collectUuidLeaves(node.outputs)) {
      if (idx.kindOf.has(leaf)) out.add(leaf);
    }
  } else if (kind === 'HOMONYM') {
    const h = idx.homonyms.get(id);
    h?.meanings.forEach((m) => {
      if (m.intentId) out.add(m.intentId);
    });
  } else if (kind === 'CONTEXT') {
    const c = idx.contexts.get(id);
    c?.slots.forEach((s) => {
      if (s.keywordId) out.add(s.keywordId);
    });
  }
  out.delete(id);
  return [...out];
}

/** 씨앗 집합에서 시작해 참조 폐포를 구한다(고정점까지 반복, O(자산+간선)). */
function bfsClosure(seeds: Record<TransferKind, Set<string>>, idx: Indexes): { ids: Record<TransferKind, Set<string>>; reasons: Map<string, TransferReason> } {
  const ids = emptySets();
  const reasons = new Map<string, TransferReason>();
  const queue: Array<{ kind: TransferKind; id: string }> = [];
  for (const kind of Object.keys(seeds) as TransferKind[]) {
    for (const id of seeds[kind]) {
      if (!ids[kind].has(id)) {
        ids[kind].add(id);
        reasons.set(id, 'SELECTED');
        queue.push({ kind, id });
      }
    }
  }
  while (queue.length > 0) {
    const { kind, id } = queue.shift()!;
    for (const targetId of outgoingIdsOf(kind, id, idx)) {
      const targetKind = idx.kindOf.get(targetId);
      if (!targetKind) continue;
      if (!ids[targetKind].has(targetId)) {
        ids[targetKind].add(targetId);
        if (!reasons.has(targetId)) reasons.set(targetId, 'CLOSURE');
        queue.push({ kind: targetKind, id: targetId });
      }
    }
  }
  return { ids, reasons };
}

function countsOf(ids: Record<TransferKind, Set<string>>, idx: Indexes): TopicSplitCounts {
  const c = emptyCounts();
  c.intents = ids.INTENT.size;
  c.keywords = ids.KEYWORD.size;
  c.homonyms = ids.HOMONYM.size;
  c.contexts = ids.CONTEXT.size;
  c.dialogNodes = ids.NODE.size;
  c.faqs = ids.FAQ.size;
  c.surveys = ids.SURVEY.size;
  for (const id of ids.INTENT) c.intentExamples += idx.intents.get(id)?.examples.length ?? 0;
  for (const id of ids.NODE) {
    const n = idx.nodes.get(id);
    if (!n) continue;
    c.nodeIntentLinks += n.intentIds.filter((i) => ids.INTENT.has(i)).length;
    c.nodeKeywordLinks += n.keywordIds.filter((k) => ids.KEYWORD.has(k)).length;
  }
  return c;
}

export function selectTransferSubset(source: TransferSource, selection: TopicSplitSelection): TransferSubset {
  const idx = buildIndexes(source.bundle);
  const topicIdSet = new Set(selection.topicIds);

  const seeds = emptySets();
  const pushIfMatch = (kind: TransferKind, list: readonly { id: string; topicId?: string }[]): void => {
    for (const item of list) {
      const inTopic = item.topicId !== undefined && topicIdSet.has(item.topicId);
      const inCommon = item.topicId === undefined && selection.includeCommon;
      if (inTopic || inCommon) seeds[kind].add(item.id);
    }
  };
  pushIfMatch('INTENT', source.bundle.intents);
  pushIfMatch('KEYWORD', source.bundle.keywords);
  pushIfMatch('HOMONYM', source.bundle.homonyms);
  pushIfMatch('CONTEXT', source.bundle.contexts);
  pushIfMatch('NODE', source.bundle.dialogNodes);
  pushIfMatch('FAQ', source.bundle.faqs);

  // c0 — 시스템 노드를 씨앗으로 넣지 않은 1차 폐포(§9.3 TRIM 판정 기준).
  const c0 = bfsClosure(seeds, idx);

  const startNode = source.bundle.dialogNodes.find((n) => n.nodeType === 'START') ?? null;
  const fallbackNode = source.bundle.dialogNodes.find((n) => n.nodeType === 'FALLBACK') ?? null;
  const systemNodes = [startNode, fallbackNode].filter((n): n is NonNullable<typeof n> => n !== null);

  const trimmedOutputs = new Map<string, DialogueBundle['dialogNodes'][number]['outputs']>();
  const trimmedLinks: TransferSubset['trimmedLinks'] = [];
  const followedSystemLinks: TransferSubset['followedSystemLinks'] = [];

  // 시스템 노드를 최종 집합에 추가한다(이미 포함돼 있으면 SYSTEM으로 사유만 갱신하지 않는다 — 기존 사유 유지).
  const finalIds = emptySets();
  for (const kind of Object.keys(c0.ids) as TransferKind[]) for (const id of c0.ids[kind]) finalIds[kind].add(id);
  const finalReasons = new Map(c0.reasons);

  const applyFollow = selection.systemNodeLinks === 'FOLLOW' || selection.includeCommon;

  for (const node of systemNodes) {
    const alreadyIncluded = finalIds.NODE.has(node.id);
    if (!alreadyIncluded) {
      finalIds.NODE.add(node.id);
      finalReasons.set(node.id, 'SYSTEM');
    }

    if (applyFollow) {
      // FOLLOW — 일반 자산처럼 폐포를 따라간다(요구사항 원안). 아웃풋 변경 없음.
      const extra = bfsClosure({ ...emptySets(), NODE: new Set([node.id]) }, idx);
      for (const kind of Object.keys(extra.ids) as TransferKind[]) {
        for (const id of extra.ids[kind]) {
          if (!finalIds[kind].has(id)) {
            finalIds[kind].add(id);
            if (!finalReasons.has(id)) finalReasons.set(id, 'CLOSURE');
          }
        }
      }
      continue;
    }

    // TRIM(기본) — c0.NODE(+ 이미 확정된 다른 시스템 노드)를 유지 대상으로 트림 판정한다.
    const keepNodeIds = new Set([...c0.ids.NODE, ...systemNodes.map((n) => n.id)]);
    const { outputs, trimmedLinks: trimmed, followedLinks: followed } = trimSystemNodeOutputs(node, keepNodeIds);
    if (trimmed.length > 0 || outputs !== node.outputs) trimmedOutputs.set(node.id, outputs);
    trimmed.forEach((link) => trimmedLinks.push({ nodeId: node.id, nodeName: node.name, link }));
    followed.forEach((link) => followedSystemLinks.push({ nodeId: node.id, nodeName: node.name, link }));

    // 따라간(API/SURVEY 또는 TRIM_WOULD_EMPTY) 대상은 폐포에 편입한다.
    for (const link of followed) {
      if (finalIds.NODE.has(link.targetNodeId)) continue;
      const extra = bfsClosure({ ...emptySets(), NODE: new Set([link.targetNodeId]) }, idx);
      for (const kind of Object.keys(extra.ids) as TransferKind[]) {
        for (const id of extra.ids[kind]) {
          if (!finalIds[kind].has(id)) {
            finalIds[kind].add(id);
            if (!finalReasons.has(id)) finalReasons.set(id, 'CLOSURE');
          }
        }
      }
    }
  }

  const closureItems: TransferSubset['closureItems'] = [];
  const nameOf = (kind: TransferKind, id: string): string => {
    switch (kind) {
      case 'INTENT':
        return idx.intents.get(id)?.name ?? id;
      case 'KEYWORD':
        return idx.keywords.get(id)?.name ?? id;
      case 'HOMONYM':
        return idx.homonyms.get(id)?.word ?? id;
      case 'CONTEXT':
        return idx.contexts.get(id)?.name ?? id;
      case 'NODE':
        return idx.nodes.get(id)?.name ?? id;
      case 'FAQ':
        return idx.faqs.get(id)?.question ?? id;
      case 'SURVEY':
        return idx.surveys.get(id)?.name ?? id;
    }
  };
  for (const [id, reason] of finalReasons) {
    if (reason !== 'CLOSURE') continue;
    const kind = idx.kindOf.get(id);
    if (!kind) continue;
    closureItems.push({ kind, id, name: nameOf(kind, id) });
  }

  const selectedIds = emptySets();
  for (const kind of Object.keys(seeds) as TransferKind[]) for (const id of seeds[kind]) selectedIds[kind].add(id);

  return {
    ids: finalIds,
    reasons: finalReasons,
    closureItems,
    trimmedOutputs,
    trimmedLinks,
    followedSystemLinks,
    systemNodes: { start: startNode?.id ?? null, fallback: fallbackNode?.id ?? null },
    selectedTopicIds: source.topics.filter((t) => topicIdSet.has(t.id)).map((t) => t.id),
    totals: countsOf(finalIds, idx),
    selectedTotals: countsOf(selectedIds, idx),
    closureAddedTotals: (() => {
      const added = emptySets();
      for (const kind of Object.keys(finalIds) as TransferKind[]) {
        for (const id of finalIds[kind]) if (!selectedIds[kind].has(id)) added[kind].add(id);
      }
      return countsOf(added, idx);
    })(),
  };
}
