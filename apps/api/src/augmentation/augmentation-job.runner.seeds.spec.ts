import { AugmentationJobRunner } from './augmentation-job.runner';

/**
 * K-1 재현 시험 — 시드 구성이 ml-worker 계약 상한(`GENERATION_SEEDS_MAX=20`, 초과 400)을 넘지 않는다.
 * 실제 러너를 쓰고 의존성만 대체한다(시드는 provider.generate 인자로 관찰).
 */
function makeRunner(examples: string[], intentName = '환불 문의') {
  const generate = jest.fn().mockResolvedValue([]);
  const prisma = {
    intent: {
      findFirst: jest.fn().mockResolvedValue({ id: 'i1', name: intentName, examples: JSON.stringify(examples) }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    bannedWord: { findMany: jest.fn().mockResolvedValue([]) },
    chatbotAnswerSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const embeddingFactory = { getProvider: jest.fn().mockResolvedValue({ modelId: 'm', embed: jest.fn() }) };
  const vectorCache = {
    get: jest.fn().mockResolvedValue({ entries: [{ ownerId: 'i1', ownerType: 'INTENT_NAME', vector: new Float32Array([1]) }] }),
  };
  const augmentationFactory = { getProvider: jest.fn().mockReturnValue({ providerId: 'mock', generate }) };
  const config = { get: jest.fn() };
  const runner = new AugmentationJobRunner(prisma as never, embeddingFactory as never, vectorCache as never, augmentationFactory as never, config as never);
  const run = () => runner.run({ chatbotId: 'c1', intentId: 'i1', requestedCount: 5, jobId: 'j1' }, async () => undefined);
  return { run, generate };
}

const makeExamples = (n: number) => Array.from({ length: n }, (_, i) => `예문 ${i + 1}`);

describe('AugmentationJobRunner 시드 구성(K-1)', () => {
  it.each([19, 20, 21, 25])('예문 %i개여도 시드는 ml-worker 상한 20을 넘지 않는다', async (n) => {
    const { run, generate } = makeRunner(makeExamples(n));
    await run();
    const seeds: string[] = generate.mock.calls[0][0].seeds;
    expect(seeds.length).toBeLessThanOrEqual(20);
  });

  it('예문 19개 — 전부 유지 + 의도 이름(총 20)', async () => {
    const examples = makeExamples(19);
    const { run, generate } = makeRunner(examples);
    await run();
    expect(generate.mock.calls[0][0].seeds).toEqual([...examples, '환불 문의']);
  });

  it('예문 20개 — 가장 최근 19개 + 의도 이름(총 20)', async () => {
    const examples = makeExamples(20);
    const { run, generate } = makeRunner(examples);
    await run();
    const seeds: string[] = generate.mock.calls[0][0].seeds;
    expect(seeds).toHaveLength(20);
    expect(seeds.slice(0, 19)).toEqual(examples.slice(1));
    expect(seeds[19]).toBe('환불 문의');
  });

  it('예문 21개 — 가장 최근 19개 + 의도 이름(총 20)', async () => {
    const examples = makeExamples(21);
    const { run, generate } = makeRunner(examples);
    await run();
    const seeds: string[] = generate.mock.calls[0][0].seeds;
    expect(seeds).toHaveLength(20);
    expect(seeds.slice(0, 19)).toEqual(examples.slice(2));
    expect(seeds[19]).toBe('환불 문의');
  });

  it('공백뿐인 예문은 시드에서 제외한다(ml-worker가 400으로 거부하므로)', async () => {
    const { run, generate } = makeRunner(['  ', '정상 예문', '']);
    await run();
    expect(generate.mock.calls[0][0].seeds).toEqual(['정상 예문', '환불 문의']);
  });

  it('의도 이름이 공백뿐이면 시드에서 제외한다(ml-worker는 공백 시드를 400으로 거부)', async () => {
    const { run, generate } = makeRunner(['정상 예문'], '   ');
    await run();
    expect(generate.mock.calls[0][0].seeds).toEqual(['정상 예문']);
  });
});
