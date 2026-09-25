import { hydrateForServing, hasPotentialNodeTies } from './snapshot-serving';
import { computeContentHash, computeTiebreakHash } from './snapshot-canonical';
import type { SnapshotEnvelope } from './snapshot-envelope';

const CHATBOT_ID = '00000000-0000-4000-8000-000000000000';
const IDS: Record<string, string> = {
  a: '00000000-0000-4000-8000-00000000000a',
  b: '00000000-0000-4000-8000-00000000000b',
  c: '00000000-0000-4000-8000-00000000000c',
  m: '00000000-0000-4000-8000-00000000000d',
  z: '00000000-0000-4000-8000-00000000000e',
  unknown: '00000000-0000-4000-8000-00000000000f',
};

function node(key: string, overrides: Record<string, unknown> = {}) {
  return {
    id: IDS[key],
    name: `노드-${key}`,
    nodeType: 'NORMAL',
    matchMode: 'ANY',
    enabled: true,
    priority: 100,
    // 조건 1개 이상 필수(checkNodeConditionsAndOutputs) — 기본은 키워드 조건 1개.
    intentIds: [],
    keywordIds: [IDS.a],
    outputs: [{ type: 'TEXT', payload: { text: '응답' } }],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function baseEnvelope(dialogNodes: unknown[]): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: '2026-02-01T00:00:00.000Z',
    chatbotId: CHATBOT_ID,
    assets: {
      intents: [],
      keywords: [],
      homonyms: [],
      dialogNodes,
      contexts: [],
      faqs: [],
    },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#000000', headerTitle: 'h' } },
  } as unknown as SnapshotEnvelope;
}

describe('hasPotentialNodeTies — §6.2 (priority, 조건 수, matchMode) 동점 표', () => {
  it('활성 노드 2개가 (priority, 조건수, matchMode)까지 같으면 true다', () => {
    const nodes = [node('a', { priority: 100, intentIds: [IDS.a] }), node('b', { priority: 100, intentIds: [IDS.b] })] as never;
    expect(hasPotentialNodeTies(nodes)).toBe(true);
  });

  it('priority가 다르면 동점이 아니다', () => {
    const nodes = [node('a', { priority: 100 }), node('b', { priority: 90 })] as never;
    expect(hasPotentialNodeTies(nodes)).toBe(false);
  });

  it('조건 수가 다르면(intentIds 개수) 동점이 아니다', () => {
    const nodes = [node('a', { intentIds: [IDS.a] }), node('b', { intentIds: [] })] as never;
    expect(hasPotentialNodeTies(nodes)).toBe(false);
  });

  it('matchMode가 다르면 동점이 아니다', () => {
    const nodes = [node('a', { matchMode: 'ANY' }), node('b', { matchMode: 'ALL' })] as never;
    expect(hasPotentialNodeTies(nodes)).toBe(false);
  });

  it('비활성 노드는 동점 판정에서 제외된다', () => {
    const nodes = [node('a', { priority: 100 }), node('b', { priority: 100, enabled: false })] as never;
    expect(hasPotentialNodeTies(nodes)).toBe(false);
  });

  it('노드가 0/1개면 동점이 아니다', () => {
    expect(hasPotentialNodeTies([])).toBe(false);
    expect(hasPotentialNodeTies([node('a')] as never)).toBe(false);
  });
});

