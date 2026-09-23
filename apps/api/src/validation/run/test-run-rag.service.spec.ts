import { TestRunRagService } from './test-run-rag.service';

/**
 * TC 실행의 RAG(2단계) 취급 단위 시험(J-10, ADR-0030 §3, FR-V2-20~23).
 * `RagHttpClient`/`RagGateService`는 모킹한다 — 실제 외부 HTTP 호출은 발생시키지 않는다.
 */
function buildSettings(overrides: Partial<{ ragEnabled: boolean; ragCompany: string | null }> = {}) {
  return {
    ragEnabled: true,
    ragCompany: 'acme',
    ragCategory: null,
    ragSubcategory: null,
    ragSimilarityThreshold: null,
    ragTimeoutMs: 120000,
    ...overrides,
  };
}

function buildDeps(configured = true) {
  const ragHttpClient = {
    isConfigured: jest.fn().mockReturnValue(configured),
    query: jest.fn().mockResolvedValue({
      networkError: false,
      httpStatus: 200,
      body: { result: '답변입니다', keywords: [], source_info: { total_sources: 2, sources: [] }, retrieval_success: 1 },
    }),
  };
  const ragGate = {
    tryAcquire: jest.fn().mockReturnValue(true),
    release: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };
  return { ragHttpClient, ragGate };
}

describe('TestRunRagService.attempt — J-10/ADR-0030 §3', () => {
  it('band가 FAILED가 아니면 wouldUseRag=false이고 HTTP 호출이 0건이다', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    const result = await service.attempt('질문', 'CONFIRMED', buildSettings(), true, true);
    expect(result.wouldUseRag).toBe(false);
    expect(ragHttpClient.query).not.toHaveBeenCalled();
  });

  it('band=FAILED이지만 ragEnabled=false면 wouldUseRag=false, HTTP 호출 0건', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    const result = await service.attempt('질문', 'FAILED', buildSettings({ ragEnabled: false }), true, true);
    expect(result.wouldUseRag).toBe(false);
    expect(ragHttpClient.query).not.toHaveBeenCalled();
  });

  it('band=FAILED + ragEnabled=true지만 useRag(실행 옵션)=false면 wouldUseRag=true로 표시만 하고 HTTP는 호출하지 않는다(AC-V3-10과 대칭)', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    const result = await service.attempt('질문', 'FAILED', buildSettings(), false, true);
    expect(result.wouldUseRag).toBe(true);
    expect(result.ragAttempted).toBeUndefined();
    expect(ragHttpClient.query).not.toHaveBeenCalled();
  });

  it('상한 초과(underBudget=false)면 wouldUseRag=true만 표시하고 실제 호출은 하지 않는다(FR-V2-20, 51번째 이후 동작)', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    const result = await service.attempt('질문', 'FAILED', buildSettings(), true, false);
    expect(result.wouldUseRag).toBe(true);
    expect(result.ragAttempted).toBeUndefined();
    expect(ragHttpClient.query).not.toHaveBeenCalled();
    expect(ragGate.tryAcquire).not.toHaveBeenCalled();
  });

  it('게이트 획득 실패 시 대기하지 않고 즉시 건너뛴다(wouldUseRag=true, HTTP 0건, FR-V2-22)', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    ragGate.tryAcquire.mockReturnValue(false);
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    const result = await service.attempt('질문', 'FAILED', buildSettings(), true, true);
    expect(result.wouldUseRag).toBe(true);
    expect(result.ragAttempted).toBeUndefined();
    expect(ragHttpClient.query).not.toHaveBeenCalled();
  });

  it('정상 조건을 모두 만족하면 실제로 호출하고 게이트를 release한다(성공 시 recordSuccess)', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    const result = await service.attempt('질문', 'FAILED', buildSettings(), true, true);
    expect(result.wouldUseRag).toBe(true);
    expect(result.ragAttempted).toBe(true);
    expect(ragHttpClient.query).toHaveBeenCalledTimes(1);
    expect(ragGate.release).toHaveBeenCalledTimes(1);
    expect(ragGate.recordSuccess).toHaveBeenCalledTimes(1);
  });

  it('질문 문장을 PII 마스킹한 뒤에만 RagHttpClient.query에 전달한다(외부 송신 직전 마스킹 규약)', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    await service.attempt('제 전화번호는 010-1234-5678 입니다', 'FAILED', buildSettings(), true, true);
    const sentQuestion = (ragHttpClient.query.mock.calls[0][0] as { question: string }).question;
    expect(sentQuestion).not.toContain('010-1234-5678');
  });

  it('HTTP 실패(네트워크 오류)여도 게이트는 반드시 release된다(finally)', async () => {
    const { ragHttpClient, ragGate } = buildDeps();
    ragHttpClient.query.mockRejectedValue(new Error('네트워크 오류'));
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    await expect(service.attempt('질문', 'FAILED', buildSettings(), true, true)).rejects.toThrow();
    expect(ragGate.release).toHaveBeenCalledTimes(1);
  });

  it('RAG를 아예 시도하지 않으면(HTTP 미설정) wouldUseRag=false다(isConfigured=false)', async () => {
    const { ragHttpClient, ragGate } = buildDeps(false);
    const service = new TestRunRagService(ragHttpClient as never, ragGate as never);
    const result = await service.attempt('질문', 'FAILED', buildSettings(), true, true);
    expect(result.wouldUseRag).toBe(false);
    expect(ragHttpClient.query).not.toHaveBeenCalled();
  });
});
