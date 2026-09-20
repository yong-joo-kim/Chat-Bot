import type { DialogNode, DialogueBundle, HomonymDictionary } from '@chat-bot/shared-types';
import { normalizeText } from './normalize';
import { rankNodes } from './node-matcher';

export interface ExampleEntry {
  intentId: string;
  norm: string;
  original: string;
}

export interface FaqTextEntry {
  faqId: string;
  norm: string;
}

export interface KeywordTermEntry {
  keywordId: string;
  norm: string;
}

/** 사전 인덱싱 결과(FR-E-10). 정규화 결과를 캐시해 매 요청마다 반복 정규화를 피한다. */
export interface DialogueIndex {
  exampleExact: Map<string, string[]>;
  examplePartial: ExampleEntry[];
  faqExact: Map<string, string[]>;
  faqPartial: FaqTextEntry[];
  keywordTerms: KeywordTermEntry[];
  nodesRanked: DialogNode[];
  homonymWords: Map<string, HomonymDictionary>;
  /** 노드 id → 노드 O(1) 조회(FR-E2-1, `resolveByNodeId` 전용). enabled 여부와 무관하게 전부 담는다. */
  nodesById: Map<string, DialogNode>;
}

function pushToMap(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** 챗봇 1건의 대화 자산 번들로부터 정규화 인덱스를 구축한다(§7.8, AC-E-12). */
export function buildDialogueIndex(bundle: DialogueBundle): DialogueIndex {
  const exampleExact = new Map<string, string[]>();
  const examplePartial: ExampleEntry[] = [];
  for (const intent of bundle.intents) {
    for (const example of intent.examples) {
      const norm = normalizeText(example);
      if (!norm) continue;
      pushToMap(exampleExact, norm, intent.id);
      examplePartial.push({ intentId: intent.id, norm, original: example });
    }
  }

  const faqExact = new Map<string, string[]>();
  const faqPartial: FaqTextEntry[] = [];
  for (const faq of bundle.faqs) {
    if (faq.enabled === false) continue;
    const candidates = [faq.question, ...(faq.altQuestions ?? [])];
    for (const candidate of candidates) {
      const norm = normalizeText(candidate);
      if (!norm) continue;
      pushToMap(faqExact, norm, faq.id);
      faqPartial.push({ faqId: faq.id, norm });
    }
  }

  const keywordTerms: KeywordTermEntry[] = [];
  for (const keyword of bundle.keywords) {
    for (const term of [keyword.name, ...keyword.synonyms]) {
      const norm = normalizeText(term);
      if (norm) keywordTerms.push({ keywordId: keyword.id, norm });
    }
  }

  const homonymWords = new Map<string, HomonymDictionary>();
  for (const dict of bundle.homonyms) {
    homonymWords.set(normalizeText(dict.word), dict);
  }

  const nodesById = new Map<string, DialogNode>();
  for (const node of bundle.dialogNodes) {
    nodesById.set(node.id, node);
  }

  return {
    exampleExact,
    examplePartial,
    faqExact,
    faqPartial,
    keywordTerms,
    nodesRanked: rankNodes(bundle.dialogNodes),
    homonymWords,
    nodesById,
  };
}
