import { buildRefNameResolver, diffItemFields, diffSnapshots, itemEquals } from './version-diff';
import type { SnapshotEnvelope } from './snapshot-envelope';
import type { DiffEntity } from './version-diff';

const NOW = '2026-01-01T00:00:00.000Z';

function envelope(intents: Array<{ id: string; name: string; examples: string[] }>): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: NOW,
    chatbotId: 'cb',
    assets: {
      intents: intents.map((i) => ({ ...i, createdAt: NOW })) as unknown as SnapshotEnvelope['assets']['intents'],
      keywords: [],
      homonyms: [],
      dialogNodes: [],
      contexts: [],
      faqs: [],
    },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: 'h' } },
  };
}

interface FullEnvelopeOverrides {
  intents?: Array<{ id: string; name: string }>;
  keywords?: Array<{ id: string; name: string }>;
  dialogNodes?: Array<Record<string, unknown> & { id: string }>;
}

function fullEnvelope(overrides: FullEnvelopeOverrides = {}): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: NOW,
    chatbotId: 'cb',
    assets: {
      intents: (overrides.intents ?? []).map((i) => ({ ...i, examples: [], createdAt: NOW })) as unknown as SnapshotEnvelope['assets']['intents'],
      keywords: (overrides.keywords ?? []).map((k) => ({ ...k, synonyms: [], createdAt: NOW })) as unknown as SnapshotEnvelope['assets']['keywords'],
      homonyms: [],
      dialogNodes: (overrides.dialogNodes ?? []).map((n) => ({
        nodeType: 'NORMAL',
        matchMode: 'ANY',
        enabled: true,
        priority: 0,
        intentIds: [],
        keywordIds: [],
        outputs: [],
        createdAt: NOW,
        ...n,
      })) as unknown as SnapshotEnvelope['assets']['dialogNodes'],
      contexts: [],
      faqs: [],
    },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: 'h' } },
  };
}

