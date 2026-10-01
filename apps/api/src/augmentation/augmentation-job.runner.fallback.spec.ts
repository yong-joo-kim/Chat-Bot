import { Logger } from '@nestjs/common';
import { AugmentationJobRunner } from './augmentation-job.runner';

/**
 * K-1b 재현·차분 시험 — G2/G3가 사용 가능한 후보 0건이면 러너가 G1(`getFallbackProvider`)을 Job 안에서 1회 더 호출한다.
 * (pm-decisions-2026-10-01-설계 §2.6·§2.12). 실제 러너를 쓰고 의존성만 대체한다(seeds 시험과 같은 방식).
 */
type Outcome = { candidates: string[]; failure?: string };

function makeRunner(opts: {
  primaryId: 'rule' | 'mock' | 'local' | 'gemini';
  primary?: Outcome | 'generate-only';
  primaryCandidates?: string[];
  fallbackCandidates?: string[];
  embedFails?: boolean;
  /** K-1d — 폴백 G1 `generate()`가 거부(reject)할 오류. */
  fallbackGenerateError?: Error;
  /** K-1d — `getFallbackProvider()` 자체가 던질 오류. */
  getFallbackError?: Error;
}) {
  const fallbackGenerate = opts.fallbackGenerateError ? jest.fn().mockRejectedValue(opts.fallbackGenerateError) : jest.fn().mockResolvedValue(opts.fallbackCandidates ?? []);
  const primaryGenerate = jest.fn().mockResolvedValue(opts.primaryCandidates ?? []);
  const outcomeFn = jest.fn().mockResolvedValue(opts.primary && opts.primary !== 'generate-only' ? opts.primary : { candidates: [] });
  const primaryProvider: Record<string, unknown> = { providerId: opts.primaryId, generate: primaryGenerate };
  if (opts.primary && opts.primary !== 'generate-only') primaryProvider.generateWithOutcome = outcomeFn;

  const created: Array<{ data: Record<string, unknown> }> = [];
  const prisma = {
    intent: {
      findFirst: jest.fn().mockResolvedValue({ id: 'i1', name: '환불 문의', examples: JSON.stringify(['환불 하고 싶어요']) }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    bannedWord: { findMany: jest.fn().mockResolvedValue([]) },
    chatbotAnswerSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    augmentationSuggestion: {
      create: jest.fn().mockImplementation(async (arg: { data: Record<string, unknown> }) => {
        created.push(arg);
        return {};
      }),
    },
  };
  const embed = opts.embedFails ? jest.fn().mockRejectedValue(new Error('down')) : jest.fn().mockImplementation(async (texts: string[]) => texts.map(() => new Float32Array([1])));
  const embeddingFactory = { getProvider: jest.fn().mockResolvedValue({ modelId: 'm', embed }) };
  const vectorCache = { get: jest.fn().mockResolvedValue({ entries: [{ ownerId: 'i1', ownerType: 'INTENT_NAME', vector: new Float32Array([1]) }] }) };
  const getFallbackProvider = opts.getFallbackError
    ? jest.fn().mockImplementation(() => {
        throw opts.getFallbackError;
      })
    : jest.fn().mockReturnValue({ providerId: 'rule', generate: fallbackGenerate });
  const augmentationFactory = { getProvider: jest.fn().mockReturnValue(primaryProvider), getFallbackProvider };
  const config = { get: jest.fn() };
  const runner = new AugmentationJobRunner(prisma as never, embeddingFactory as never, vectorCache as never, augmentationFactory as never, config as never);
  const run = () => runner.run({ chatbotId: 'c1', intentId: 'i1', requestedCount: 5, jobId: 'j1' }, async () => undefined);
  return { run, getFallbackProvider, fallbackGenerate, primaryGenerate, outcomeFn, created };
}

describe('AugmentationJobRunner G1 폴백(K-1b)', () => {
  it('local + TIMEOUT → G1 1회 · 제안 providerId=rule · 요약에 degraded/fallbackFrom/fallbackCause', async () => {
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'TIMEOUT' }, fallbackCandidates: ['환불을 하고 싶습니다'] });
    const result = await t.run();
    expect(t.getFallbackProvider).toHaveBeenCalledTimes(1);
    expect(t.fallbackGenerate).toHaveBeenCalledTimes(1);
    expect(result.resultSummary).toMatchObject({ providerId: 'rule', degraded: true, fallbackFrom: 'local', fallbackCause: 'TIMEOUT', generated: 1 });
    for (const c of t.created) expect(c.data.providerId).toBe('rule');
  });

  it('gemini + HTTP_4XX', async () => {
    const t = makeRunner({ primaryId: 'gemini', primary: { candidates: [], failure: 'HTTP_4XX' }, fallbackCandidates: ['환불 요청합니다'] });
    const result = await t.run();
    expect(result.resultSummary).toMatchObject({ providerId: 'rule', degraded: true, fallbackFrom: 'gemini', fallbackCause: 'HTTP_4XX' });
  });

  it('실패 보고 없이 [] → EMPTY_RESULT (generateWithOutcome 없는 Provider는 generate()로 호출)', async () => {
    const t = makeRunner({ primaryId: 'local', primary: 'generate-only', primaryCandidates: [], fallbackCandidates: ['환불 요청합니다'] });
    const result = await t.run();
    expect(t.primaryGenerate).toHaveBeenCalledTimes(1);
    expect(result.resultSummary).toMatchObject({ fallbackFrom: 'local', fallbackCause: 'EMPTY_RESULT', degraded: true });
  });

  it("['  ', ''] 전부 공백 → EMPTY_RESULT", async () => {
    const t = makeRunner({ primaryId: 'gemini', primary: { candidates: ['  ', ''] }, fallbackCandidates: ['환불 요청합니다'] });
    const result = await t.run();
    expect(result.resultSummary).toMatchObject({ fallbackFrom: 'gemini', fallbackCause: 'EMPTY_RESULT' });
  });

  it('부분 성공(1건) → 폴백 0 · 요약 키는 기존 4개뿐(degraded 키 없음)', async () => {
    const t = makeRunner({ primaryId: 'local', primary: { candidates: ['환불 문의드려요'] }, fallbackCandidates: ['x'] });
    const result = await t.run();
    expect(t.getFallbackProvider).not.toHaveBeenCalled();
    expect(Object.keys(result.resultSummary as object).sort()).toEqual(['accepted', 'generated', 'providerId', 'rejected']);
    expect((result.resultSummary as { providerId: string }).providerId).toBe('local');
  });

  it.each(['rule', 'mock'] as const)('%s 구성 0건 → 폴백 0 · 요약이 현행과 deep-equal', async (id) => {
    const t = makeRunner({ primaryId: id, primary: 'generate-only', primaryCandidates: [] });
    const result = await t.run();
    expect(t.getFallbackProvider).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'PARTIAL', resultSummary: { generated: 0, accepted: 0, rejected: {}, providerId: id } });
  });

  it('G1도 0건 → PARTIAL + 폴백 키', async () => {
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'NETWORK' }, fallbackCandidates: [] });
    const result = await t.run();
    expect(result).toEqual({
      status: 'PARTIAL',
      resultSummary: { generated: 0, accepted: 0, rejected: {}, providerId: 'rule', degraded: true, fallbackFrom: 'local', fallbackCause: 'NETWORK' },
    });
    expect(t.fallbackGenerate).toHaveBeenCalledTimes(1);
  });

  it('폴백 후 임베딩 실패는 FAILED EMBEDDING_UNAVAILABLE', async () => {
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'TIMEOUT' }, fallbackCandidates: ['환불 요청합니다'], embedFails: true });
    expect(await t.run()).toEqual({ status: 'FAILED', failureReason: 'EMBEDDING_UNAVAILABLE' });
  });

  it('폴백 경고 로그 1줄에 시드 문장이 없다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'TIMEOUT' }, fallbackCandidates: [] });
    await t.run();
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('G1 폴백'));
    warn.mockRestore();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('from=local cause=TIMEOUT');
    expect(lines[0]).not.toContain('환불');
  });

  // K-1d — 폴백 G1 호출 예외가 Job 전체 FAILED로 번지지 않는다.
  const CONVERGED = {
    status: 'PARTIAL',
    resultSummary: { generated: 0, accepted: 0, rejected: {}, providerId: 'rule', degraded: true, fallbackFrom: 'local', fallbackCause: 'TIMEOUT' },
  };

  it('K-1d ⑩ 폴백 generate()가 거부해도 PARTIAL + 1차 원인 유지(FAILED 아님)', async () => {
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'TIMEOUT' }, fallbackGenerateError: new TypeError('boom') });
    expect(await t.run()).toEqual(CONVERGED);
    expect(t.fallbackGenerate).toHaveBeenCalledTimes(1);
    expect(t.created).toHaveLength(0);
  });

  it('K-1d ⑪ getFallbackProvider()가 던져도 같은 결과', async () => {
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'TIMEOUT' }, getFallbackError: new Error('factory down') });
    expect(await t.run()).toEqual(CONVERGED);
    expect(t.fallbackGenerate).not.toHaveBeenCalled();
  });

  it('K-1d ⑫ 예외 메시지에 시드 문장이 있어도 로그에 문장·메시지가 없다(G1 폴백 줄 1 + 예외 줄 1, 오류 이름만)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'TIMEOUT' }, fallbackGenerateError: new RangeError('환불 하고 싶어요') });
    await t.run();
    const all = warn.mock.calls.map((c) => String(c[0]));
    warn.mockRestore();
    expect(all.filter((m) => m.includes('G1 폴백'))).toHaveLength(1);
    const exc = all.filter((m) => m.includes('폴백 생성기 예외'));
    expect(exc).toHaveLength(1);
    expect(exc[0]).toContain('error=RangeError');
    expect(exc[0]).toContain('cause=TIMEOUT');
    expect(all.join(' | ')).not.toContain('환불');
  });

  it('K-1d Error가 아닌 던짐 값은 error=unknown', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const t = makeRunner({ primaryId: 'local', primary: { candidates: [], failure: 'TIMEOUT' }, fallbackGenerateError: 'plain string' as unknown as Error });
    expect(await t.run()).toEqual(CONVERGED);
    const exc = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('폴백 생성기 예외'));
    warn.mockRestore();
    expect(exc[0]).toContain('error=unknown');
  });
});
