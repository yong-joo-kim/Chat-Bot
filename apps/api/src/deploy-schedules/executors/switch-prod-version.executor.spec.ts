import { SwitchProdVersionExecutor } from './switch-prod-version.executor';
import type { PreviewContext } from './deploy-action-executor';

/**
 * [신규 No.40 — 2026-09-25 프론트 계약 보강] `preview()`의 §11.2 체인 기준 `expectedProdVersionId`
 * 계산과 SWITCH_BLOCKED 2단 구조(코드만 · 세부는 switchProd.blockers)를 검증한다. 이 실행기의
 * `preview()`는 기존까지 전용 단위 시험이 없었다(통합 시험만 있었다).
 */
function makeDeps(previewOverrides: Record<string, unknown> = {}) {
  const prodSwitchPreview = {
    kind: 'SWITCH',
    current: { versionId: 'v-current', versionNo: 1, capturedAt: new Date(), label: null },
    target: { versionId: 'v-target', versionNo: 2, capturedAt: new Date(), label: null },
    expectedProdVersionId: 'v-actual-current-prod',
    outcome: 'SWITCHABLE',
    diffSummary: { rows: [], totalChanged: 0, identical: false },
    gate: { verdict: 'PASS', reason: 'NOT_CONFIGURED', run: null },
    blockers: [],
    warnings: [],
    ...previewOverrides,
  };
  const prodSwitch = { preview: jest.fn().mockResolvedValue(prodSwitchPreview), switch: jest.fn() };
  const prisma = { chatbot: { findUnique: jest.fn() }, chatbotVersion: { findUnique: jest.fn() }, environmentSwitchLog: { findFirst: jest.fn() } };
  const executor = new SwitchProdVersionExecutor(prisma as never, prodSwitch as never);
  return { executor, prodSwitch, prisma };
}

function basePreviewCtx(overrides: Partial<PreviewContext<'SWITCH_PROD_VERSION'>> = {}): PreviewContext<'SWITCH_PROD_VERSION'> {
  return {
    chatbotId: 'bot-1',
    chatbotStatus: 'ACTIVE',
    scheduledAt: new Date('2026-03-01T00:20:00Z'),
    params: { targetVersionId: 'v-target' },
    now: new Date('2026-03-01T00:00:00Z'),
    activeRestoreSiblings: [],
    activeSwitchSiblings: [],
    earlierActivePublishExists: false,
    activeSiblingActions: [],
    ...overrides,
  };
}

describe('SwitchProdVersionExecutor.preview — §11.2 체인 기준 expectedProdVersionId', () => {
  it('앞선 활성 전환 예약이 없으면 base=CURRENT고 expectedProdVersionId는 지금의 실제 운영이다', async () => {
    const { executor } = makeDeps();
    const result = await executor.preview(basePreviewCtx());

    expect(result.switchProd?.base).toBe('CURRENT');
    expect(result.switchProd?.expectedProdVersionId).toBe('v-actual-current-prod');
  });

  it('앞선 활성 전환 예약(이 예약보다 이른 scheduledAt)이 있으면 base=SCHEDULE이고 expectedProdVersionId는 "지금의 실제 운영"이 아니라 그 예약의 대상이다', async () => {
    const { executor } = makeDeps();
    const ctx = basePreviewCtx({
      activeSwitchSiblings: [{ id: 'sched-1', scheduledAt: new Date('2026-03-01T00:10:00Z'), targetVersionId: 'v-predecessor-target' }],
    });

    const result = await executor.preview(ctx);

    expect(result.switchProd?.base).toBe('SCHEDULE');
    expect(result.switchProd?.expectedProdVersionId).toBe('v-predecessor-target');
    expect(result.switchProd?.expectedProdVersionId).not.toBe('v-actual-current-prod');
  });

  it('앞선 예약이 있어도 이 예약보다 늦으면(뒤에만 붙는다) base=CURRENT다', async () => {
    const { executor } = makeDeps();
    const ctx = basePreviewCtx({
      activeSwitchSiblings: [{ id: 'sched-later', scheduledAt: new Date('2026-03-01T00:30:00Z'), targetVersionId: 'v-later-target' }],
    });

    const result = await executor.preview(ctx);

    expect(result.switchProd?.base).toBe('CURRENT');
    expect(result.switchProd?.expectedProdVersionId).toBe('v-actual-current-prod');
  });

  it('blocker가 있으면 preconditionFailures는 일반 코드(SWITCH_BLOCKED)뿐이고 세부는 switchProd.blockers에만 있다(RESTORE_BLOCKED와 같은 2단 구조)', async () => {
    const { executor } = makeDeps({ blockers: ['GATE_BLOCKED', 'TARGET_UNREADABLE'] });

    const result = await executor.preview(basePreviewCtx());

    expect(result.preconditionFailures).toEqual([{ code: 'SWITCH_BLOCKED' }]);
    expect(result.preconditionFailures[0]).not.toHaveProperty('message');
    expect(result.switchProd?.blockers).toEqual(['GATE_BLOCKED', 'TARGET_UNREADABLE']);
  });

  it('blocker가 없으면 preconditionFailures가 빈 배열이다', async () => {
    const { executor } = makeDeps({ blockers: [] });

    const result = await executor.preview(basePreviewCtx());

    expect(result.preconditionFailures).toEqual([]);
  });
});
