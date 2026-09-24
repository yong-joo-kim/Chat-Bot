import { ConfigService } from '@nestjs/config';
import { CONVERSATION_STATE_VERSION } from '@chat-bot/shared-types';
import type { ChatbotAnswerSetting, ConversationState, DialogOutput } from '@chat-bot/shared-types';
import { PublicConversationService } from './public-conversation.service';
import type { PublicAccessService } from './public-access.service';
import type { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import type { ChannelAdapterFactory } from './adapters/channel-adapter.factory';
import type { ConversationLogService } from './conversation-log.service';
import type { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import type { SemanticMatchService } from '../embedding/semantic-match.service';
import type { AnswerSettingsCacheService } from '../answer-settings/answer-settings-cache.service';
import type { RagHttpClient } from '../rag/rag-http.client';
import type { RagGateService } from '../rag/rag-gate.service';
import type { RagAnswerService } from '../rag/rag-answer.service';
import type { PendingAnswerStore } from '../rag/pending-answer.store';
import type { LegacyApiService } from '../legacy-api/legacy-api.service';
import type { SurveyResponseService } from '../survey-responses/survey-response.service';

/** `startPendingRagAnswer()` 입력 중 이 회귀 테스트에서 값이 중요하지 않은 필드들을 채운다. */
function makeSettings(): ChatbotAnswerSetting {
  const now = new Date();
  return {
    chatbotId: '11111111-1111-4111-8111-111111111111',
    semanticEnabled: false,
    acceptThreshold: 0.8,
    lowThreshold: 0.6,
    marginThreshold: 0.05,
    ragEnabled: true,
    ragCompany: '테스트기관',
    ragCategory: null,
    ragSubcategory: null,
    ragSimilarityThreshold: null,
    fallbackPolicy: 'RAG_FIRST',
    showSources: true,
    ragTimeoutMs: 120_000,
    createdAt: now,
    updatedAt: now,
  };
}

function makeNextState(): ConversationState {
  return { version: CONVERSATION_STATE_VERSION, contextSession: null };
}

interface Deps {
  service: PublicConversationService;
  pendingStore: { create: jest.Mock; get: jest.Mock; complete: jest.Mock };
  bannedWordFilter: { maskOutbound: jest.Mock; evaluateInbound: jest.Mock };
  ragGate: { tryAcquire: jest.Mock; release: jest.Mock };
  ragAnswer: { enqueue: jest.Mock };
}

/**
 * `startPendingRagAnswer()`가 의존하는 협력자만 모킹한다 — `sendMessage()` 전체 파이프라인
 * (`resolveTurn`, DB 조회 등)까지 통과시키지 않고, 버그가 있던 지점만 직접 겨냥한다.
 */
function makeService(overrides: { createThrows?: unknown; maskThrows?: unknown } = {}): Deps {
  const pendingStore = {
    create: overrides.createThrows ? jest.fn(() => { throw overrides.createThrows; }) : jest.fn(),
    get: jest.fn(),
    complete: jest.fn(),
  };
  const bannedWordFilter = {
    maskOutbound: overrides.maskThrows
      ? jest.fn().mockRejectedValue(overrides.maskThrows)
      : jest.fn(async (outputs: DialogOutput[]) => outputs),
    evaluateInbound: jest.fn(),
  };
  const ragGate = { tryAcquire: jest.fn(() => true), release: jest.fn() };
  const ragAnswer = { enqueue: jest.fn() };
  const config = { get: jest.fn(() => undefined) } as unknown as ConfigService;

  const service = new PublicConversationService(
    {} as PublicAccessService,
    {} as DialogueBundleService,
    {} as ChannelAdapterFactory,
    {} as ConversationLogService,
    bannedWordFilter as unknown as BannedWordFilterService,
    {} as SemanticMatchService,
    {} as AnswerSettingsCacheService,
    {} as RagHttpClient,
    ragGate as unknown as RagGateService,
    ragAnswer as unknown as RagAnswerService,
    pendingStore as unknown as PendingAnswerStore,
    config,
    {} as LegacyApiService,
    {} as SurveyResponseService,
  );

  return { service, pendingStore, bannedWordFilter, ragGate, ragAnswer };
}

function makeInput() {
  return {
    slug: 'test-bot',
    chatbotId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    messageId: '33333333-3333-4333-8333-333333333333',
    inbound: { sessionId: '22222222-2222-4222-8222-222222222222', message: '테스트 질문' },
    settings: makeSettings(),
    fallbackText: '폴백 문구',
    inputKind: 'TEXT' as const,
    nextState: makeNextState(),
    stateReset: false,
  };
}

/**
 * 회귀 테스트 — `ragGate.tryAcquire()`로 슬롯을 확보한 뒤 `ragAnswer.enqueue()`(→
 * `RagAnswerService.run()`의 `try/finally`)로 인계되기 **전에** 예외가 발생하면, 슬롯을 영구
 * 누수하지 않고 그 자리에서 반납해야 한다(code-reviewer 지적 버그, High).
 */
describe('PublicConversationService — RAG 슬롯 누수 회귀 테스트', () => {
  it('pendingStore.create()가 예외를 던지면 슬롯을 반납하고 enqueue()는 호출되지 않는다', async () => {
    const boom = new Error('create 실패');
    const { service, ragGate, ragAnswer } = makeService({ createThrows: boom });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((service as any).startPendingRagAnswer(makeInput())).rejects.toThrow('create 실패');

    expect(ragGate.release).toHaveBeenCalledTimes(1);
    expect(ragAnswer.enqueue).not.toHaveBeenCalled();
  });

  it('maskOutbound()가 예외를 던지면 슬롯을 반납하고 enqueue()는 호출되지 않는다', async () => {
    const boom = new Error('mask 실패');
    const { service, ragGate, ragAnswer } = makeService({ maskThrows: boom });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect((service as any).startPendingRagAnswer(makeInput())).rejects.toThrow('mask 실패');

    expect(ragGate.release).toHaveBeenCalledTimes(1);
    expect(ragAnswer.enqueue).not.toHaveBeenCalled();
  });

  it('정상 경로에서는 enqueue()가 호출되고, 슬롯 반납 책임은 여기서 넘겨받지 않는다(이중 반납 방지)', async () => {
    const { service, ragGate, ragAnswer, pendingStore } = makeService();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (service as any).startPendingRagAnswer(makeInput());

    expect(pendingStore.create).toHaveBeenCalledTimes(1);
    expect(ragAnswer.enqueue).toHaveBeenCalledTimes(1);
    // 슬롯 인계 이후의 반납은 `RagAnswerService.run()`의 몫이다 — 여기서 또 release()를
    // 호출하면 이중 반납(double-release)이 되어 동시성 상한이 실제보다 넉넉해진다.
    expect(ragGate.release).not.toHaveBeenCalled();
    expect(response.pendingAnswer).toBeDefined();
  });
});
