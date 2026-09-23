import { normalizeText } from '@chat-bot/shared-types';
import type { SlimAnswerSetting, SlimContext, SlimFaq, SlimHomonym, SlimIntent, SlimKeyword, SlimNode, SnapshotEnvelope } from './snapshot-envelope';
import { itemEquals } from './version-diff';
import type { DiffEntity } from './version-diff';
import { stableStringify } from './snapshot-canonical';
import type { ChatbotSnapshotProfile } from '@chat-bot/shared-types';

/**
 * 순수 함수 `planRestore(current, target)`(§8.4) — 차이 적용(diff-apply) 계획. ID 보존, 원시 SQL 0건
 * (이름 교환은 임시 키로 해결). DB·Nest 무의존 — `restore/version-restore.applier.ts`가 이 계획을
 * 순서대로(S1~S9) 적용하는 **유일한 파일**이다.
 */

interface EntityDiff<T> {
  toDelete: string[];
  toCreate: T[];
  toUpdate: T[];
}

function diffEntities<T extends { id: string }>(
  kind: Parameters<typeof itemEquals>[0],
  current: readonly T[],
  target: readonly T[],
): EntityDiff<T> {
  const currentMap = new Map(current.map((e) => [e.id, e]));
  const targetMap = new Map(target.map((e) => [e.id, e]));
  const toDelete: string[] = [];
  const toCreate: T[] = [];
  const toUpdate: T[] = [];

  for (const id of currentMap.keys()) {
    if (!targetMap.has(id)) toDelete.push(id);
  }
  for (const [id, targetEntity] of targetMap) {
    const currentEntity = currentMap.get(id);
    if (!currentEntity) {
      toCreate.push(targetEntity);
    } else if (!itemEquals(kind, currentEntity as unknown as DiffEntity, targetEntity as unknown as DiffEntity)) {
      toUpdate.push(targetEntity);
    }
  }
  return { toDelete, toCreate, toUpdate };
}

function rekeyIds<T extends { id: string }>(
  current: readonly T[],
  toUpdate: readonly T[],
  nameOf: (e: T) => string,
): string[] {
  const currentMap = new Map(current.map((e) => [e.id, e]));
  return toUpdate
    .filter((t) => {
      const c = currentMap.get(t.id);
      return c && normalizeText(nameOf(c)) !== normalizeText(nameOf(t));
    })
    .map((t) => t.id);
}

export interface NodePair {
  nodeId: string;
  intentId?: string;
  keywordId?: string;
}

export interface RestorePlan {
  intents: EntityDiff<SlimIntent>;
  keywords: EntityDiff<SlimKeyword>;
  homonyms: EntityDiff<SlimHomonym>;
  contexts: EntityDiff<SlimContext>;
  nodes: EntityDiff<SlimNode>;
  faqs: EntityDiff<SlimFaq>;

  rekeyIds: {
    intents: string[];
    keywords: string[];
    homonyms: string[];
    contexts: string[];
    nodes: string[];
    faqs: string[];
  };
  /** S3 — 삭제될 컨텍스트를 참조하던 유지 노드의 FK 해제 대상 노드 id. */
  nodeContextClearIds: string[];

  nodeIntentPairs: { toDelete: Array<{ nodeId: string; intentId: string }>; toCreate: Array<{ nodeId: string; intentId: string }> };
  nodeKeywordPairs: { toDelete: Array<{ nodeId: string; keywordId: string }>; toCreate: Array<{ nodeId: string; keywordId: string }> };

  answerSetting: { action: 'SKIP' } | { action: 'DELETE' } | { action: 'UPSERT'; value: SlimAnswerSetting };
  profile: { action: 'SKIP' } | { action: 'UPDATE'; value: ChatbotSnapshotProfile };
}

function pairKey(nodeId: string, otherId: string): string {
  return `${nodeId}::${otherId}`;
}

