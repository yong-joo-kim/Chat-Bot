import { RagAnswerService } from './rag-answer.service';
import type { RagHttpClient, RagSendResult } from './rag-http.client';
import type { RagGateService } from './rag-gate.service';
import type { RagCallLogService } from './rag-call-log.service';
import type { PendingAnswerStore } from './pending-answer.store';
import type { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import type { ConversationLogPort } from './conversation-log.port';

/**
 * `RagAnswerService.run()`(§9.2~§9.9, ADR-0023) 오케스트레이션 단위 시험 — 개별 순수 함수
 * (`judge-rag-response.spec.ts`/`sanitize-sources.spec.ts`/`should-run-rag.spec.ts`)는 이미
 * 커버돼 있으나, 이들을 실제로 연결한 배선(재시도 정책·회로차단 연동·`PendingAnswerStore` 완료
 * 처리·`ConversationLogPort` 기록)에는 전용 시험이 없었다 — "공개 위젯 통합 시나리오"의 백엔드
 * 절반을 검증한다(위젯 DOM 레벨 절반은 `apps/widget/src/ui/app.pending.spec.ts`).
 */
function ok200(body: unknown): RagSendResult {
  return { networkError: false, httpStatus: 200, body };
}
function status(httpStatus: number, body: unknown = {}): RagSendResult {
  return { networkError: false, httpStatus, body };
}
function networkError(): RagSendResult {
  return { networkError: true };
}

function makeService(overrides: {
  ragHttpClient?: Partial<Record<'isConfigured' | 'query', jest.Mock>>;
  gate?: Partial<Record<'isVllmReady' | 'recordFailure' | 'recordSuccess' | 'release', jest.Mock>>;
} = {}) {
  const ragHttpClient = {
    isConfigured: jest.fn(() => true),
    query: jest.fn(),
    ...overrides.ragHttpClient,
  };
  const gate = {
    isVllmReady: jest.fn(async () => true),
    recordFailure: jest.fn(),
    recordSuccess: jest.fn(),
    release: jest.fn(),
    ...overrides.gate,
  };
  const callLog = { record: jest.fn(async () => undefined) };
  const pendingStore = { complete: jest.fn(), create: jest.fn(), get: jest.fn() };
  const bannedWordFilter = { maskOutbound: jest.fn(async (outputs: unknown[]) => outputs) };
  const logPort: { record: jest.Mock } = { record: jest.fn(async () => undefined) };

  const service = new RagAnswerService(
    ragHttpClient as unknown as RagHttpClient,
    gate as unknown as RagGateService,
    callLog as unknown as RagCallLogService,
    pendingStore as unknown as PendingAnswerStore,
    bannedWordFilter as unknown as BannedWordFilterService,
  );

  return { service, ragHttpClient, gate, callLog, pendingStore, bannedWordFilter, logPort };
}

function makeInput(overrides: Partial<Parameters<RagAnswerService['enqueue']>[0]> = {}) {
  return {
    messageId: '11111111-1111-4111-8111-111111111111',
    chatbotId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    question: '산재 요양급여 신청 서류가 뭔가요?',
    scope: { company: '테스트기관' },
    timeoutMs: 120_000,
    showSources: true,
    fallbackText: '죄송해요, 잘 이해하지 못했어요.',
    inputKind: 'TEXT' as const,
    ...overrides,
  };
}

async function run(service: RagAnswerService, input: ReturnType<typeof makeInput>, logPort: ConversationLogPort): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (service as any).run(input, logPort);
}

