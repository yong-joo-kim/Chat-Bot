import { findCrossChatbotIdConflicts } from './cross-chatbot-check';
import type { SnapshotEnvelope } from '../lib/snapshot-envelope';

function envelope(overrides: Partial<SnapshotEnvelope['assets']> = {}): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: '2026-01-01T00:00:00.000Z',
    chatbotId: 'cb-1',
    assets: { intents: [], keywords: [], homonyms: [], dialogNodes: [], contexts: [], faqs: [], ...overrides },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: 'h' } },
  } as unknown as SnapshotEnvelope;
}

function buildDb(overrides: Partial<Record<string, unknown>> = {}) {
  const noConflict = { findMany: jest.fn().mockResolvedValue([]) };
  return {
    intent: noConflict,
    keyword: { findMany: jest.fn().mockResolvedValue([]) },
    homonymDictionary: { findMany: jest.fn().mockResolvedValue([]) },
    contextVariable: { findMany: jest.fn().mockResolvedValue([]) },
    dialogNode: { findMany: jest.fn().mockResolvedValue([]) },
    faqEntry: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('findCrossChatbotIdConflicts — §5.5 ⑤ / FR-H3-11 (L-1)', () => {
  it('충돌이 없으면 빈 배열을 반환한다', async () => {
    const db = buildDb();
    const env = envelope({ intents: [{ id: 'i1', name: 'A', examples: [], createdAt: '2026-01-01' } as never] });

    const result = await findCrossChatbotIdConflicts(db as never, 'cb-1', env);
    expect(result).toEqual([]);
    expect(db.intent.findMany).toHaveBeenCalledWith({ where: { id: { in: ['i1'] }, chatbotId: { not: 'cb-1' } }, select: { id: true } });
  });

  it('스냅샷의 id가 다른 챗봇 행으로 존재하면 CROSS_CHATBOT_ID 위반을 반환한다', async () => {
    const db = buildDb({ intent: { findMany: jest.fn().mockResolvedValue([{ id: 'i1' }]) } });
    const env = envelope({ intents: [{ id: 'i1', name: 'A', examples: [], createdAt: '2026-01-01' } as never] });

    const result = await findCrossChatbotIdConflicts(db as never, 'cb-1', env);
    expect(result).toEqual([{ rule: 'CROSS_CHATBOT_ID', kind: 'INTENT', id: 'i1' }]);
  });

  it('id가 빈 종류는 쿼리를 생략한다(불필요한 조회 방지)', async () => {
    const db = buildDb();
    await findCrossChatbotIdConflicts(db as never, 'cb-1', envelope());
    expect(db.intent.findMany).not.toHaveBeenCalled();
    expect(db.keyword.findMany).not.toHaveBeenCalled();
    expect(db.homonymDictionary.findMany).not.toHaveBeenCalled();
    expect(db.contextVariable.findMany).not.toHaveBeenCalled();
    expect(db.dialogNode.findMany).not.toHaveBeenCalled();
    expect(db.faqEntry.findMany).not.toHaveBeenCalled();
  });

  it('6개 테이블 모두에서 충돌을 검출한다', async () => {
    const db = buildDb({
      intent: { findMany: jest.fn().mockResolvedValue([{ id: 'i1' }]) },
      keyword: { findMany: jest.fn().mockResolvedValue([{ id: 'k1' }]) },
      homonymDictionary: { findMany: jest.fn().mockResolvedValue([{ id: 'h1' }]) },
      contextVariable: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }]) },
      dialogNode: { findMany: jest.fn().mockResolvedValue([{ id: 'n1' }]) },
      faqEntry: { findMany: jest.fn().mockResolvedValue([{ id: 'f1' }]) },
    });
    const env = envelope({
      intents: [{ id: 'i1', name: 'A', examples: [], createdAt: '2026-01-01' } as never],
      keywords: [{ id: 'k1', name: 'K', synonyms: [], createdAt: '2026-01-01' } as never],
      homonyms: [{ id: 'h1', word: 'W', meanings: [], policy: 'ASK', createdAt: '2026-01-01' } as never],
      contexts: [{ id: 'c1', name: 'C', slots: [], cancelKeywords: [], sessionTimeoutMinutes: 30, createdAt: '2026-01-01' } as never],
      dialogNodes: [{ id: 'n1', name: 'N', nodeType: 'NORMAL', matchMode: 'ANY', enabled: true, priority: 0, intentIds: [], keywordIds: [], outputs: [], createdAt: '2026-01-01' } as never],
      faqs: [{ id: 'f1', category: 'FAQ', question: 'Q', answer: 'A', altQuestions: [], enabled: true, createdAt: '2026-01-01' } as never],
    });

    const result = await findCrossChatbotIdConflicts(db as never, 'cb-1', env);
    expect(result.map((v) => v.kind).sort()).toEqual(['CONTEXT', 'FAQ', 'HOMONYM', 'INTENT', 'KEYWORD', 'NODE']);
    for (const v of result) expect(v.rule).toBe('CROSS_CHATBOT_ID');
  });
});
