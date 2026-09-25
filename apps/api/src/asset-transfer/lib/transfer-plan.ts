import { normalizeText } from '@chat-bot/shared-types';
import type { ContextSlot, DialogOutput, DialogueBundle, HomonymMeaning, SurveyQuestion } from '@chat-bot/shared-types';
import { reissueQuestionKeys } from '../../surveys/lib/survey-keys';
import { rewriteIdLeaves } from './id-leaf-rewrite';
import type { TransferKind, TransferSource, TransferSubset } from './transfer-selection';

export interface TransferPolicy {
  idFactory: () => string;
  now: Date;
}

interface PlannedBase {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlannedTopic extends PlannedBase {
  name: string;
  nameNormalized: string;
  description: string | null;
  sortOrder: number;
  enabled: boolean;
}

export interface PlannedSurvey {
  id: string;
  name: string;
  nameNormalized: string;
  description: string | null;
  status: 'DRAFT';
  activeFrom: Date | null;
  activeTo: Date | null;
  introMessage: string | null;
  completionMessage: string;
  cancelKeywords: string[];
  sessionTimeoutMinutes: number;
  questions: SurveyQuestion[];
  structureVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlannedIntent extends PlannedBase {
  name: string;
  nameNormalized: string;
  description: string | null;
  examples: string[];
  topicId: string | null;
}
export interface PlannedKeyword extends PlannedBase {
  name: string;
  nameNormalized: string;
  description: string | null;
  synonyms: string[];
  topicId: string | null;
}
export interface PlannedHomonym extends PlannedBase {
  word: string;
  wordNormalized: string;
  description: string | null;
  meanings: HomonymMeaning[];
  policy: string;
  clarifyPrompt: string | null;
  defaultMeaningIndex: number | null;
  topicId: string | null;
}
export interface PlannedContext extends PlannedBase {
  name: string;
  nameNormalized: string;
  description: string | null;
  slots: ContextSlot[];
  completionMessage: string | null;
  cancelKeywords: string[];
  sessionTimeoutMinutes: number;
  topicId: string | null;
}
export interface PlannedFaq extends PlannedBase {
  category: string;
  question: string;
  questionNormalized: string;
  answer: string;
  altQuestions: string[];
  enabled: boolean;
  topicId: string | null;
}
export interface PlannedNode extends PlannedBase {
  name: string;
  nameNormalized: string;
  description: string | null;
  nodeType: string;
  matchMode: string;
  enabled: boolean;
  priority: number;
  contextVariableId: string | null;
  outputs: DialogOutput[];
  topicId: string | null;
}

export interface TransferPlan {
  topics: PlannedTopic[];
  surveys: PlannedSurvey[];
  contexts: PlannedContext[];
  intents: PlannedIntent[];
  keywords: PlannedKeyword[];
  homonyms: PlannedHomonym[];
  faqs: PlannedFaq[];
  nodes: PlannedNode[];
  nodeIntentPairs: Array<{ nodeId: string; intentId: string }>;
  nodeKeywordPairs: Array<{ nodeId: string; keywordId: string }>;
  remap: Map<string, string>;
  sourceIdSet: Set<string>;
  report: { trimmedLinks: number; followedSystemLinks: number };
}

/** 종류별로 원본 id를 오름차순 정렬하고, 같은 수의 새 UUID를 발급해 오름차순으로 짝짓는다(§9.5 ①). */
function issueOrderedIds(originalIds: readonly string[], idFactory: () => string): Map<string, string> {
  const sortedOriginal = [...originalIds].sort();
  const freshIds = sortedOriginal.map(() => idFactory()).sort();
  const map = new Map<string, string>();
  sortedOriginal.forEach((oldId, i) => map.set(oldId, freshIds[i]));
  return map;
}

export function planTransfer(source: TransferSource, subset: TransferSubset, policy: TransferPolicy): TransferPlan {
  const remap = new Map<string, string>();
  const sourceIdSet = new Set<string>();

  const kindLists: Record<TransferKind, string[]> = {
    INTENT: [...subset.ids.INTENT],
    KEYWORD: [...subset.ids.KEYWORD],
    HOMONYM: [...subset.ids.HOMONYM],
    CONTEXT: [...subset.ids.CONTEXT],
    NODE: [...subset.ids.NODE],
    FAQ: [...subset.ids.FAQ],
    SURVEY: [...subset.ids.SURVEY],
  };
  for (const kind of Object.keys(kindLists) as TransferKind[]) {
    const m = issueOrderedIds(kindLists[kind], policy.idFactory);
    for (const [oldId, newId] of m) {
      remap.set(oldId, newId);
      sourceIdSet.add(oldId);
    }
  }
  // 원본 챗봇의 전 자산·설문 id(폐포에 없더라도) — 재작성 판정의 sourceIdSet은 "원본 전체"다(§9.5 ③).
  for (const i of source.bundle.intents) sourceIdSet.add(i.id);
  for (const k of source.bundle.keywords) sourceIdSet.add(k.id);
  for (const h of source.bundle.homonyms) sourceIdSet.add(h.id);
  for (const c of source.bundle.contexts) sourceIdSet.add(c.id);
  for (const n of source.bundle.dialogNodes) sourceIdSet.add(n.id);
  for (const f of source.bundle.faqs) sourceIdSet.add(f.id);
  for (const s of source.bundle.surveys ?? []) sourceIdSet.add(s.id);

  // 토픽은 선택한 토픽만 새 토픽으로 만든다(폐포 추가분·시스템 노드는 새 챗봇에서 공통 — §9.5 ④).
  const selectedTopicIds = source.topics.filter((t) => subset.selectedTopicIds.includes(t.id));
  const topicRemap = new Map<string, string>();
  for (const t of selectedTopicIds) {
    const newId = policy.idFactory();
    topicRemap.set(t.id, newId);
  }

  const topics: PlannedTopic[] = selectedTopicIds.map((t) => ({
    id: topicRemap.get(t.id)!,
    name: t.name,
    nameNormalized: normalizeText(t.name),
    description: t.description,
    sortOrder: t.sortOrder,
    enabled: t.enabled,
    createdAt: policy.now,
    updatedAt: policy.now,
  }));

  const mapTopicId = (topicId: string | undefined): string | null => (topicId && topicRemap.has(topicId) ? topicRemap.get(topicId)! : null);

  const surveyIndex = new Map((source.bundle.surveys ?? []).map((s) => [s.id, s]));
  const surveys: PlannedSurvey[] = [...subset.ids.SURVEY].map((oldId) => {
    const s = surveyIndex.get(oldId)!;
    return {
      id: remap.get(oldId)!,
      name: s.name,
      nameNormalized: normalizeText(s.name),
      description: s.description ?? null,
      status: 'DRAFT',
      activeFrom: s.activeFrom ?? null,
      activeTo: s.activeTo ?? null,
      introMessage: s.introMessage ?? null,
      completionMessage: s.completionMessage,
      cancelKeywords: s.cancelKeywords,
      sessionTimeoutMinutes: s.sessionTimeoutMinutes,
      questions: reissueQuestionKeys(s.questions),
      structureVersion: 1,
      createdAt: policy.now,
      updatedAt: policy.now,
    };
  });

  const intentIndex = new Map(source.bundle.intents.map((i) => [i.id, i]));
  const intents: PlannedIntent[] = [...subset.ids.INTENT].map((oldId) => {
    const row = intentIndex.get(oldId)!;
    return {
      id: remap.get(oldId)!,
      name: row.name,
      nameNormalized: normalizeText(row.name),
      description: row.description ?? null,
      examples: row.examples,
      topicId: mapTopicId(row.topicId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const keywordIndex = new Map(source.bundle.keywords.map((k) => [k.id, k]));
  const keywords: PlannedKeyword[] = [...subset.ids.KEYWORD].map((oldId) => {
    const row = keywordIndex.get(oldId)!;
    return {
      id: remap.get(oldId)!,
      name: row.name,
      nameNormalized: normalizeText(row.name),
      description: row.description ?? null,
      synonyms: row.synonyms,
      topicId: mapTopicId(row.topicId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const homonymIndex = new Map(source.bundle.homonyms.map((h) => [h.id, h]));
  const homonyms: PlannedHomonym[] = [...subset.ids.HOMONYM].map((oldId) => {
    const row = homonymIndex.get(oldId)!;
    const rewrittenMeanings = rewriteIdLeaves(row.meanings, remap, sourceIdSet) as HomonymMeaning[];
    return {
      id: remap.get(oldId)!,
      word: row.word,
      wordNormalized: normalizeText(row.word),
      description: row.description ?? null,
      meanings: rewrittenMeanings,
      policy: row.policy,
      clarifyPrompt: row.clarifyPrompt ?? null,
      defaultMeaningIndex: row.defaultMeaningIndex ?? null,
      topicId: mapTopicId(row.topicId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const contextIndex = new Map(source.bundle.contexts.map((c) => [c.id, c]));
  const contexts: PlannedContext[] = [...subset.ids.CONTEXT].map((oldId) => {
    const row = contextIndex.get(oldId)!;
    const rewrittenSlots = rewriteIdLeaves(row.slots, remap, sourceIdSet) as ContextSlot[];
    return {
      id: remap.get(oldId)!,
      name: row.name,
      nameNormalized: normalizeText(row.name),
      description: row.description ?? null,
      slots: rewrittenSlots,
      completionMessage: row.completionMessage ?? null,
      cancelKeywords: row.cancelKeywords,
      sessionTimeoutMinutes: row.sessionTimeoutMinutes,
      topicId: mapTopicId(row.topicId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const faqIndex = new Map(source.bundle.faqs.map((f) => [f.id, f]));
  const faqs: PlannedFaq[] = [...subset.ids.FAQ].map((oldId) => {
    const row = faqIndex.get(oldId)!;
    return {
      id: remap.get(oldId)!,
      category: row.category,
      question: row.question,
      questionNormalized: normalizeText(row.question),
      answer: row.answer,
      altQuestions: row.altQuestions,
      enabled: row.enabled,
      topicId: mapTopicId(row.topicId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const nodeIndex = new Map(source.bundle.dialogNodes.map((n) => [n.id, n]));
  const nodes: PlannedNode[] = [...subset.ids.NODE].map((oldId) => {
    const row = nodeIndex.get(oldId)!;
    const rawOutputs = subset.trimmedOutputs.get(oldId) ?? row.outputs;
    const rewrittenOutputs = rewriteIdLeaves(rawOutputs, remap, sourceIdSet) as DialogOutput[];
    return {
      id: remap.get(oldId)!,
      name: row.name,
      nameNormalized: normalizeText(row.name),
      description: row.description ?? null,
      nodeType: row.nodeType,
      matchMode: row.matchMode,
      enabled: row.enabled,
      priority: row.priority,
      contextVariableId: row.contextVariableId ? (remap.get(row.contextVariableId) ?? null) : null,
      outputs: rewrittenOutputs,
      // 시스템 노드(START/FALLBACK)는 항상 공통(topicId=null) — §9.5 ④ 방어.
      topicId: row.nodeType === 'START' || row.nodeType === 'FALLBACK' ? null : mapTopicId(row.topicId),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  const nodeIntentPairs: TransferPlan['nodeIntentPairs'] = [];
  const nodeKeywordPairs: TransferPlan['nodeKeywordPairs'] = [];
  for (const oldNodeId of subset.ids.NODE) {
    const row = nodeIndex.get(oldNodeId)!;
    const newNodeId = remap.get(oldNodeId)!;
    for (const intentId of row.intentIds) {
      if (subset.ids.INTENT.has(intentId)) nodeIntentPairs.push({ nodeId: newNodeId, intentId: remap.get(intentId)! });
    }
    for (const keywordId of row.keywordIds) {
      if (subset.ids.KEYWORD.has(keywordId)) nodeKeywordPairs.push({ nodeId: newNodeId, keywordId: remap.get(keywordId)! });
    }
  }

  return {
    topics,
    surveys,
    contexts,
    intents,
    keywords,
    homonyms,
    faqs,
    nodes,
    nodeIntentPairs,
    nodeKeywordPairs,
    remap,
    sourceIdSet,
    report: { trimmedLinks: subset.trimmedLinks.length, followedSystemLinks: subset.followedSystemLinks.length },
  };
}
