import { checkSnapshotIntegrity } from './snapshot-integrity';
import type { HydratedSnapshot } from './snapshot-hydrate';
import type { DialogueBundle } from '@chat-bot/shared-types';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function emptyBundle(): DialogueBundle {
  return { intents: [], keywords: [], homonyms: [], dialogNodes: [], contexts: [], faqs: [] };
}

function makeHydrated(overrides: Partial<DialogueBundle> = {}): HydratedSnapshot {
  return {
    bundle: { ...emptyBundle(), ...overrides },
    answerSetting: null,
    profile: { name: '챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: 'h' } },
  };
}

describe('snapshot-integrity — §5.5 캡처/복원 무결성 검사', () => {
  it('FK가 깨진 노드(intentIds 참조 없음)는 복원 모드에서 위반(거부), 캡처 모드에서 경고다', () => {
    const hydrated = makeHydrated({
      dialogNodes: [
        {
          id: 'n1',
          chatbotId: 'cb',
          name: '노드1',
          nodeType: 'NORMAL',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: ['missing-intent'],
          keywordIds: [],
          outputs: [],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });

    const restoreResult = checkSnapshotIntegrity(hydrated, 'RESTORE');
    expect(restoreResult.violations.some((v) => v.rule === 'BROKEN_REFERENCE_NODE_INTENT')).toBe(true);

    const captureResult = checkSnapshotIntegrity(hydrated, 'CAPTURE');
    expect(captureResult.violations).toEqual([]);
    expect(captureResult.warnings.some((w) => w.rule === 'BROKEN_REFERENCE_NODE_INTENT')).toBe(true);
  });

  it('앱 레벨 참조(DIALOG_MOVE 대상 노드 없음)는 복원 모드에서도 경고만이다(EX-H-5)', () => {
    const hydrated = makeHydrated({
      dialogNodes: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          chatbotId: 'cb',
          name: '노드1',
          nodeType: 'START',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: [],
          keywordIds: [],
          outputs: [{ type: 'DIALOG_MOVE', payload: { targetNodeId: '11111111-1111-4111-8111-111111111111' } }],
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });

    const result = checkSnapshotIntegrity(hydrated, 'RESTORE');
    // 앱 레벨 참조는 복원 모드에서도 위반으로 승격되지 않는다(EX-H-5) — zod 상한과 무관한 확인이다.
    expect(result.violations.some((v) => v.rule.startsWith('BROKEN_REFERENCE_NODE_MOVE'))).toBe(false);
    expect(result.warnings.some((w) => w.rule === 'BROKEN_REFERENCE_NODE_MOVE')).toBe(true);
  });

  it('정규화 이름 중복(의도)은 복원 모드에서 위반이다(ADR-0006)', () => {
    const hydrated = makeHydrated({
      intents: [
        { id: 'i1', chatbotId: 'cb', name: '환불 문의', examples: [], createdAt: NOW, updatedAt: NOW },
        { id: 'i2', chatbotId: 'cb', name: '환불   문의', examples: [], createdAt: NOW, updatedAt: NOW },
      ],
    });

    const result = checkSnapshotIntegrity(hydrated, 'RESTORE');
    expect(result.violations.some((v) => v.rule === 'DUPLICATE_NORMALIZED_NAME' && v.kind === 'INTENT')).toBe(true);
  });

  it('START 노드가 2개 이상이면 복원 모드에서 위반이다(FR-5-4)', () => {
    const node = (id: string, nodeType: 'START' | 'NORMAL') => ({
      id,
      chatbotId: 'cb',
      name: id,
      nodeType,
      matchMode: 'ANY' as const,
      enabled: true,
      priority: 0,
      intentIds: [],
      keywordIds: [],
      outputs: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    const hydrated = makeHydrated({ dialogNodes: [node('n1', 'START'), node('n2', 'START')] });

    const result = checkSnapshotIntegrity(hydrated, 'RESTORE');
    expect(result.violations.some((v) => v.rule === 'DUPLICATE_NODE_TYPE_START')).toBe(true);
  });

  it('빈 스냅샷은 캡처·복원 모두 위반·경고가 없다', () => {
    const hydrated = makeHydrated();
    expect(checkSnapshotIntegrity(hydrated, 'CAPTURE')).toEqual({ violations: [], violationsTotal: 0, warnings: [], warningsTotal: 0 });
    expect(checkSnapshotIntegrity(hydrated, 'RESTORE')).toEqual({ violations: [], violationsTotal: 0, warnings: [], warningsTotal: 0 });
  });
});
