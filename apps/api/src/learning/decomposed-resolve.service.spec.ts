import { DecomposedResolveService } from './decomposed-resolve.service';
import { ApiException } from '../common/api.exception';

/**
 * `DecomposedResolveService` — No.23 (A) 통합 반영(FR-L2-9~13) 단위 테스트.
 * ⚠ 이 서비스는 구현 시점에 전용 스펙이 없었다(오류검출 갭) — `AugmentationAcceptService`와
 * 같은 형식으로 신설한다. 핵심 목적은 J-9(ADR-0018 인계 계약 무교체)를 이 두 번째 allowlist
 * 호출부에서도 회귀 없이 고정하는 것 — `appliedImmediately`는 `applyLearning()` 반환값을 그대로
 * 전달할 뿐이며 이 서비스가 임의로 값을 만들지 않는다(AC-L4-7과 대칭).
 */

function buildDeps(overrides: Partial<Record<string, unknown>> = {}) {
  const prisma = {
    unansweredQuestion: {
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    keyword: {
      findFirst: jest.fn(),
    },
    dialogNodeKeyword: {
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const scope = { assertWritable: jest.fn().mockResolvedValue(undefined) };
  const intentsService = {
    applyLearningExample: jest.fn().mockResolvedValue({
      intentId: 'intent-1',
      intentName: '배송문의',
      created: false,
      exampleCount: 6,
      linkedNodeCount: 2,
      conflicts: [],
    }),
  };
  const keywordsService = {
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn().mockResolvedValue({ id: 'keyword-new' }),
  };
  const learningApply = {
    applyLearning: jest.fn().mockResolvedValue({ mode: 'IMMEDIATE', appliedImmediately: true, jobId: null }),
  };

  return { prisma, scope, intentsService, keywordsService, learningApply, ...overrides };
}

function buildService(deps: ReturnType<typeof buildDeps>): DecomposedResolveService {
  return new DecomposedResolveService(
    deps.prisma as never,
    deps.scope as never,
    deps.intentsService as never,
    deps.keywordsService as never,
    deps.learningApply as never,
  );
}

function pendingQuestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q1',
    chatbotId: 'c1',
    questionText: '해외로 반품 보낼 수 있나요',
    status: 'PENDING',
    ...overrides,
  };
}

describe('DecomposedResolveService — No.23 (A) 통합 반영(FR-L2-9~13)', () => {
  it('AC-L2-5 — 의도 + 신규 키워드 1건 반영 시 applyLearningExample·keywordsService.create·applyLearning이 각 1회 호출된다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion());

    const service = buildService(deps);
    const result = await service.resolve(
      'c1',
      'q1',
      { intentId: 'intent-1', entities: [{ action: 'CREATE', name: '반품', synonym: '반품' }] } as never,
      'actor-1',
    );

    expect(deps.intentsService.applyLearningExample).toHaveBeenCalledTimes(1);
    expect(deps.keywordsService.create).toHaveBeenCalledTimes(1);
    expect(deps.learningApply.applyLearning).toHaveBeenCalledTimes(1);
    expect(deps.learningApply.applyLearning).toHaveBeenCalledWith(
      expect.objectContaining({ chatbotId: 'c1', reason: 'UNANSWERED_DECOMPOSED_RESOLVE', intentIds: ['intent-1'] }),
    );
    expect(result.created).toBe(false);
    expect(result.keywordCount).toBe(1);
  });

  it('J-9/AC-L4-7 대칭 회귀 — appliedImmediately는 applyLearning() 반환값을 그대로 전달한다(true 고정)', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion());
    const service = buildService(deps);

    const result = await service.resolve('c1', 'q1', { intentId: 'intent-1', entities: [] } as never, 'actor-1');

    expect(result.appliedImmediately).toBe(true);
  });

  it('회귀 가드 — applyLearning()이 mode:QUEUED를 반환하더라도(가상 시나리오) 서비스는 그 값을 그대로 전달할 뿐 스스로 true로 덮어쓰지 않는다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion());
    (deps.learningApply.applyLearning as jest.Mock).mockResolvedValue({ mode: 'QUEUED', appliedImmediately: false, jobId: 'job-1' });
    const service = buildService(deps);

    const result = await service.resolve('c1', 'q1', { intentId: 'intent-1', entities: [] } as never, 'actor-1');

    expect(result.appliedImmediately).toBe(false);
  });

  it('AC-L2-4 — 원문 범위를 벗어난 스팬 제출 시 400이며 아무것도 변경되지 않는다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion({ questionText: '반품' }));
    const service = buildService(deps);

    await expect(
      service.resolve(
        'c1',
        'q1',
        { intentId: 'intent-1', entities: [], spans: [{ start: 0, end: 999, text: '반품', role: 'ENTITY_CANDIDATE' }] } as never,
        'actor-1',
      ),
    ).rejects.toThrow(ApiException);

    expect(deps.intentsService.applyLearningExample).not.toHaveBeenCalled();
    expect(deps.learningApply.applyLearning).not.toHaveBeenCalled();
  });

  it('AC-L2-4 — 스팬이 서로 겹치면 400이며 아무것도 변경되지 않는다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion({ questionText: '해외배송비 문의' }));
    const service = buildService(deps);

    await expect(
      service.resolve(
        'c1',
        'q1',
        {
          intentId: 'intent-1',
          entities: [],
          spans: [
            { start: 0, end: 4, text: '해외배송', role: 'ENTITY_CANDIDATE' },
            { start: 2, end: 5, text: '배송비', role: 'ENTITY_CANDIDATE' },
          ],
        } as never,
        'actor-1',
      ),
    ).rejects.toThrow(ApiException);

    expect(deps.learningApply.applyLearning).not.toHaveBeenCalled();
  });

  it('EX-L2-14/AC-L2-6 — 이미 처리된(PENDING 아님) 항목은 409 ALREADY_RESOLVED이고 자산 변경이 없다(멱등)', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion({ status: 'RESOLVED' }));
    const service = buildService(deps);

    await expect(service.resolve('c1', 'q1', { intentId: 'intent-1', entities: [] } as never, 'actor-1')).rejects.toThrow(ApiException);
    expect(deps.intentsService.applyLearningExample).not.toHaveBeenCalled();
  });

  it('AC-L2-6 동시성 — CAS updateMany가 0건이면(동시 처리 경합) 409이고 applyLearning은 호출되지 않는다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion());
    deps.prisma.unansweredQuestion.updateMany.mockResolvedValue({ count: 0 });
    const service = buildService(deps);

    await expect(service.resolve('c1', 'q1', { intentId: 'intent-1', entities: [] } as never, 'actor-1')).rejects.toThrow(ApiException);
    expect(deps.learningApply.applyLearning).not.toHaveBeenCalled();
  });

  it('EX-L2-4 — 엔티티 승인 중 일부가 실패해도(부분 성공) 의도 반영은 유지되고 applyLearning은 여전히 1회 호출된다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion());
    (deps.keywordsService.create as jest.Mock).mockRejectedValueOnce(new ApiException('LIMIT_EXCEEDED', 400, '동의어 상한 초과'));

    const service = buildService(deps);
    const result = await service.resolve(
      'c1',
      'q1',
      { intentId: 'intent-1', entities: [{ action: 'CREATE', name: '반품', synonym: '반품' }] } as never,
      'actor-1',
    );

    expect(result.entityFailed).toHaveLength(1);
    expect(result.keywordCount).toBe(0);
    expect(deps.learningApply.applyLearning).toHaveBeenCalledTimes(1);
  });

  it('FR-L2-12 — 키워드를 연결한 노드가 없으면 keywordLinkedNodeCount가 0이다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion());
    deps.prisma.dialogNodeKeyword.count.mockResolvedValue(0);

    const service = buildService(deps);
    const result = await service.resolve(
      'c1',
      'q1',
      { intentId: 'intent-1', entities: [{ action: 'CREATE', name: '반품', synonym: '반품' }] } as never,
      'actor-1',
    );

    expect(result.keywordLinkedNodeCount).toBe(0);
  });

  it('ADD_SYNONYM 경로 — 기존 키워드에 동의어를 추가하면 keywordsService.update가 호출되고 create는 호출되지 않는다', async () => {
    const deps = buildDeps();
    deps.prisma.unansweredQuestion.findFirst.mockResolvedValue(pendingQuestion());
    deps.prisma.keyword.findFirst.mockResolvedValue({ id: 'kw-1', chatbotId: 'c1', synonyms: JSON.stringify(['해외']) });

    const service = buildService(deps);
    const result = await service.resolve(
      'c1',
      'q1',
      { intentId: 'intent-1', entities: [{ action: 'ADD_SYNONYM', keywordId: 'kw-1', synonym: '국외' }] } as never,
      'actor-1',
    );

    expect(deps.keywordsService.update).toHaveBeenCalledWith('c1', 'kw-1', { synonyms: ['해외', '국외'] });
    expect(deps.keywordsService.create).not.toHaveBeenCalled();
    expect(result.keywordCount).toBe(1);
  });
});
