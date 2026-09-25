import type { DialogueBundle } from '@chat-bot/shared-types';
import { validateTopicBoundaries } from './topic-boundary';
import type { TopicRow } from './topic-boundary';

function emptyBundle(): DialogueBundle {
  return { intents: [], keywords: [], homonyms: [], dialogNodes: [], contexts: [], faqs: [] };
}

describe('validateTopicBoundaries — topic-system-설계.md §7.2 (AC-TP4-1)', () => {
  it('토픽이 0개인 챗봇은 규칙을 실행하지 않고 빈 배열을 반환한다(AC-TP4-4)', () => {
    const result = validateTopicBoundaries(emptyBundle(), []);
    expect(result.issues).toEqual([]);
    expect(result.ruleTotals).toBeUndefined();
  });

  it('규칙 ① — live 범위 노드가 비활성 토픽 의도를 조건으로 쓰면 INACTIVE_TOPIC_REFERENCE 경고를 낸다', () => {
    const topics: TopicRow[] = [{ id: 't1', name: '보험청구', enabled: false }];
    const bundle: DialogueBundle = {
      ...emptyBundle(),
      intents: [{ id: 'i1', chatbotId: 'c1', name: '보험청구의도', examples: [], topicId: 't1', createdAt: new Date(), updatedAt: new Date() }],
      dialogNodes: [
        {
          id: 'n1',
          chatbotId: 'c1',
          name: '공통노드',
          nodeType: 'NORMAL',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: ['i1'],
          keywordIds: [],
          outputs: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    const result = validateTopicBoundaries(bundle, topics);
    expect(result.issues.some((i) => i.code === 'INACTIVE_TOPIC_REFERENCE' && i.severity === 'WARNING')).toBe(true);
  });

  it('규칙 ④ — 토픽이 있고 live 범위에 활성 노드·FAQ가 0건이면 NO_LIVE_ENTRY_POINT를 낸다', () => {
    const topics: TopicRow[] = [{ id: 't1', name: '보험청구', enabled: false }];
    const bundle: DialogueBundle = {
      ...emptyBundle(),
      dialogNodes: [
        {
          id: 'n1',
          chatbotId: 'c1',
          name: '비활성토픽전용노드',
          nodeType: 'NORMAL',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: [],
          keywordIds: [],
          outputs: [],
          topicId: 't1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    };
    const result = validateTopicBoundaries(bundle, topics);
    expect(result.issues.some((i) => i.code === 'NO_LIVE_ENTRY_POINT')).toBe(true);
  });

  it('규칙 ③ — 토픽 키가 다른 두 의도가 같은 정규화 예문을 가지면 CROSS_TOPIC_DUPLICATE_EXAMPLE을 낸다(같은 키끼리는 제외)', () => {
    const topics: TopicRow[] = [{ id: 't1', name: '배송', enabled: true }];
    const bundle: DialogueBundle = {
      ...emptyBundle(),
      intents: [
        { id: 'i1', chatbotId: 'c1', name: '공통의도', examples: ['환불하고 싶어요'], createdAt: new Date(), updatedAt: new Date() },
        { id: 'i2', chatbotId: 'c1', name: '배송의도', examples: ['환불하고 싶어요'], topicId: 't1', createdAt: new Date(), updatedAt: new Date() },
      ],
    };
    const result = validateTopicBoundaries(bundle, topics);
    const issue = result.issues.find((i) => i.code === 'CROSS_TOPIC_DUPLICATE_EXAMPLE');
    expect(issue).toBeDefined();
    // [L-2 코드리뷰 대응] 이 관계는 노드→의도 참조가 아니다 — 전용 edge 값을 쓴다(NODE_INTENT 오분류 방지).
    expect(issue?.topicRef?.edge).toBe('INTENT_DUPLICATE_EXAMPLE');
  });
});