describe('RagAnswerService.run() — 성공/실패 오케스트레이션', () => {
  it('RAG 미설정(isConfigured=false)이면 외부 호출 없이 즉시 폴백 완료 처리한다', async () => {
    const { service, ragHttpClient, pendingStore, gate, logPort } = makeService({ ragHttpClient: { isConfigured: jest.fn(() => false) } });
    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    expect(ragHttpClient.query).not.toHaveBeenCalled();
    expect(pendingStore.complete).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(logPort.record).toHaveBeenCalledWith(expect.objectContaining({ isAnswered: false, answeredByRag: false }));
    expect(gate.release).toHaveBeenCalledTimes(1);
  });

  it('vLLM 미준비(isVllmReady=false)면 외부 질의 없이 CIRCUIT_OPEN으로 기록하고 폴백한다', async () => {
    const { service, ragHttpClient, gate, callLog, pendingStore, logPort } = makeService({ gate: { isVllmReady: jest.fn(async () => false) } });
    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    expect(ragHttpClient.query).not.toHaveBeenCalled();
    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'CIRCUIT_OPEN' }));
    expect(pendingStore.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'FAILED' }));
    expect(gate.release).toHaveBeenCalledTimes(1);
  });

  it('성공(retrieval_success=1)이면 출처와 함께 READY로 완료하고 로그에 answeredByRag=true를 남긴다', async () => {
    const { service, ragHttpClient, gate, callLog, pendingStore, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(
      ok200({
        result: '요양급여 신청에는 재해경위서가 필요합니다.',
        keywords: [],
        source_info: { total_sources: 1, sources: [{ file_path: '/home/doota/산재보험안내.pdf', page: 12, section_title: '요양급여 신청' }] },
        retrieval_success: 1,
      }),
    );

    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    expect(gate.recordSuccess).toHaveBeenCalledTimes(1);
    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SUCCESS', retrievalSuccess: 1 }));
    expect(pendingStore.complete).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.objectContaining({
        status: 'READY',
        outputs: [{ type: 'TEXT', payload: { text: '요양급여 신청에는 재해경위서가 필요합니다.' } }],
        sources: [{ fileName: '산재보험안내.pdf', sectionTitle: '요양급여 신청', page: 12 }],
      }),
    );
    expect(logPort.record).toHaveBeenCalledWith(
      expect.objectContaining({ isAnswered: true, answeredByRag: true, rawBotResponse: '요양급여 신청에는 재해경위서가 필요합니다.' }),
    );
    expect(gate.release).toHaveBeenCalledTimes(1);
  });

  it('AC-N2-5: retrieval_success=0(무근거)이면 NO_EVIDENCE로 기록하고 우리 폴백 문구로 완료한다', async () => {
    const { service, ragHttpClient, callLog, pendingStore, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(ok200({ result: '', keywords: [], source_info: null, retrieval_success: 0 }));

    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'NO_EVIDENCE' }));
    expect(pendingStore.complete).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'FAILED', outputs: [{ type: 'TEXT', payload: { text: '죄송해요, 잘 이해하지 못했어요.' } }] }),
    );
    expect(logPort.record).toHaveBeenCalledWith(expect.objectContaining({ isAnswered: false, answeredByRag: false }));
  });

  it('AC-N2-4/J-9: 질문에 개인정보가 섞이면 외부로 나가는 question이 마스킹된 문장이다', async () => {
    const { service, ragHttpClient, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(ok200({ result: '안내드립니다.', keywords: [], source_info: null, retrieval_success: 1 }));

    await run(
      service,
      makeInput({ question: '제 번호 010-1234-5678로 결과 알려주세요' }),
      logPort as unknown as ConversationLogPort,
    );

    const sentQuestion = (ragHttpClient.query.mock.calls[0][0] as { question: string }).question;
    expect(sentQuestion).toBe('제 번호 010-****-5678로 결과 알려주세요');
    expect(sentQuestion).not.toContain('1234');
  });

  it('AC-N2-6: LLM 오류 접두어로 시작하면 성공 응답이어도 그 문자열을 노출하지 않고 폴백 처리한다', async () => {
    const { service, ragHttpClient, pendingStore, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(
      ok200({ result: '답변 생성 중 오류가 발생했습니다: 내부 오류', keywords: [], source_info: { total_sources: 1, sources: [] }, retrieval_success: 1 }),
    );

    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    const completedArg = pendingStore.complete.mock.calls[0][1] as { status: string; outputs: Array<{ payload: { text: string } }> };
    expect(completedArg.status).toBe('FAILED');
    expect(JSON.stringify(completedArg.outputs)).not.toContain('내부 오류');
  });
});

describe('RagAnswerService.run() — 재시도 정책(FR-N2-27, AC-N2-10/11)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('AC-N2-11: 503 + code:SERVER_OVERLOAD는 1회 재시도(5초 백오프) 후에도 실패면 UPSTREAM_ERROR·retryCount=1이다', async () => {
    const { service, ragHttpClient, gate, callLog, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(status(503, { code: 'SERVER_OVERLOAD' })).mockResolvedValueOnce(status(503, { code: 'SERVER_OVERLOAD' }));

    const promise = run(service, makeInput(), logPort as unknown as ConversationLogPort);
    await jest.advanceTimersByTimeAsync(5000);
    await promise;

    expect(ragHttpClient.query).toHaveBeenCalledTimes(2);
    expect(gate.recordFailure).toHaveBeenCalledTimes(1);
    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'UPSTREAM_ERROR', httpStatus: 503, retryCount: 1 }));
  });

  it('AC-N2-10: 503 + code 없음(vLLM 미준비)은 재시도하지 않고 즉시 실패한다', async () => {
    const { service, ragHttpClient, callLog, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(status(503, {}));

    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    expect(ragHttpClient.query).toHaveBeenCalledTimes(1);
    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'UPSTREAM_ERROR', httpStatus: 503, retryCount: 0 }));
  });

  it('429는 1회 재시도(3초 백오프) 후 성공하면 성공으로 마무리되고 retryCount=1이 기록된다', async () => {
    const { service, ragHttpClient, callLog, pendingStore, logPort } = makeService();
    ragHttpClient.query
      .mockResolvedValueOnce(status(429))
      .mockResolvedValueOnce(ok200({ result: '답변', keywords: [], source_info: null, retrieval_success: 1 }));

    const promise = run(service, makeInput(), logPort as unknown as ConversationLogPort);
    await jest.advanceTimersByTimeAsync(3000);
    await promise;

    expect(ragHttpClient.query).toHaveBeenCalledTimes(2);
    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SUCCESS', retryCount: 1 }));
    expect(pendingStore.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'READY' }));
  });

  it('408/500/400은 재시도하지 않는다', async () => {
    const { service, ragHttpClient, callLog, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(status(500));

    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    expect(ragHttpClient.query).toHaveBeenCalledTimes(1);
    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'UPSTREAM_ERROR', httpStatus: 500, retryCount: 0 }));
  });

  it('네트워크 오류(타임아웃 포함)는 재시도 없이 TIMEOUT으로 기록된다', async () => {
    const { service, ragHttpClient, callLog, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(networkError());

    await run(service, makeInput(), logPort as unknown as ConversationLogPort);

    expect(ragHttpClient.query).toHaveBeenCalledTimes(1);
    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'TIMEOUT' }));
  });

  it('AC-N2-28: 스키마와 다른 응답(retrieval_success이 문자열)은 예외 없이 SCHEMA_INVALID로 폴백된다', async () => {
    const { service, ragHttpClient, callLog, pendingStore, logPort } = makeService();
    ragHttpClient.query.mockResolvedValueOnce(ok200({ result: '답변', keywords: [], source_info: null, retrieval_success: '1' }));

    await expect(run(service, makeInput(), logPort as unknown as ConversationLogPort)).resolves.not.toThrow();

    expect(callLog.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'SCHEMA_INVALID' }));
    expect(pendingStore.complete).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'FAILED' }));
  });
});
