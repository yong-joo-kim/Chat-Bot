import { buildDialogueIndex } from '@chat-bot/dialogue-engine';
import { TestRunExecutor } from './test-run.executor';

function buildBundle() {
  return { intents: [], keywords: [], homonyms: [], dialogNodes: [], contexts: [], faqs: [] };
}

function buildDeps() {
  const storedResults: Record<string, unknown>[] = [];
  const prisma = {
    testCase: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'case-1', setId: 'set-1', chatbotId: 'bot-1', seq: 1, messages: JSON.stringify(['안녕하세요']), expectedKind: 'FALLBACK', expectedTargetId: null, enabled: true },
      ]),
    },
    testRun: { update: jest.fn().mockResolvedValue(undefined) },
    testRunResult: {
      createMany: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown>[] }) => {
        storedResults.push(...data);
        return Promise.resolve({ count: data.length });
      }),
      findMany: jest.fn().mockImplementation(() => Promise.resolve(storedResults)),
    },
    bannedWord: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const bundle = buildBundle();
  const bundleService = { getCached: jest.fn().mockResolvedValue({ bundle, index: buildDialogueIndex(bundle) }) };
  const embeddingFactory = { getProvider: jest.fn().mockResolvedValue(undefined) };
  const vectorCache = { get: jest.fn().mockResolvedValue({ modelId: 'm', dimension: 0, entries: [], cachedAt: Date.now() }) };
  const answerSettingsCache = {
    get: jest.fn().mockResolvedValue({
      semanticEnabled: false,
      acceptThreshold: 0.8,
      lowThreshold: 0.6,
      marginThreshold: 0.05,
      ragEnabled: false,
      ragCompany: null,
      ragCategory: null,
      ragSubcategory: null,
      ragSimilarityThreshold: null,
      ragTimeoutMs: 120000,
    }),
  };
  const runEmbedding = { embedUniqueTexts: jest.fn(), embedPassages: jest.fn() };
  const overlayBuilder = { build: jest.fn() };
  const ragService = { attempt: jest.fn().mockResolvedValue({ wouldUseRag: false }) };
  const cancelRegistry = { isCancelled: jest.fn().mockReturnValue(false), cancel: jest.fn(), clear: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(undefined) };

  return { prisma, bundleService, embeddingFactory, vectorCache, answerSettingsCache, runEmbedding, overlayBuilder, ragService, cancelRegistry, config, storedResults };
}

describe('TestRunExecutor — SINGLE 모드 기본 실행(J-4, ADR-0030)', () => {
  it('세트에 실행 가능한 TC가 없으면 TEST_SET_EMPTY로 실패를 반환한다(취소 없이 즉시 종료)', async () => {
    const deps = buildDeps();
    deps.prisma.testCase.findMany.mockResolvedValue([]);
    const executor = new TestRunExecutor(
      deps.prisma as never,
      deps.bundleService as never,
      deps.embeddingFactory as never,
      deps.vectorCache as never,
      deps.answerSettingsCache as never,
      deps.runEmbedding as never,
      deps.overlayBuilder as never,
      deps.ragService as never,
      deps.cancelRegistry as never,
      deps.config as never,
    );

    const result = await executor.execute({ chatbotId: 'bot-1', runId: 'run-1', setId: 'set-1', mode: 'SINGLE', overlaySource: 'NONE', useRag: false });
    expect(result).toEqual({ status: 'FAILED', failureReason: 'TEST_SET_EMPTY' });
  });

  it('규칙 매칭만으로 폴백 TC를 PASS로 판정하고 결과를 저장한다(빈 번들 = 아무것도 매칭되지 않음)', async () => {
    const deps = buildDeps();
    const executor = new TestRunExecutor(
      deps.prisma as never,
      deps.bundleService as never,
      deps.embeddingFactory as never,
      deps.vectorCache as never,
      deps.answerSettingsCache as never,
      deps.runEmbedding as never,
      deps.overlayBuilder as never,
      deps.ragService as never,
      deps.cancelRegistry as never,
      deps.config as never,
    );

    const result = await executor.execute({ chatbotId: 'bot-1', runId: 'run-1', setId: 'set-1', mode: 'SINGLE', overlaySource: 'NONE', useRag: false });

    expect(result.status).toBe('SUCCEEDED');
    expect(deps.storedResults).toHaveLength(1);
    expect(deps.storedResults[0]).toMatchObject({ caseId: 'case-1', resultA: 'PASS' });
    const summary = result.resultSummary as { a: { pass: number; fail: number } };
    expect(summary.a).toEqual({ pass: 1, fail: 0, notJudged: 0, unresolved: 0 });
  });

  it('취소 레지스트리가 켜져 있으면 다음 TC 경계에서 중단한다(S-6)', async () => {
    const deps = buildDeps();
    deps.cancelRegistry.isCancelled.mockReturnValue(true);
    const executor = new TestRunExecutor(
      deps.prisma as never,
      deps.bundleService as never,
      deps.embeddingFactory as never,
      deps.vectorCache as never,
      deps.answerSettingsCache as never,
      deps.runEmbedding as never,
      deps.overlayBuilder as never,
      deps.ragService as never,
      deps.cancelRegistry as never,
      deps.config as never,
    );

    await executor.execute({ chatbotId: 'bot-1', runId: 'run-1', setId: 'set-1', mode: 'SINGLE', overlaySource: 'NONE', useRag: false });
    expect(deps.storedResults).toHaveLength(0);
  });
});

