import { buildDialogueIndex } from '@chat-bot/dialogue-engine';
import { QueryEmbeddingService } from './query-embedding.service';
import { MockEmbeddingProvider } from './providers/mock-embedding.provider';
import { TestRunExecutor } from '../validation/run/test-run.executor';
import { TestRunEmbeddingService } from '../validation/run/test-run-embedding.service';

/**
 * ★ AC-V4-3(가장 중요) — 전역 질의 임베딩 LRU 캐시(운영 캐시)가 대량 TC 실행 전후로
 * 오염되지 않는다(J-8, NFR-VP4). `validation/**`에 `QueryEmbeddingService` 참조가 0건임을
 * 확인하는 정적 검사(`validation/lib/validation-sealing.spec.ts`)는 "그런 코드가 작성될 수
 * 없다"만 증명한다 — 이 시험은 **실제로 실행해서** 운영 캐시가 훼손되지 않았음을 행위 기반으로
 * 증명한다. ⚠ 이 파일은 의도적으로 `apps/api/src/validation/` 밖(embedding 모듈)에 둔다 —
 * 그 디렉터리 안에 두면 이 파일 자체가 `QueryEmbeddingService`를 참조하므로 정적 봉인 검사가
 * (정당하게) 실패한다.
 *
 * 구성: 실제 `QueryEmbeddingService`(운영 대화가 쓰는 바로 그 클래스)와 실제 `TestRunExecutor`가
 * **같은 `EmbeddingProviderFactory`(= 같은 ml-worker 연결)** 를 공유하되, 서로 다른 임베딩 경로
 * (전역 LRU vs 실행 로컬 배치)를 타게 한다. 900건으로 운영 캐시를 채운 뒤 2,000건 규모의 TC를
 * 실행하고, 가장 먼저 채워졌던(LRU상 가장 축출되기 쉬운) 항목이 여전히 캐시 적중(=재호출 없음)
 * 하는지로 "오염되지 않았다"를 증명한다 — LRU 상한(1,000)보다 훨씬 많은 2,900건이 지나갔는데도
 * 최초 900건이 살아있다는 것은, 그 2,000건이 이 캐시를 전혀 거치지 않았다는 뜻이다.
 */
function buildBundle() {
  return { intents: [], keywords: [], homonyms: [], dialogNodes: [], contexts: [], faqs: [] };
}

