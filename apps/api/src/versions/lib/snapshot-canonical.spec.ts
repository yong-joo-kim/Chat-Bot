import { canonicalizeSnapshot, computeContentHash, serializeEnvelopeForStorage, sortKeysDeep } from './snapshot-canonical';
import type { SnapshotEnvelope } from './snapshot-envelope';

function baseEnvelope(): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: '2026-01-01T00:00:00.000Z',
    chatbotId: 'cb-1',
    assets: {
      intents: [
        { id: 'b', name: 'B의도', examples: ['b1', 'b2'], createdAt: new Date('2026-01-01') as unknown as Date },
        { id: 'a', name: 'A의도', examples: ['a1'], createdAt: new Date('2026-01-01') as unknown as Date },
      ],
      keywords: [],
      homonyms: [],
      dialogNodes: [
        {
          id: 'n1',
          name: '노드1',
          nodeType: 'NORMAL',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: ['b', 'a'],
          keywordIds: [],
          outputs: [],
          createdAt: new Date('2026-01-01') as unknown as Date,
        },
      ],
      contexts: [],
      faqs: [],
    },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#000000', headerTitle: 'h' } },
  } as unknown as SnapshotEnvelope;
}

describe('snapshot-canonical — §5.2 정규 직렬화 · contentHash', () => {
  it('AC-H1-5: 키 순서·엔터티 순서·intentIds 순서가 달라도 같은 해시다', () => {
    const e1 = baseEnvelope();
    const e2 = baseEnvelope();
    // 엔터티 순서를 뒤집고 조인 배열 순서도 바꾼다.
    e2.assets.intents = [...e2.assets.intents].reverse();
    e2.assets.dialogNodes = e2.assets.dialogNodes.map((n) => ({ ...n, intentIds: [...n.intentIds].reverse() }));

    expect(computeContentHash(e1)).toBe(computeContentHash(e2));
  });

  it('AC-H1-6: 값 배열(예문) 순서만 바뀌면 다른 해시다(순서에 의미가 있다)', () => {
    const e1 = baseEnvelope();
    const e2 = baseEnvelope();
    e2.assets.intents = e2.assets.intents.map((i) => (i.id === 'b' ? { ...i, examples: [...i.examples].reverse() } : i));

    expect(computeContentHash(e1)).not.toBe(computeContentHash(e2));
  });

  it('타임스탬프(capturedAt·schemaVersion·chatbotId)가 달라도 해시가 같다(해시 범위 밖)', () => {
    const e1 = baseEnvelope();
    const e2 = { ...baseEnvelope(), capturedAt: '2030-05-05T00:00:00.000Z', chatbotId: 'other-chatbot' };

    expect(computeContentHash(e1)).toBe(computeContentHash(e2));
  });

  it('M-2: 항목별 createdAt만 달라도 해시가 같다(§5.2 "모든 createdAt/updatedAt 제외")', () => {
    const e1 = baseEnvelope();
    const e2 = baseEnvelope();
    const laterCreatedAt = new Date('2030-05-05T00:00:00.000Z') as unknown as Date;
    e2.assets.intents = e2.assets.intents.map((i) => ({ ...i, createdAt: laterCreatedAt }));
    e2.assets.dialogNodes = e2.assets.dialogNodes.map((n) => ({ ...n, createdAt: laterCreatedAt }));

    expect(computeContentHash(e1)).toBe(computeContentHash(e2));
  });

  it('M-2: id만 같고 나머지가 다른 두 항목은 다른 해시다(id는 해시 범위에 남는다 — 정체성 구분)', () => {
    const e1 = baseEnvelope();
    const e2 = baseEnvelope();
    e2.assets.intents = e2.assets.intents.map((i) => (i.id === 'a' ? { ...i, id: 'z' } : i));

    expect(computeContentHash(e1)).not.toBe(computeContentHash(e2));
  });

  it('저장 문자열(serializeEnvelopeForStorage)에서 재계산한 해시가 원본과 같다(§5.4 ③ 왕복)', () => {
    const e1 = baseEnvelope();
    const stored = serializeEnvelopeForStorage(e1);
    const reparsed = JSON.parse(stored) as SnapshotEnvelope;
    expect(computeContentHash(reparsed)).toBe(computeContentHash(e1));
  });

  it('canonicalizeSnapshot 출력은 결정적이다(같은 입력 → 같은 문자열)', () => {
    const e1 = baseEnvelope();
    expect(canonicalizeSnapshot(e1)).toBe(canonicalizeSnapshot(baseEnvelope()));
  });

  describe('sortKeysDeep — L-2 방어 코드(비-순수객체는 예외)', () => {
    it('일반 객체·배열·Date·원시값은 정상적으로 처리된다', () => {
      expect(sortKeysDeep({ b: 1, a: 2 })).toEqual({ a: 2, b: 1 });
      expect(sortKeysDeep([1, 2, 3])).toEqual([1, 2, 3]);
      expect(sortKeysDeep(null)).toBeNull();
      expect(sortKeysDeep('text')).toBe('text');
      expect(sortKeysDeep(42)).toBe(42);
      const date = new Date('2026-01-01T00:00:00.000Z');
      expect(sortKeysDeep(date)).toBe(date);
      // Object.create(null) 객체(프로토타입 없음)도 순수 객체로 취급한다.
      const nullProtoObj = Object.create(null) as Record<string, unknown>;
      nullProtoObj.x = 1;
      expect(sortKeysDeep(nullProtoObj)).toEqual({ x: 1 });
    });

    it('Buffer가 섞여 있으면 조용히 손상시키지 않고 예외를 던진다', () => {
      expect(() => sortKeysDeep(Buffer.from('binary'))).toThrow(/지원하지 않는 객체 타입/);
      expect(() => sortKeysDeep({ vector: Buffer.from('x') })).toThrow(/지원하지 않는 객체 타입/);
    });

    it('Map/Set/Uint8Array가 섞여 있어도 예외를 던진다(값 배열의 순서 의미를 조용히 잃지 않는다)', () => {
      expect(() => sortKeysDeep(new Map([['a', 1]]))).toThrow(/지원하지 않는 객체 타입/);
      expect(() => sortKeysDeep(new Set([1, 2]))).toThrow(/지원하지 않는 객체 타입/);
      expect(() => sortKeysDeep(new Uint8Array([1, 2, 3]))).toThrow(/지원하지 않는 객체 타입/);
    });
  });
});
