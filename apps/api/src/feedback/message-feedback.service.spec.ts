import { ApiException } from '../common/api.exception';
import { MessageFeedbackService } from './message-feedback.service';

/**
 * `MessageFeedbackService` 단위 시험(mock Prisma) — 코드 리뷰(R1/R2)에서 넘어온 공백을 메운다.
 * HTTP 계약 레벨은 `integration/feedback-loop.integration.spec.ts`가, 순수 판정은
 * `feedback/lib/*.spec.ts`가 다룬다. 이 파일은 `MessageFeedbackService` 자체의 재시도·CAS·
 * 선점 상태 기계 분기(§7.3·§9.4)를 결정적으로 검증한다.
 */
describe('MessageFeedbackService', () => {
  const logRow = {
    id: '11111111-1111-4111-8111-111111111111',
    chatbotId: 'chatbot-1',
    sessionId: 'session-1',
    feedbackOffered: true,
    createdAt: new Date('2026-09-25T00:00:00.000Z'),
    dayBucket: '2026-09-25',
    groupId: 'group-1',
    channelType: 'WEB',
    isAnswered: true,
    answeredByRag: false,
    apiNotice: false,
    inputKind: 'TEXT',
    matchedIntentId: null,
    matchedFaqId: 'faq-1',
    matchedNodeId: null,
    topicId: null,
    userMessage: '해외 배송 되나요?',
  };

  function makeConfig(overrides: Record<string, number> = {}): import('@nestjs/config').ConfigService {
    return { get: (key: string) => overrides[key] } as unknown as import('@nestjs/config').ConfigService;
  }

  function makePrisma(overrides: {
    conversationLog?: Partial<Record<string, jest.Mock>>;
    messageFeedback?: Partial<Record<string, jest.Mock>>;
  } = {}): import('../prisma/prisma.service').PrismaService {
    return {
      conversationLog: {
        findUnique: jest.fn().mockResolvedValue(logRow),
        ...overrides.conversationLog,
      },
      messageFeedback: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        ...overrides.messageFeedback,
      },
    } as unknown as import('../prisma/prisma.service').PrismaService;
  }

  function makeCollector(overrides: Partial<Record<string, jest.Mock>> = {}): import('../learning/unanswered-collector.service').UnansweredCollectorService {
    return {
      collectNegativeFeedback: jest.fn().mockResolvedValue({ kind: 'QUEUED', id: 'queue-item-1' }),
      ...overrides,
    } as unknown as import('../learning/unanswered-collector.service').UnansweredCollectorService;
  }

  const input = { chatbotId: 'chatbot-1', messageId: logRow.id, sessionId: 'session-1', rating: 'UP' as const };

  describe('CREATE — P2002 재시도', () => {
    it('첫 create가 P2002로 실패하면 1회 재실행해 성공한다', async () => {
      const created = { id: 'fb-1', rating: 'UP', queueOutcome: null };
      const createMock = jest.fn().mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' })).mockResolvedValueOnce(created);
      const prisma = makePrisma({ messageFeedback: { create: createMock } });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      const result = await service.submit(input);

      expect(result).toEqual({ rating: 'UP' });
      expect(createMock).toHaveBeenCalledTimes(2);
      // 재시도 경로에서도 로그 PK는 최초 1회만 조회한다(결합 검증은 재조회하지 않는다).
      expect((prisma.conversationLog.findUnique as jest.Mock)).toHaveBeenCalledTimes(1);
    });

    it('P2002가 두 번 연속 나면(드묾) 안전한 쪽(CLOSED)으로 수렴해 409를 던진다', async () => {
      const createMock = jest
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
        .mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
      const prisma = makePrisma({ messageFeedback: { create: createMock } });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      try {
        await service.submit(input);
        fail('예외가 던져져야 한다');
      } catch (e) {
        expect((e as ApiException).getStatus()).toBe(409);
        expect((e as ApiException).getResponse()).toMatchObject({ code: 'FEEDBACK_CLOSED' });
      }
      expect(createMock).toHaveBeenCalledTimes(2);
    });

    it('create가 P2002가 아닌 다른 오류로 실패하면 그대로 전파한다', async () => {
      const createMock = jest.fn().mockRejectedValue(new Error('DB down'));
      const prisma = makePrisma({ messageFeedback: { create: createMock } });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      await expect(service.submit(input)).rejects.toThrow('DB down');
    });
  });

  describe('CHANGE — CAS 재시도', () => {
    const existing = { id: 'fb-1', rating: 'UP', changeCount: 1, conversationLogId: logRow.id, queueOutcome: null };

    it('updateMany count===0(경합)이면 1회 재실행하고, 두 번째에 성공하면 완료한다', async () => {
      const findUniqueFeedback = jest.fn().mockResolvedValue(existing);
      const updateMany = jest.fn().mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      const prisma = makePrisma({
        messageFeedback: { findUnique: findUniqueFeedback, updateMany, update: jest.fn().mockResolvedValue({}) },
      });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      const result = await service.submit({ ...input, rating: 'DOWN' });

      expect(result).toEqual({ rating: 'DOWN' });
      expect(updateMany).toHaveBeenCalledTimes(2);
    });

    it('updateMany count===0이 재시도에도 계속되면(연속 경합) 409 FEEDBACK_CLOSED로 끝난다', async () => {
      const findUniqueFeedback = jest.fn().mockResolvedValue(existing);
      const updateMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = makePrisma({ messageFeedback: { findUnique: findUniqueFeedback, updateMany } });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      try {
        await service.submit({ ...input, rating: 'DOWN' });
        fail('예외가 던져져야 한다');
      } catch (e) {
        expect((e as ApiException).getStatus()).toBe(409);
        expect((e as ApiException).getResponse()).toMatchObject({ code: 'FEEDBACK_CLOSED' });
      }
      expect(updateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('claimAndEnqueue — 선점 상태 기계', () => {
    it('선점(claim)에 실패하면(count===0) 편입 자체를 생략한다(수집기 호출 0)', async () => {
      const created = { id: 'fb-1', rating: 'DOWN', queueOutcome: null };
      const createMock = jest.fn().mockResolvedValue(created);
      const claimUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
      const collector = makeCollector();
      const prisma = makePrisma({ messageFeedback: { create: createMock, updateMany: claimUpdateMany } });
      const service = new MessageFeedbackService(prisma, makeConfig(), collector);

      const result = await service.submit({ ...input, rating: 'DOWN' });

      expect(result).toEqual({ rating: 'DOWN' });
      expect(claimUpdateMany).toHaveBeenCalledWith({ where: { id: 'fb-1', queueOutcome: null }, data: { queueOutcome: 'CLAIMED' } });
      expect(collector.collectNegativeFeedback).not.toHaveBeenCalled();
    });

    it('collectNegativeFeedback이 예외를 던지면(예상치 못한 오류) queueOutcome=FAILED로 흡수하고 응답은 여전히 성공(rating 반환)이다', async () => {
      const created = { id: 'fb-1', rating: 'DOWN', queueOutcome: null };
      const createMock = jest.fn().mockResolvedValue(created);
      const claimUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const updateMock = jest.fn().mockResolvedValue({});
      const collector = makeCollector({ collectNegativeFeedback: jest.fn().mockRejectedValue(new Error('예상치 못한 실패')) });
      const prisma = makePrisma({ messageFeedback: { create: createMock, updateMany: claimUpdateMany, update: updateMock } });
      const service = new MessageFeedbackService(prisma, makeConfig(), collector);

      const result = await service.submit({ ...input, rating: 'DOWN' });

      expect(result).toEqual({ rating: 'DOWN' });
      expect(updateMock).toHaveBeenCalledWith({ where: { id: 'fb-1' }, data: { queueOutcome: 'FAILED' } });
    });

    it('collectNegativeFeedback이 FAILED를 반환해도(내부에서 흡수된 실패) queueOutcome=FAILED로 기록하고 응답은 성공이다', async () => {
      const created = { id: 'fb-1', rating: 'DOWN', queueOutcome: null };
      const createMock = jest.fn().mockResolvedValue(created);
      const claimUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      const updateMock = jest.fn().mockResolvedValue({});
      const collector = makeCollector({ collectNegativeFeedback: jest.fn().mockResolvedValue({ kind: 'FAILED' }) });
      const prisma = makePrisma({ messageFeedback: { create: createMock, updateMany: claimUpdateMany, update: updateMock } });
      const service = new MessageFeedbackService(prisma, makeConfig(), collector);

      const result = await service.submit({ ...input, rating: 'DOWN' });

      expect(result).toEqual({ rating: 'DOWN' });
      expect(updateMock).toHaveBeenCalledWith({ where: { id: 'fb-1' }, data: { queueOutcome: 'FAILED' } });
    });

    it('rating=UP이면 claimAndEnqueue 자체를 호출하지 않는다(👍는 큐 비반영 — J-10)', async () => {
      const created = { id: 'fb-1', rating: 'UP', queueOutcome: null };
      const createMock = jest.fn().mockResolvedValue(created);
      const claimUpdateMany = jest.fn();
      const collector = makeCollector();
      const prisma = makePrisma({ messageFeedback: { create: createMock, updateMany: claimUpdateMany } });
      const service = new MessageFeedbackService(prisma, makeConfig(), collector);

      await service.submit({ ...input, rating: 'UP' });

      expect(claimUpdateMany).not.toHaveBeenCalled();
      expect(collector.collectNegativeFeedback).not.toHaveBeenCalled();
    });

    it('이미 queueOutcome이 있는 행(재요청)은 claimAndEnqueue를 다시 시도하지 않는다', async () => {
      const existingDown = { id: 'fb-1', rating: 'DOWN', changeCount: 0, conversationLogId: logRow.id, queueOutcome: 'QUEUED' };
      const findUniqueFeedback = jest.fn().mockResolvedValue(existingDown);
      const claimUpdateMany = jest.fn();
      const prisma = makePrisma({ messageFeedback: { findUnique: findUniqueFeedback, updateMany: claimUpdateMany } });
      const collector = makeCollector();
      const service = new MessageFeedbackService(prisma, makeConfig(), collector);

      // 같은 값(DOWN) 재요청 — NOOP 경로. 이미 queueOutcome='QUEUED'라 편입을 다시 시도하지 않는다.
      const result = await service.submit({ ...input, rating: 'DOWN' });

      expect(result).toEqual({ rating: 'DOWN' });
      expect(claimUpdateMany).not.toHaveBeenCalled();
      expect(collector.collectNegativeFeedback).not.toHaveBeenCalled();
    });
  });

  describe('비UUID·결합 검증 실패', () => {
    it('messageId가 UUID 형식이 아니면 로그 조회 없이 404다', async () => {
      const findUnique = jest.fn();
      const prisma = makePrisma({ conversationLog: { findUnique } });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      await expect(service.submit({ ...input, messageId: 'not-a-uuid' })).rejects.toThrow(ApiException);
      expect(findUnique).not.toHaveBeenCalled();
    });

    it('로그 행이 없으면(적재 실패·미도달) 404다', async () => {
      const prisma = makePrisma({ conversationLog: { findUnique: jest.fn().mockResolvedValue(null) } });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      try {
        await service.submit(input);
        fail('예외가 던져져야 한다');
      } catch (e) {
        expect((e as ApiException).getStatus()).toBe(404);
        expect((e as ApiException).getResponse()).toMatchObject({ code: 'FEEDBACK_TARGET_NOT_FOUND' });
      }
    });

    it('sessionId가 로그 행과 다르면 404다(다른 세션의 메시지 위조 방지)', async () => {
      const prisma = makePrisma();
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      await expect(service.submit({ ...input, sessionId: 'other-session' })).rejects.toThrow(ApiException);
    });

    it('chatbotId가 로그 행과 다르면 404다(교차 챗봇 방지)', async () => {
      const prisma = makePrisma();
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      await expect(service.submit({ ...input, chatbotId: 'other-chatbot' })).rejects.toThrow(ApiException);
    });

    it('feedbackOffered=false인 턴은 404다(평가 버튼이 없었던 턴)', async () => {
      const prisma = makePrisma({ conversationLog: { findUnique: jest.fn().mockResolvedValue({ ...logRow, feedbackOffered: false }) } });
      const service = new MessageFeedbackService(prisma, makeConfig(), makeCollector());

      await expect(service.submit(input)).rejects.toThrow(ApiException);
    });
  });
});