describe('TestRunExecutor — RAG 실행당 상한 강제(FR-V2-20, AC-V3-11)', () => {
  function buildManyCasesDeps(caseCount: number) {
    const deps = buildDeps();
    deps.prisma.testCase.findMany.mockResolvedValue(
      Array.from({ length: caseCount }, (_, i) => ({
        id: `case-${i}`,
        setId: 'set-1',
        chatbotId: 'bot-1',
        seq: i,
        messages: JSON.stringify([`질문 ${i}`]),
        expectedKind: 'ANY',
        expectedTargetId: null,
        enabled: true,
      })),
    );
    return deps;
  }

  it('설정된 상한(TEST_RUN_RAG_MAX_CALLS)을 넘는 요청부터는 underBudget=false로 호출해 실제 RAG 호출을 막는다', async () => {
    const RAG_MAX_CALLS = 3;
    const CASE_COUNT = 5;
    const deps = buildManyCasesDeps(CASE_COUNT);
    deps.config.get.mockImplementation((key: string) => (key === 'TEST_RUN_RAG_MAX_CALLS' ? RAG_MAX_CALLS : undefined));
    // ragService.attempt는 underBudget이 true일 때만 실제로 "호출을 시도했다"고 응답한다
    // (진짜 TestRunRagService의 계약과 동일한 모양) — 이를 통해 실행기가 상한을 정확히
    // 카운트하는지(51번째부터 wouldUseRag만 표시하는 것과 동형의 로직)를 검증한다.
    deps.ragService.attempt.mockImplementation((_q: string, _band: unknown, _settings: unknown, _useRag: boolean, underBudget: boolean) =>
      Promise.resolve({ wouldUseRag: true, ragAttempted: underBudget }),
    );

    const executor = new TestRunExecutor(
      deps.prisma as never,
      deps.bundleService as never,
      deps.embeddingFactory as never,
      deps.vectorCache as never,
      deps.answerSettingsCache as never,
      deps.runEmbedding as never,
      deps.overlayBuilder as never,
      deps.ragService as never,
      deps.cancelRegistry as never,
      deps.config as never,
    );

    await executor.execute({ chatbotId: 'bot-1', runId: 'run-1', setId: 'set-1', mode: 'SINGLE', overlaySource: 'NONE', useRag: true });

    expect(deps.ragService.attempt).toHaveBeenCalledTimes(CASE_COUNT);
    const underBudgetArgsInOrder = deps.ragService.attempt.mock.calls.map((call: unknown[]) => call[4]);
    // 처음 3건만 상한 이내(underBudget=true), 나머지 2건은 상한 초과(underBudget=false)다.
    expect(underBudgetArgsInOrder).toEqual([true, true, true, false, false]);

    // 실제로 "호출 시도"로 집계된 것도 상한만큼(3건)이며, 이 값이 TestRun.ragCallCount로 기록된다.
    const attemptedCount = deps.storedResults.filter((r) => r.ragAttempted === true).length;
    expect(attemptedCount).toBe(RAG_MAX_CALLS);
    const lastUpdateCall = deps.prisma.testRun.update.mock.calls.at(-1)?.[0] as { data: { ragCallCount: number } };
    expect(lastUpdateCall.data.ragCallCount).toBe(RAG_MAX_CALLS);
  });
});
