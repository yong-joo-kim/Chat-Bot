import { computeContentHash } from './snapshot-canonical';
import { normalizeSnapshotTopics } from './snapshot-topic-normalize';
import type { SnapshotEnvelope } from './snapshot-envelope';

/**
 * §11.1 — 골든 해시(AC-TP6-1): 토픽 없는 챗봇(모든 자산 `topicId` 미기재)의 정규 해시는 도입 전과
 * 바이트 단위로 같다. 이 고정 문자열은 No.22 착수 시점의 코드로 계산한 값을 그대로 굳힌 것이다 —
 * 이후 어떤 리팩터링도 이 값을 바꾸면 안 된다(해시 계산에 관여하는 파일은 0건 변경이 원칙).
 */
const GOLDEN_HASH_TOPIC_LESS = '5613e073f4cb0b9471fd18c89f9f12fdc7d8a0f6eed52eb8b22d6ad5e361300a';

function buildFixtureEnvelope(withTopicId: boolean): SnapshotEnvelope {
  const topicIdField = withTopicId ? { topicId: undefined } : {};
  return {
    schemaVersion: 1,
    capturedAt: '2026-01-01T00:00:00.000Z',
    chatbotId: 'chatbot-fixture',
    assets: {
      intents: [{ id: 'intent-1', name: '인사', examples: ['안녕', '안녕하세요'], createdAt: new Date('2026-01-01T00:00:00.000Z'), ...topicIdField }],
      keywords: [{ id: 'keyword-1', name: '환불', synonyms: ['refund'], createdAt: new Date('2026-01-01T00:00:00.000Z'), ...topicIdField }],
      homonyms: [
        {
          id: 'homonym-1',
          word: '배',
          meanings: [
            { label: '과일', contextHints: [] },
            { label: '신체', contextHints: [] },
          ],
          policy: 'ASK',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          ...topicIdField,
        },
      ],
      dialogNodes: [
        {
          id: 'node-1',
          name: '시작',
          nodeType: 'START',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: [],
          keywordIds: [],
          outputs: [{ type: 'TEXT', payload: { text: '안녕하세요' } }],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          ...topicIdField,
        },
      ],
      contexts: [
        {
          id: 'context-1',
          name: '배송조회',
          slots: [{ name: 'order_no', label: '주문번호', prompt: '주문번호를 입력해 주세요.', type: 'TEXT', required: true, maxRetry: 2 }],
          cancelKeywords: ['취소'],
          sessionTimeoutMinutes: 30,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          ...topicIdField,
        },
      ],
      faqs: [
        { id: 'faq-1', category: 'FAQ', question: '영업시간이 어떻게 되나요?', answer: '평일 9시~18시입니다.', altQuestions: [], enabled: true, createdAt: new Date('2026-01-01T00:00:00.000Z'), ...topicIdField },
      ],
    },
    answerSetting: null,
    profile: { name: '골든챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' } },
  } as unknown as SnapshotEnvelope;
}

describe('§11.1 — 골든 해시: 토픽 없는 챗봇의 contentHash는 도입 전과 바이트 동일', () => {
  it('topicId 키가 아예 없는 봉투의 해시가 고정값과 같다', () => {
    expect(computeContentHash(buildFixtureEnvelope(false))).toBe(GOLDEN_HASH_TOPIC_LESS);
  });

  it('topicId: undefined 키가 있는 봉투(row.topicId ?? undefined의 결과 형태)도 같은 해시를 낸다(undefined 키는 직렬화에서 생략된다)', () => {
    expect(computeContentHash(buildFixtureEnvelope(true))).toBe(GOLDEN_HASH_TOPIC_LESS);
  });
});

describe('normalizeSnapshotTopics — topic-system-설계.md §11.2', () => {
  const envelope = buildFixtureEnvelope(false);

  it('없는 토픽을 가리키는 자산은 topicId가 제거된다(공통으로)', () => {
    const withMissingTopic: SnapshotEnvelope = {
      ...envelope,
      assets: { ...envelope.assets, intents: [{ ...envelope.assets.intents[0], topicId: 'ghost-topic' }] },
    };
    const result = normalizeSnapshotTopics(withMissingTopic, new Set(['real-topic']));
    expect(result.changed).toBe(true);
    expect(result.missingCount).toBe(1);
    expect(result.envelope.assets.intents[0].topicId).toBeUndefined();
  });

  it('존재하는 토픽을 가리키는 자산은 그대로 둔다', () => {
    const withRealTopic: SnapshotEnvelope = {
      ...envelope,
      assets: { ...envelope.assets, intents: [{ ...envelope.assets.intents[0], topicId: 'real-topic' }] },
    };
    const result = normalizeSnapshotTopics(withRealTopic, new Set(['real-topic']));
    expect(result.changed).toBe(false);
    expect(result.missingCount).toBe(0);
    expect(result.envelope).toBe(withRealTopic);
  });

  it('START/FALLBACK 노드는 토픽이 존재하더라도 무조건 topicId를 제거한다(방어)', () => {
    const withSystemNodeTopic: SnapshotEnvelope = {
      ...envelope,
      assets: { ...envelope.assets, dialogNodes: [{ ...envelope.assets.dialogNodes[0], nodeType: 'START', topicId: 'real-topic' }] },
    };
    const result = normalizeSnapshotTopics(withSystemNodeTopic, new Set(['real-topic']));
    expect(result.changed).toBe(true);
    expect(result.envelope.assets.dialogNodes[0].topicId).toBeUndefined();
  });

  it('변경이 없으면 changed=false이고 missingCount=0이다(불필요한 해시 재계산 방지)', () => {
    const result = normalizeSnapshotTopics(envelope, new Set());
    expect(result.changed).toBe(false);
    expect(result.missingCount).toBe(0);
    expect(result.envelope).toBe(envelope);
  });
});
