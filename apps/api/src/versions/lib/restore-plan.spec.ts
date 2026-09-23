import { planRestore } from './restore-plan';
import type { SnapshotEnvelope } from './snapshot-envelope';

const NOW = '2026-01-01T00:00:00.000Z';

function envelope(overrides: Partial<SnapshotEnvelope['assets']> = {}, answerSetting: SnapshotEnvelope['answerSetting'] = null): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: NOW,
    chatbotId: 'cb',
    assets: {
      intents: [],
      keywords: [],
      homonyms: [],
      dialogNodes: [],
      contexts: [],
      faqs: [],
      ...overrides,
    },
    answerSetting,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: 'h' } },
  };
}

describe('restore-plan — §8.4 planRestore', () => {
  it('AC-H3-17: 이름 맞바꿈(A↔B)은 rekeyIds에 두 id 모두 포함된다', () => {
    const current = envelope({
      intents: [
        { id: 'i1', name: 'A', examples: [], createdAt: NOW } as never,
        { id: 'i2', name: 'B', examples: [], createdAt: NOW } as never,
      ],
    });
    const target = envelope({
      intents: [
        { id: 'i1', name: 'B', examples: [], createdAt: NOW } as never,
        { id: 'i2', name: 'A', examples: [], createdAt: NOW } as never,
      ],
    });

    const plan = planRestore(current, target);
    expect(plan.intents.toUpdate.map((i) => i.id).sort()).toEqual(['i1', 'i2']);
    expect(plan.rekeyIds.intents.sort()).toEqual(['i1', 'i2']);
    expect(plan.intents.toDelete).toEqual([]);
    expect(plan.intents.toCreate).toEqual([]);
  });

  it('변경 없는 행은 toUpdate/toDelete/toCreate 어디에도 없다', () => {
    const shared = { id: 'i1', name: 'A', examples: ['x'], createdAt: NOW } as never;
    const current = envelope({ intents: [shared] });
    const target = envelope({ intents: [shared] });

    const plan = planRestore(current, target);
    expect(plan.intents.toUpdate).toEqual([]);
    expect(plan.intents.toDelete).toEqual([]);
    expect(plan.intents.toCreate).toEqual([]);
  });

  it('삭제될 컨텍스트를 참조하던 유지 노드는 nodeContextClearIds에 포함된다', () => {
    const node = (contextVariableId?: string) => ({
      id: 'n1',
      name: '노드1',
      nodeType: 'NORMAL',
      matchMode: 'ANY',
      enabled: true,
      priority: 0,
      intentIds: [],
      keywordIds: [],
      contextVariableId,
      outputs: [],
      createdAt: NOW,
    });
    const context = { id: 'ctx1', name: '컨텍스트1', slots: [{ name: 'a', label: 'a', prompt: 'p', type: 'TEXT', required: true, maxRetry: 2 }], cancelKeywords: [], sessionTimeoutMinutes: 30, createdAt: NOW };

    const current = envelope({ contexts: [context as never], dialogNodes: [{ ...node('ctx1'), enabled: false } as never] });
    // target: 컨텍스트 삭제되고, 같은 노드는 다른 필드(우선순위)가 바뀌며 컨텍스트 참조가 사라진다.
    const target = envelope({ contexts: [], dialogNodes: [{ ...node(undefined), priority: 5 } as never] });

    const plan = planRestore(current, target);
    expect(plan.contexts.toDelete).toEqual(['ctx1']);
    expect(plan.nodeContextClearIds).toEqual(['n1']);
  });

  it('조인 집합 차이(intentIds) — pairsToDelete/pairsToCreate가 정확하다', () => {
    const node = (intentIds: string[]) => ({
      id: 'n1',
      name: '노드1',
      nodeType: 'NORMAL',
      matchMode: 'ANY',
      enabled: true,
      priority: 0,
      intentIds,
      keywordIds: [],
      outputs: [],
      createdAt: NOW,
    });
    const current = envelope({ dialogNodes: [node(['i1', 'i2']) as never] });
    const target = envelope({ dialogNodes: [node(['i2', 'i3']) as never] });

    const plan = planRestore(current, target);
    expect(plan.nodeIntentPairs.toDelete).toEqual([{ nodeId: 'n1', intentId: 'i1' }]);
    expect(plan.nodeIntentPairs.toCreate).toEqual([{ nodeId: 'n1', intentId: 'i3' }]);
  });

  it('답변설정: 대상이 null이면 DELETE, 값이 있고 다르면 UPSERT, 같으면 SKIP', () => {
    const setting = {
      semanticEnabled: false,
      acceptThreshold: 0.8,
      lowThreshold: 0.6,
      marginThreshold: 0.05,
      ragEnabled: false,
      ragCompany: null,
      ragCategory: null,
      ragSubcategory: null,
      ragSimilarityThreshold: null,
      fallbackPolicy: 'RAG_FIRST' as const,
      showSources: true,
      ragTimeoutMs: 120000,
    };

    expect(planRestore(envelope({}, setting), envelope({}, null)).answerSetting).toEqual({ action: 'DELETE' });
    expect(planRestore(envelope({}, null), envelope({}, setting)).answerSetting).toEqual({ action: 'UPSERT', value: setting });
    expect(planRestore(envelope({}, setting), envelope({}, setting)).answerSetting).toEqual({ action: 'SKIP' });
  });
});