describe('AC-V4-3 — 대량 TC 실행이 전역 질의 임베딩 캐시를 오염시키지 않는다(J-8)', () => {
  it('운영 캐시에 900건을 채운 뒤 TC 2,000건을 실행해도 최초 900건이 축출되지 않는다', async () => {
    const provider = new MockEmbeddingProvider(8);
    const embedSpy = jest.spyOn(provider, 'embed');
    // 운영 대화 경로와 TC 실행 경로가 실제로 "같은 ml-worker 연결"을 공유함을 재현한다 —
    // 그런데도 캐시가 오염되지 않아야 한다는 것이 이 시험의 핵심이다(J-8은 "새 provider를
    // 쓰면 당연히 안 섞인다"가 아니라 "같은 provider를 써도 전역 캐시 자료구조 자체를
    // 건드리지 않는다"를 요구한다).
    const factory = { getProvider: jest.fn().mockResolvedValue(provider) };
    const config = { get: jest.fn().mockReturnValue(undefined) }; // 전부 기본값(캐시 1,000건·TTL 10분)

    const queryEmbeddingService = new QueryEmbeddingService(factory as never, config as never);

    // ① 운영 대화가 900건의 질의로 캐시를 데운다(LRU 상한 1,000 미만 — 아직 축출이 없다).
    const OPERATIONAL_COUNT = 900;
    for (let i = 0; i < OPERATIONAL_COUNT; i++) {
      const result = await queryEmbeddingService.embed(`운영 질문 ${i}`);
      expect(result).not.toBeNull();
    }
    expect(embedSpy).toHaveBeenCalledTimes(OPERATIONAL_COUNT);

    // ② TC 2,000건을 실행한다 — 전부 운영 질문과 겹치지 않는 새 문장이다.
    const TC_COUNT = 2000;
    const cases = Array.from({ length: TC_COUNT }, (_, i) => ({
      id: `case-${i}`,
      setId: 'set-1',
      chatbotId: 'bot-1',
      seq: i,
      messages: JSON.stringify([`TC 질문 ${i}`]),
      expectedKind: 'ANY',
      expectedTargetId: null,
      enabled: true,
    }));
    const storedResults: Record<string, unknown>[] = [];
    const prisma = {
      testCase: { findMany: jest.fn().mockResolvedValue(cases) },
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
    const vectorCache = { get: jest.fn().mockResolvedValue({ modelId: provider.modelId, dimension: 8, entries: [], cachedAt: Date.now() }) };
    const answerSettingsCache = {
      get: jest.fn().mockResolvedValue({
        semanticEnabled: true, // 임베딩 경로를 실제로 태운다(그래야 "안 섞인다"는 증명이 의미가 있다).
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
    const runEmbedding = new TestRunEmbeddingService(config as never); // 실제 클래스 — 배치 경로가 실제로 동작해야 한다.
    const overlayBuilder = { build: jest.fn() };
    const ragService = { attempt: jest.fn().mockResolvedValue({ wouldUseRag: false }) };
    const cancelRegistry = { isCancelled: jest.fn().mockReturnValue(false), cancel: jest.fn(), clear: jest.fn() };

    const executor = new TestRunExecutor(
      prisma as never,
      bundleService as never,
      factory as never, // ★ 운영 캐시와 동일한 factory/provider를 쓴다.
      vectorCache as never,
      answerSettingsCache as never,
      runEmbedding,
      overlayBuilder as never,
      ragService as never,
      cancelRegistry as never,
      config as never,
    );

    const callsBeforeExecution = embedSpy.mock.calls.length;
    const result = await executor.execute({ chatbotId: 'bot-1', runId: 'run-1', setId: 'set-1', mode: 'SINGLE', overlaySource: 'NONE', useRag: false });
    expect(result.status).toBe('SUCCEEDED');
    expect(storedResults).toHaveLength(TC_COUNT);

    // 실행기가 실제로 배치 임베딩을 태웠는지 확인한다(ceil(2000/64)=32회) — 만약 실행기가
    // 아무 임베딩도 하지 않았다면 아래 ③번 검증이 "당연히 안 섞였다"는 무의미한 결과가 된다.
    const callsDuringExecution = embedSpy.mock.calls.length - callsBeforeExecution;
    expect(callsDuringExecution).toBeGreaterThan(0);
    expect(callsDuringExecution).toBeLessThan(TC_COUNT); // 배치 호출 — TC 건별 호출이 아니다(NFR-VP3).

    // ③ 핵심 단언 — 운영 캐시의 "가장 먼저 들어간(가장 축출되기 쉬운)" 항목이 여전히 캐시
    // 적중한다. LRU 상한(1,000)을 훨씬 넘는 2,900건이 provider를 거쳐 갔음에도 최초 900건이
    // 살아있다는 것은, TC 실행의 2,000건이 이 전역 캐시를 전혀 거치지 않았다는 뜻이다(J-8).
    const callsBeforeReCheck = embedSpy.mock.calls.length;
    for (let i = 0; i < OPERATIONAL_COUNT; i++) {
      const cached = await queryEmbeddingService.embed(`운영 질문 ${i}`);
      expect(cached).not.toBeNull();
    }
    const callsDuringReCheck = embedSpy.mock.calls.length - callsBeforeReCheck;
    expect(callsDuringReCheck).toBe(0); // 900건 전부 캐시 적중 — provider가 다시 호출되지 않았다.
  }, 30_000);
});