describe('version-diff — §7.2 diffSnapshots', () => {
  it('AC-H2-1: 종류별 추가/삭제/변경 건수를 요약한다', () => {
    const base = envelope([
      { id: 'a', name: 'A', examples: ['x'] },
      { id: 'b', name: 'B', examples: ['y'] },
    ]);
    const target = envelope([
      { id: 'a', name: 'A', examples: ['x', 'z'] }, // modified
      { id: 'c', name: 'C', examples: [] }, // added ('b' removed)
    ]);

    const result = diffSnapshots(base, target, 0, 0);
    const intentRow = result.summary.rows.find((r) => r.kind === 'INTENT')!;
    expect(intentRow).toEqual({ kind: 'INTENT', added: 1, removed: 1, modified: 1 });
    expect(result.summary.identical).toBe(false);
  });

  it('AC-H2-2: [a,b,c]→[a,c,d] 값 집합 차이는 +d −b다(순서 변경 자체는 무시, 집합 비교)', () => {
    const base = envelope([{ id: 'a', name: 'A', examples: ['a', 'b', 'c'] }]);
    const target = envelope([{ id: 'a', name: 'A', examples: ['a', 'c', 'd'] }]);

    expect(itemEquals('INTENT', base.assets.intents[0] as never, target.assets.intents[0] as never)).toBe(false);

    const result = diffSnapshots(base, target, 0, 0);
    const item = result.items.find((i) => i.kind === 'INTENT' && i.change === 'MODIFIED');
    expect(item).toBeDefined();
    expect(item!.changedFields).toContain('examples');
  });

  it('AC-H2-3: 같은 이름으로 재생성된 항목(삭제+추가)에 recreated 힌트가 양방향으로 붙는다', () => {
    const base = envelope([{ id: 'old-id', name: '환불규정문의', examples: [] }]);
    const target = envelope([{ id: 'new-id', name: '환불규정문의', examples: ['새 예문'] }]);

    const result = diffSnapshots(base, target, 0, 0);
    const removed = result.items.find((i) => i.id === 'old-id')!;
    const added = result.items.find((i) => i.id === 'new-id')!;
    expect(removed.change).toBe('REMOVED');
    expect(added.change).toBe('ADDED');
    expect(removed.recreated).toEqual({ counterpartId: 'new-id' });
    expect(added.recreated).toEqual({ counterpartId: 'old-id' });
  });

  it('완전히 동일한 두 스냅샷은 identical:true, totalChanged:0이다', () => {
    const base = envelope([{ id: 'a', name: 'A', examples: ['x'] }]);
    const target = envelope([{ id: 'a', name: 'A', examples: ['x'] }]);

    const result = diffSnapshots(base, target, 0, 0);
    expect(result.summary.identical).toBe(true);
    expect(result.summary.totalChanged).toBe(0);
    expect(result.items).toEqual([]);
  });

  it('INTEGRITY_WARNING 행은 base/target 무결성 경고 건수를 담는다', () => {
    const base = envelope([]);
    const target = envelope([]);
    const result = diffSnapshots(base, target, 3, 5);
    const row = result.summary.rows.find((r) => r.kind === 'INTEGRITY_WARNING')!;
    expect(row).toEqual({ kind: 'INTEGRITY_WARNING', added: 5, removed: 3, modified: 0 });
  });

  describe('REF_SET(§7.3, FR-H2-8, H-1) — 노드 intentIds/keywordIds 필드 상세', () => {
    it('추가/제거된 참조 id가 정확히 계산된다', () => {
      const before: DiffEntity = { id: 'n1', name: '노드1', intentIds: ['i1', 'i2'], keywordIds: [] };
      const after: DiffEntity = { id: 'n1', name: '노드1', intentIds: ['i2', 'i3'], keywordIds: [] };
      const base = fullEnvelope({ intents: [{ id: 'i1', name: 'A' }, { id: 'i2', name: 'B' }, { id: 'i3', name: 'C' }] });
      const target = base;
      const resolver = buildRefNameResolver(base, target);

      const fields = diffItemFields('NODE', before, after, resolver);
      const intentIdsField = fields.find((f) => f.field === 'intentIds' && f.type === 'REF_SET');
      expect(intentIdsField).toMatchObject({
        type: 'REF_SET',
        added: [{ id: 'i3', name: 'C' }],
        removed: [{ id: 'i1', name: 'A' }],
      });
    });

    it('이름 해석은 target → base 순이다(같은 id가 두 스냅샷에서 이름이 다르면 target 이름을 쓴다)', () => {
      const before: DiffEntity = { id: 'n1', name: '노드1', intentIds: [], keywordIds: ['k1'] };
      const after: DiffEntity = { id: 'n1', name: '노드1', intentIds: [], keywordIds: [] };
      const base = fullEnvelope({ keywords: [{ id: 'k1', name: '구이름' }] });
      const target = fullEnvelope({ keywords: [{ id: 'k1', name: '새이름' }] });
      const resolver = buildRefNameResolver(base, target);

      const fields = diffItemFields('NODE', before, after, resolver);
      const keywordIdsField = fields.find((f) => f.field === 'keywordIds' && f.type === 'REF_SET');
      expect(keywordIdsField).toMatchObject({ type: 'REF_SET', removed: [{ id: 'k1', name: '새이름' }] });
    });

    it('target에 없고 base에만 있으면 base 이름으로 해석한다(폴백)', () => {
      const before: DiffEntity = { id: 'n1', name: '노드1', intentIds: [], keywordIds: ['k1'] };
      const after: DiffEntity = { id: 'n1', name: '노드1', intentIds: [], keywordIds: [] };
      const base = fullEnvelope({ keywords: [{ id: 'k1', name: '삭제된키워드' }] });
      const target = fullEnvelope({ keywords: [] }); // k1이 target에서 완전히 삭제됨
      const resolver = buildRefNameResolver(base, target);

      const fields = diffItemFields('NODE', before, after, resolver);
      const keywordIdsField = fields.find((f) => f.field === 'keywordIds' && f.type === 'REF_SET');
      expect(keywordIdsField).toMatchObject({ type: 'REF_SET', removed: [{ id: 'k1', name: '삭제된키워드' }] });
    });

    it('양쪽 스냅샷 어디에도 없는 id는 이름이 null이다("(현재 없음)" 표기는 화면의 몫)', () => {
      const before: DiffEntity = { id: 'n1', name: '노드1', intentIds: ['ghost'], keywordIds: [] };
      const after: DiffEntity = { id: 'n1', name: '노드1', intentIds: [], keywordIds: [] };
      const base = fullEnvelope();
      const target = fullEnvelope();
      const resolver = buildRefNameResolver(base, target);

      const fields = diffItemFields('NODE', before, after, resolver);
      const intentIdsField = fields.find((f) => f.field === 'intentIds' && f.type === 'REF_SET');
      expect(intentIdsField).toMatchObject({ type: 'REF_SET', removed: [{ id: 'ghost', name: null }] });
    });

    it('resolver를 넘기지 않으면(하위호환) 이름이 전부 null이다', () => {
      const before: DiffEntity = { id: 'n1', name: '노드1', intentIds: ['i1'], keywordIds: [] };
      const after: DiffEntity = { id: 'n1', name: '노드1', intentIds: [], keywordIds: [] };
      const fields = diffItemFields('NODE', before, after);
      const intentIdsField = fields.find((f) => f.field === 'intentIds' && f.type === 'REF_SET');
      expect(intentIdsField).toMatchObject({ type: 'REF_SET', removed: [{ id: 'i1', name: null }] });
    });
  });
});
