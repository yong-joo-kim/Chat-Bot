import { ApiException } from '../common/api.exception';
import { ChatbotPublicationService } from './publication.service';

/**
 * 새 테스트 — 구현·리뷰 단계 공백 보강(2026-09-24, No.28 시험 회차). `ChatbotPublicationService`
 * (§5.4 — 공개 전환 원자 경로)는 이전까지 전용 단위 시험이 없었다(통합 시험은 정상 경로만 일부
 * 커버). 여기서는 판정 로직(NOOP/ARCHIVED/원자성/감사 접두·actorOverride)을 가짜 Prisma tx로
 * 검증하고, 실제 트랜잭션 롤백(주입 오류 시 상태·채널 둘 다 되돌아가는지)은 통합 시험
 * (`scheduled-deploy.integration.spec.ts` AC-D2-4)에서 실제 SQLite로 검증한다.
 */
describe('ChatbotPublicationService(§5.4)', () => {
  function makeTx(overrides: { chatbot?: unknown; channel?: unknown } = {}) {
    const chatbot = { status: 'DRAFT', name: '테스트봇', ...(overrides.chatbot as object) };
    const channelRow = overrides.channel === undefined ? null : overrides.channel;
    return {
      chatbot: {
        findUnique: jest.fn().mockResolvedValue(chatbot),
        update: jest.fn().mockResolvedValue(undefined),
      },
      channel: {
        findUnique: jest.fn().mockResolvedValue(channelRow),
        update: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue({ id: 'channel-new' }),
      },
    };
  }

  function makeDeps(tx: ReturnType<typeof makeTx>) {
    const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
    const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    return { prisma, auditLogService };
  }

  describe('publish()', () => {
    it('DRAFT + enableWebChannel:true — 상태·채널 둘 다 바뀌고 감사가 각각 기록된다(actorOverride·접두 포함)', async () => {
      const tx = makeTx({ channel: { id: 'ch-1', enabled: false } });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      const result = await service.publish(
        'bot-1',
        { enableWebChannel: true },
        { actor: { id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR' }, auditSummaryPrefix: '[예약 실행 #12345678] ' },
      );

      expect(result).toEqual({ changed: true, statusBefore: 'DRAFT', statusAfter: 'ACTIVE', channelBefore: false, channelAfter: true });
      expect(tx.chatbot.update).toHaveBeenCalledWith({ where: { id: 'bot-1' }, data: { status: 'ACTIVE' } });
      expect(tx.channel.update).toHaveBeenCalledWith({ where: { id: 'ch-1' }, data: { enabled: true } });

      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'STATUS_CHANGE',
          targetType: 'Chatbot',
          summary: '[예약 실행 #12345678] 상태 변경: DRAFT → ACTIVE',
          actorOverride: { id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR' },
        }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          targetType: 'Channel',
          summary: '[예약 실행 #12345678] 사용 여부 변경: false → true',
          actorOverride: { id: 'u1', email: 'editor@chat-bot.local', role: 'EDITOR' },
        }),
      );
    });

    it('이미 ACTIVE + 채널도 이미 열려 있으면 NOOP — 쓰기·감사 0건(FR-D3-13)', async () => {
      const tx = makeTx({ chatbot: { status: 'ACTIVE' }, channel: { id: 'ch-1', enabled: true } });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      const result = await service.publish('bot-1', { enableWebChannel: true });

      expect(result.changed).toBe(false);
      expect(tx.chatbot.update).not.toHaveBeenCalled();
      expect(tx.channel.update).not.toHaveBeenCalled();
      expect(tx.channel.create).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('이미 ACTIVE지만 채널이 닫혀 있고 enableWebChannel:true면 채널만 켜고 APPLIED다(목표=ACTIVE+채널 열림)', async () => {
      const tx = makeTx({ chatbot: { status: 'ACTIVE' }, channel: { id: 'ch-1', enabled: false } });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      const result = await service.publish('bot-1', { enableWebChannel: true });

      expect(result.changed).toBe(true);
      expect(tx.chatbot.update).not.toHaveBeenCalled();
      expect(tx.channel.update).toHaveBeenCalledWith({ where: { id: 'ch-1' }, data: { enabled: true } });
    });

    it('WEB 채널 행이 없고 enableWebChannel:true면 기본 config로 새로 만든다', async () => {
      const tx = makeTx({ channel: null });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      await service.publish('bot-1', { enableWebChannel: true });

      expect(tx.channel.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ chatbotId: 'bot-1', type: 'WEB', enabled: true }) }));
      expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', targetType: 'Channel' }));
    });

    it('ARCHIVED 챗봇은 CHATBOT_ARCHIVED(409)로 거부된다(트랜잭션 안 재확인)', async () => {
      const tx = makeTx({ chatbot: { status: 'ARCHIVED' } });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      await expect(service.publish('bot-1', { enableWebChannel: false })).rejects.toMatchObject({ getResponse: expect.any(Function) });
      try {
        await service.publish('bot-1', { enableWebChannel: false });
      } catch (e) {
        expect((e as ApiException).getResponse()).toMatchObject({ code: 'CHATBOT_ARCHIVED' });
      }
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('enableWebChannel:false면 채널을 건드리지 않고 상태만 전환한다', async () => {
      const tx = makeTx({ channel: { id: 'ch-1', enabled: false } });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      const result = await service.publish('bot-1', { enableWebChannel: false });

      expect(result).toEqual({ changed: true, statusBefore: 'DRAFT', statusAfter: 'ACTIVE', channelBefore: null, channelAfter: null });
      expect(tx.channel.update).not.toHaveBeenCalled();
      expect(tx.channel.findUnique).not.toHaveBeenCalled();
    });

    it('invocation 없이 호출하면(즉시 경로 재사용 대비) actorOverride 없이 감사를 남긴다', async () => {
      const tx = makeTx();
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      await service.publish('bot-1', { enableWebChannel: false });

      const call = auditLogService.record.mock.calls[0][0];
      expect(call.actorOverride).toBeUndefined();
      expect(call.summary).toBe('상태 변경: DRAFT → ACTIVE');
    });
  });

  describe('setWebChannel()', () => {
    it('값이 바뀌면 채널을 갱신하고 감사를 남긴다', async () => {
      const tx = makeTx({ channel: { id: 'ch-1', enabled: false } });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      const result = await service.setWebChannel('bot-1', true, { actor: { id: 'u1', email: 'e@x.com', role: 'EDITOR' }, auditSummaryPrefix: '[예약 실행 #abcdefgh] ' });

      expect(result).toEqual({ changed: true, channelBefore: false, channelAfter: true });
      expect(tx.channel.update).toHaveBeenCalledWith({ where: { id: 'ch-1' }, data: { enabled: true } });
      expect(auditLogService.record).toHaveBeenCalledWith(expect.objectContaining({ summary: '[예약 실행 #abcdefgh] 사용 여부 변경: false → true' }));
    });

    it('행이 없고 목표가 false면 NOOP이다(행 없음 = false)', async () => {
      const tx = makeTx({ channel: null });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      const result = await service.setWebChannel('bot-1', false);

      expect(result).toEqual({ changed: false, channelBefore: false, channelAfter: false });
      expect(tx.channel.create).not.toHaveBeenCalled();
      expect(auditLogService.record).not.toHaveBeenCalled();
    });

    it('행이 없고 목표가 true면 기본 config로 새로 만든다', async () => {
      const tx = makeTx({ channel: null });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      const result = await service.setWebChannel('bot-1', true);

      expect(result).toEqual({ changed: true, channelBefore: false, channelAfter: true });
      expect(tx.channel.create).toHaveBeenCalled();
    });

    it('ARCHIVED 챗봇은 CHATBOT_ARCHIVED(409)다', async () => {
      const tx = makeTx({ chatbot: { status: 'ARCHIVED' } });
      const { prisma, auditLogService } = makeDeps(tx);
      const service = new ChatbotPublicationService(prisma as never, auditLogService as never);

      try {
        await service.setWebChannel('bot-1', true);
        fail('예외가 발생해야 한다');
      } catch (e) {
        expect((e as ApiException).getResponse()).toMatchObject({ code: 'CHATBOT_ARCHIVED' });
      }
    });
  });
});
