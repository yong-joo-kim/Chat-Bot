import { AugmentationAcceptService } from './augmentation-accept.service';
import { ApiException } from '../common/api.exception';

function buildDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    augmentationSuggestion: {
      findMany: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const scope = { assertWritable: jest.fn().mockResolvedValue(undefined) };
  const embeddingFactory = { getProvider: jest.fn().mockResolvedValue(undefined) };
  const vectorCache = { get: jest.fn() };
  const intentsService = {
    applyLearningExample: jest.fn().mockResolvedValue({
      intentId: 'intent-1',
      intentName: '배송문의',
      created: false,
      exampleCount: 5,
      linkedNodeCount: 2,
      conflicts: [],
    }),
  };
  const learningApply = {
    applyLearning: jest.fn().mockResolvedValue({ mode: 'IMMEDIATE', appliedImmediately: true, jobId: null }),
  };
  const config = { get: jest.fn().mockReturnValue(undefined) };

  return {
    prisma,
    scope,
    embeddingFactory,
    vectorCache,
    intentsService,
    learningApply,
    config,
    ...overrides,
  };
}

function buildService(deps: ReturnType<typeof buildDeps>): AugmentationAcceptService {
  return new AugmentationAcceptService(
    deps.prisma as never,
    deps.scope as never,
    deps.embeddingFactory as never,
    deps.vectorCache as never,
    deps.intentsService as never,
    deps.learningApply as never,
    deps.config as never,
  );
}

const now = new Date();

describe('AugmentationAcceptService — ★ 자산 승격 유일 지점(ADR-0025 §5)', () => {
  it('AC-L1-6/K-2 — 제안 2건 승인 시 applyLearning()은 요청당 정확히 1회 호출된다', async () => {
    const deps = buildDeps();
    deps.prisma.augmentationSuggestion.findMany.mockResolvedValue([
      { id: 's1', chatbotId: 'c1', intentId: 'i1', text: 'A', status: 'PENDING', modelId: 'm1', createdAt: now },
      { id: 's2', chatbotId: 'c1', intentId: 'i1', text: 'B', status: 'PENDING', modelId: 'm1', createdAt: now },
    ]);
    const service = buildService(deps);

    const result = await service.accept('c1', 'i1', { suggestionIds: ['s1', 's2'] });

    expect(deps.learningApply.applyLearning).toHaveBeenCalledTimes(1);
    expect(deps.learningApply.applyLearning).toHaveBeenCalledWith(
      expect.objectContaining({ chatbotId: 'c1', reason: 'AUGMENTATION_ACCEPT', intentIds: ['intent-1', 'intent-1'] }),
    );
    expect(result.succeeded).toBe(2);
    expect(result.failed).toEqual([]);
  });

  it('AC-L1-7/J-9 — 승인 성공 시 appliedImmediately는 applyLearning()의 반환값을 그대로 전달한다(true 고정 회귀)', async () => {
    const deps = buildDeps();
    deps.prisma.augmentationSuggestion.findMany.mockResolvedValue([
      { id: 's1', chatbotId: 'c1', intentId: 'i1', text: 'A', status: 'PENDING', modelId: 'm1', createdAt: now },
    ]);
    const service = buildService(deps);

    const result = await service.accept('c1', 'i1', { suggestionIds: ['s1'] });

    expect(result.appliedImmediately).toBe(true);
  });

  it('존재하지 않는 제안 id는 NOT_FOUND로 실패 목록에 담기고 나머지는 계속 처리된다(부분 성공)', async () => {
    const deps = buildDeps();
    deps.prisma.augmentationSuggestion.findMany.mockResolvedValue([
      { id: 's1', chatbotId: 'c1', intentId: 'i1', text: 'A', status: 'PENDING', modelId: 'm1', createdAt: now },
    ]);
    const service = buildService(deps);

    const result = await service.accept('c1', 'i1', { suggestionIds: ['s1', 'missing'] });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toEqual([{ id: 'missing', code: 'NOT_FOUND', message: expect.any(String) }]);
  });

  it('AC-L1-11 — 이미 처리(ACCEPTED)된 제안은 SUGGESTION_EXPIRED로 실패하고 applyLearning은 호출되지 않는다', async () => {
    const deps = buildDeps();
    deps.prisma.augmentationSuggestion.findMany.mockResolvedValue([
      { id: 's1', chatbotId: 'c1', intentId: 'i1', text: 'A', status: 'ACCEPTED', modelId: 'm1', createdAt: now },
    ]);
    const service = buildService(deps);

    const result = await service.accept('c1', 'i1', { suggestionIds: ['s1'] });

    expect(result.failed).toEqual([{ id: 's1', code: 'SUGGESTION_EXPIRED', message: expect.any(String) }]);
    expect(deps.learningApply.applyLearning).not.toHaveBeenCalled();
  });

  it('applyLearningExample()이 LIMIT_EXCEEDED를 던지면 해당 건만 실패하고 나머지는 성공한다(AC-L1-9와 동일 철학)', async () => {
    const deps = buildDeps();
    deps.prisma.augmentationSuggestion.findMany.mockResolvedValue([
      { id: 's1', chatbotId: 'c1', intentId: 'i1', text: 'A', status: 'PENDING', modelId: 'm1', createdAt: now },
      { id: 's2', chatbotId: 'c1', intentId: 'i1', text: 'B', status: 'PENDING', modelId: 'm1', createdAt: now },
    ]);
    (deps.intentsService.applyLearningExample as jest.Mock)
      .mockResolvedValueOnce({ intentId: 'i1', intentName: '배송문의', created: false, exampleCount: 500, linkedNodeCount: 1, conflicts: [] })
      .mockRejectedValueOnce(new ApiException('LIMIT_EXCEEDED', 400, '예문 상한 초과'));

    const service = buildService(deps);
    const result = await service.accept('c1', 'i1', { suggestionIds: ['s1', 's2'] });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toEqual([{ id: 's2', code: 'LIMIT_EXCEEDED', message: '예문 상한 초과' }]);
    expect(deps.learningApply.applyLearning).toHaveBeenCalledTimes(1);
  });
});
