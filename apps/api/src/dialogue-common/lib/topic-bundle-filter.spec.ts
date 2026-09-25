import { filterInactiveTopicAssets } from './topic-bundle-filter';
import type { DialogueBundle } from '@chat-bot/shared-types';

function baseBundle(): DialogueBundle {
  return {
    intents: [
      { id: 'i1', chatbotId: 'c1', name: 'i1', examples: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'i2', chatbotId: 'c1', name: 'i2', examples: [], topicId: 't-inactive', createdAt: new Date(), updatedAt: new Date() },
    ],
    keywords: [{ id: 'k1', chatbotId: 'c1', name: 'k1', synonyms: [], topicId: 't-inactive', createdAt: new Date(), updatedAt: new Date() }],
    homonyms: [{ id: 'h1', chatbotId: 'c1', word: 'h1', meanings: [{ label: 'a', contextHints: [] }, { label: 'b', contextHints: [] }], policy: 'ASK', topicId: 't-inactive', createdAt: new Date(), updatedAt: new Date() }],
    dialogNodes: [
      { id: 'n1', chatbotId: 'c1', name: 'n1', nodeType: 'NORMAL', matchMode: 'ANY', enabled: true, priority: 100, intentIds: [], keywordIds: [], outputs: [], createdAt: new Date(), updatedAt: new Date() },
      { id: 'n2', chatbotId: 'c1', name: 'n2', nodeType: 'NORMAL', matchMode: 'ANY', enabled: true, priority: 100, intentIds: [], keywordIds: [], outputs: [], topicId: 't-inactive', createdAt: new Date(), updatedAt: new Date() },
    ],
    contexts: [{ id: 'ctx1', chatbotId: 'c1', name: 'ctx1', slots: [], cancelKeywords: [], sessionTimeoutMinutes: 30, topicId: 't-inactive', createdAt: new Date(), updatedAt: new Date() }],
    faqs: [
      { id: 'f1', chatbotId: 'c1', category: 'FAQ', question: 'f1', answer: 'a', altQuestions: [], enabled: true, createdAt: new Date(), updatedAt: new Date() },
      { id: 'f2', chatbotId: 'c1', category: 'FAQ', question: 'f2', answer: 'a', altQuestions: [], enabled: true, topicId: 't-inactive', createdAt: new Date(), updatedAt: new Date() },
    ],
  };
}

describe('filterInactiveTopicAssets — topic-system-설계.md §6.1', () => {
  it('비활성 집합이 비었으면 입력 객체를 그대로 반환한다(참조 동일 — 바이트 동일 보증)', () => {
    const bundle = baseBundle();
    const result = filterInactiveTopicAssets(bundle, new Set());
    expect(result).toBe(bundle);
  });

  it('노드·의도·FAQ만 제거하고 키워드·컨텍스트·동음이의어는 그대로 유지한다', () => {
    const bundle = baseBundle();
    const result = filterInactiveTopicAssets(bundle, new Set(['t-inactive']));

    expect(result.intents.map((i) => i.id)).toEqual(['i1']);
    expect(result.dialogNodes.map((n) => n.id)).toEqual(['n1']);
    expect(result.faqs.map((f) => f.id)).toEqual(['f1']);
    // 사전형 자산은 유지된다(§1.6).
    expect(result.keywords).toBe(bundle.keywords);
    expect(result.contexts).toBe(bundle.contexts);
    expect(result.homonyms).toBe(bundle.homonyms);
  });

  it('공통(topicId 없음) 자산은 항상 살아남는다', () => {
    const bundle = baseBundle();
    const result = filterInactiveTopicAssets(bundle, new Set(['t-inactive']));
    expect(result.intents.some((i) => i.id === 'i1')).toBe(true);
  });
});