export function planRestore(current: SnapshotEnvelope, target: SnapshotEnvelope): RestorePlan {
  const intents = diffEntities('INTENT', current.assets.intents, target.assets.intents);
  const keywords = diffEntities('KEYWORD', current.assets.keywords, target.assets.keywords);
  const homonyms = diffEntities('HOMONYM', current.assets.homonyms, target.assets.homonyms);
  const contexts = diffEntities('CONTEXT', current.assets.contexts, target.assets.contexts);
  const nodes = diffEntities('NODE', current.assets.dialogNodes, target.assets.dialogNodes);
  const faqs = diffEntities('FAQ', current.assets.faqs, target.assets.faqs);

  const contextToDeleteSet = new Set(contexts.toDelete);
  const currentNodeMap = new Map(current.assets.dialogNodes.map((n) => [n.id, n]));
  const nodeContextClearIds = nodes.toUpdate
    .map((n) => currentNodeMap.get(n.id))
    .filter((n): n is SlimNode => Boolean(n && n.contextVariableId && contextToDeleteSet.has(n.contextVariableId)))
    .map((n) => n.id);

  // 조인 집합 차이 — currentPairs∖targetPairs / targetPairs∖currentPairs(§8.4)
  const currentIntentPairs = new Map<string, { nodeId: string; intentId: string }>();
  for (const n of current.assets.dialogNodes) for (const intentId of n.intentIds) currentIntentPairs.set(pairKey(n.id, intentId), { nodeId: n.id, intentId });
  const targetIntentPairs = new Map<string, { nodeId: string; intentId: string }>();
  for (const n of target.assets.dialogNodes) for (const intentId of n.intentIds) targetIntentPairs.set(pairKey(n.id, intentId), { nodeId: n.id, intentId });

  const currentKeywordPairs = new Map<string, { nodeId: string; keywordId: string }>();
  for (const n of current.assets.dialogNodes) for (const keywordId of n.keywordIds) currentKeywordPairs.set(pairKey(n.id, keywordId), { nodeId: n.id, keywordId });
  const targetKeywordPairs = new Map<string, { nodeId: string; keywordId: string }>();
  for (const n of target.assets.dialogNodes) for (const keywordId of n.keywordIds) targetKeywordPairs.set(pairKey(n.id, keywordId), { nodeId: n.id, keywordId });

  const nodeIntentPairs = {
    toDelete: [...currentIntentPairs.entries()].filter(([k]) => !targetIntentPairs.has(k)).map(([, v]) => v),
    toCreate: [...targetIntentPairs.entries()].filter(([k]) => !currentIntentPairs.has(k)).map(([, v]) => v),
  };
  const nodeKeywordPairs = {
    toDelete: [...currentKeywordPairs.entries()].filter(([k]) => !targetKeywordPairs.has(k)).map(([, v]) => v),
    toCreate: [...targetKeywordPairs.entries()].filter(([k]) => !currentKeywordPairs.has(k)).map(([, v]) => v),
  };

  const answerSettingAction: RestorePlan['answerSetting'] =
    stableStringify(current.answerSetting) === stableStringify(target.answerSetting)
      ? { action: 'SKIP' }
      : target.answerSetting === null
        ? { action: 'DELETE' }
        : { action: 'UPSERT', value: target.answerSetting };

  const profileAction: RestorePlan['profile'] =
    stableStringify(current.profile) === stableStringify(target.profile) ? { action: 'SKIP' } : { action: 'UPDATE', value: target.profile };

  return {
    intents,
    keywords,
    homonyms,
    contexts,
    nodes,
    faqs,
    rekeyIds: {
      intents: rekeyIds(current.assets.intents, intents.toUpdate, (e) => e.name),
      keywords: rekeyIds(current.assets.keywords, keywords.toUpdate, (e) => e.name),
      homonyms: rekeyIds(current.assets.homonyms, homonyms.toUpdate, (e) => e.word),
      contexts: rekeyIds(current.assets.contexts, contexts.toUpdate, (e) => e.name),
      nodes: rekeyIds(current.assets.dialogNodes, nodes.toUpdate, (e) => e.name),
      faqs: rekeyIds(current.assets.faqs, faqs.toUpdate, (e) => e.question),
    },
    nodeContextClearIds,
    nodeIntentPairs,
    nodeKeywordPairs,
    answerSetting: answerSettingAction,
    profile: profileAction,
  };
}