describe('hydrateForServing — §6.2 C-1 서빙 역직렬화', () => {
  it('tiebreak 보조 필드가 있으면 노드 updatedAt을 그 값으로 복원하고 legacyTiebreak=false다', () => {
    const nodes = [node('a'), node('b')];
    const envelope = baseEnvelope(nodes);
    envelope.tiebreak = { nodeUpdatedAt: { [IDS.a]: '2026-01-05T00:00:00.000Z', [IDS.b]: '2026-01-06T00:00:00.000Z' } };

    const result = hydrateForServing(envelope, CHATBOT_ID);
    const a = result.bundle.dialogNodes.find((n) => n.id === IDS.a)!;
    const b = result.bundle.dialogNodes.find((n) => n.id === IDS.b)!;
    expect(a.updatedAt.toISOString()).toBe('2026-01-05T00:00:00.000Z');
    expect(b.updatedAt.toISOString()).toBe('2026-01-06T00:00:00.000Z');
    expect(result.legacyTiebreak).toBe(false);
  });

  it('보조 필드가 없는 노드는 capturedAt으로 폴백한다(맵에 없는 id)', () => {
    const nodes = [node('a'), node('unknown')];
    const envelope = baseEnvelope(nodes);
    envelope.tiebreak = { nodeUpdatedAt: { [IDS.a]: '2026-01-05T00:00:00.000Z' } };

    const result = hydrateForServing(envelope, CHATBOT_ID);
    const unknown = result.bundle.dialogNodes.find((n) => n.id === IDS.unknown)!;
    expect(unknown.updatedAt.toISOString()).toBe(envelope.capturedAt);
  });

  it('과거 스냅샷(tiebreak 없음)은 capturedAt을 쓰고, 동점 가능한 노드가 있으면 legacyTiebreak=true다(LEGACY_TIEBREAK)', () => {
    const nodes = [node('a', { priority: 100 }), node('b', { priority: 100 })];
    const envelope = baseEnvelope(nodes);
    // tiebreak 필드를 설정하지 않는다(과거 스냅샷).

    const result = hydrateForServing(envelope, CHATBOT_ID);
    expect(result.legacyTiebreak).toBe(true);
    expect(result.bundle.dialogNodes.every((n) => n.updatedAt.toISOString() === envelope.capturedAt)).toBe(true);
  });

  it('과거 스냅샷이라도 동점 가능성이 없으면 legacyTiebreak=false다', () => {
    const nodes = [node('a', { priority: 100 }), node('b', { priority: 50 })];
    const envelope = baseEnvelope(nodes);
    const result = hydrateForServing(envelope, CHATBOT_ID);
    expect(result.legacyTiebreak).toBe(false);
  });

  it('★ 발견 제약 ① — 6종 배열을 createdAt asc, id asc로 재정렬한다(라이브 build() K-1과 동치)', () => {
    const nodes = [
      node('z', { createdAt: new Date('2026-01-03T00:00:00.000Z') }),
      node('a', { createdAt: new Date('2026-01-01T00:00:00.000Z') }),
      node('m', { createdAt: new Date('2026-01-02T00:00:00.000Z') }),
    ];
    const envelope = baseEnvelope(nodes);
    const result = hydrateForServing(envelope, CHATBOT_ID);
    expect(result.bundle.dialogNodes.map((n) => n.id)).toEqual([IDS.a, IDS.m, IDS.z]);
  });

  it('createdAt이 같으면 id asc로 2차 정렬한다(라이브와 같은 2차 키)', () => {
    const same = new Date('2026-01-01T00:00:00.000Z');
    const nodes = [node('c', { createdAt: same }), node('a', { createdAt: same }), node('b', { createdAt: same })];
    const envelope = baseEnvelope(nodes);
    const result = hydrateForServing(envelope, CHATBOT_ID);
    expect(result.bundle.dialogNodes.map((n) => n.id)).toEqual([IDS.a, IDS.b, IDS.c]);
  });

  it('설문 없는 번들을 반환한다(surveys: [])', () => {
    const envelope = baseEnvelope([node('a')]);
    const result = hydrateForServing(envelope, CHATBOT_ID);
    expect(result.bundle.surveys).toEqual([]);
  });
});

describe('tiebreak은 해시 범위 밖이다(§6.1) — contentHash 불변, tiebreakHash만 별도', () => {
  it('tiebreak 유무와 무관하게 contentHash가 같다', () => {
    const withoutTiebreak = baseEnvelope([node('a')]);
    const withTiebreak: SnapshotEnvelope = { ...withoutTiebreak, tiebreak: { nodeUpdatedAt: { [IDS.a]: '2026-01-05T00:00:00.000Z' } } };
    expect(computeContentHash(withoutTiebreak)).toBe(computeContentHash(withTiebreak));
  });

  it('computeTiebreakHash는 tiebreak이 없으면 null, 있으면 sha256이다', () => {
    const withoutTiebreak = baseEnvelope([node('a')]);
    expect(computeTiebreakHash(withoutTiebreak)).toBeNull();

    const withTiebreak: SnapshotEnvelope = { ...withoutTiebreak, tiebreak: { nodeUpdatedAt: { [IDS.a]: '2026-01-05T00:00:00.000Z' } } };
    const hash = computeTiebreakHash(withTiebreak);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('nodeUpdatedAt 값이 다르면 tiebreakHash도 다르다', () => {
    const e1: SnapshotEnvelope = { ...baseEnvelope([node('a')]), tiebreak: { nodeUpdatedAt: { [IDS.a]: '2026-01-05T00:00:00.000Z' } } };
    const e2: SnapshotEnvelope = { ...baseEnvelope([node('a')]), tiebreak: { nodeUpdatedAt: { [IDS.a]: '2026-01-06T00:00:00.000Z' } } };
    expect(computeTiebreakHash(e1)).not.toBe(computeTiebreakHash(e2));
  });
});
