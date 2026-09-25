import { ChatbotsService } from './chatbots.service';
import { ApiException } from '../common/api.exception';

/**
 * 영구삭제(permanentDelete)의 트랜잭션 원자성 회귀 테스트 — code-reviewer 2차 검증(Medium) 대응.
 *
 * embeddingVector/chatbotAnswerSetting/ragCallLog/apiCallLog/augmentationSuggestion/intentClassifierModel/
 * trainingJob/testRunResult/testRun/testCase/testCaseSet/chatbotVersionPayload/chatbotVersion/
 * chatbotVersionSequence/deploySchedule 15개 테이블 deleteMany + chatbot.delete가
 * `this.prisma.$transaction(async (tx) => {...})` 콜백 안에서 `tx.` 프리픽스로 실행되는지, 그리고
 * 콜백 중간에서 실패하면 전체가 실패로 전파되어 감사로그(PURGE)가 기록되지 않는지(=커밋되지
 * 않는지)를 확인한다(검증/품질 고도화 그룹이 4테이블, 챗봇 복원/버전 이력관리 그룹이 3테이블,
 * 운영 예약 배포 그룹이 1테이블, 레거시 API 연동 그룹이 1테이블을 추가했다 —
 * validation-regression-설계.md §4.3, version-history-설계.md §13, scheduled-deploy-설계.md §4.6,
 * legacy-api-integration-설계.md §2.5 FR-L6-6).
 * SQLite 실제 롤백 검증은 통합 테스트(`integration/chatbot-operations.integration.spec.ts`)가
 * 다루지 못하는 부분 실행 방지를 이 유닛 테스트로 보완한다.
 *
 * [No.24] 하이브리드 CS 그룹이 사전검사에 `handoffSessions`·`cannedResponses` 2건을 추가하고
 * (11 → 13종), 동반 삭제 트랜잭션에 `chatbotHandoffSetting.deleteMany` 1건을 추가했다
 * (15 → 16테이블, ADR-0036 §8) — 상담 스레드·문장 자체는 삭제 대상이 아니다(§18 H-8).
 * [No.22] 토픽 시스템 그룹이 사전검사에 `topics` 1건을 추가했다(13 → 14종) — 토픽은 대화 자산
 * 성격이라 동반 삭제가 아니라 사전검사(409) 대상이다(topic-system-설계.md §9.7). 동반 삭제
 * 트랜잭션은 변경 없다(토픽 FK가 Restrict라 비어 있지 않으면 애초에 이 지점에 도달하지 않는다).
 */

const ARCHIVED_CHATBOT = {
  id: 'bot-1',
  name: '삭제대상챗봇',
  status: 'ARCHIVED',
  groupId: 'group-1',
  slug: 'bot-1',
  skin: '{}',
  avatarUrl: null,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildTxMock() {
  return {
    embeddingVector: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatbotAnswerSetting: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    ragCallLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    apiCallLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    augmentationSuggestion: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    intentClassifierModel: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    trainingJob: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    testRunResult: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    testRun: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    testCase: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    testCaseSet: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatbotVersionPayload: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatbotVersion: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatbotVersionSequence: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    deploySchedule: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatbotHandoffSetting: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    chatbot: { delete: jest.fn().mockResolvedValue(ARCHIVED_CHATBOT) },
  };
}

function buildPrismaMock(tx: ReturnType<typeof buildTxMock>) {
  return {
    chatbot: {
      findUnique: jest.fn().mockResolvedValue(ARCHIVED_CHATBOT),
      delete: jest.fn(),
    },
    intent: { count: jest.fn().mockResolvedValue(0) },
    keyword: { count: jest.fn().mockResolvedValue(0) },
    homonymDictionary: { count: jest.fn().mockResolvedValue(0) },
    dialogNode: { count: jest.fn().mockResolvedValue(0) },
    contextVariable: { count: jest.fn().mockResolvedValue(0) },
    faqEntry: { count: jest.fn().mockResolvedValue(0) },
    channel: { count: jest.fn().mockResolvedValue(0) },
    conversationLog: { count: jest.fn().mockResolvedValue(0) },
    unansweredQuestion: { count: jest.fn().mockResolvedValue(0) },
    survey: { count: jest.fn().mockResolvedValue(0) },
    surveyResponse: { count: jest.fn().mockResolvedValue(0) },
    handoffSession: { count: jest.fn().mockResolvedValue(0) },
    cannedResponse: { count: jest.fn().mockResolvedValue(0) },
    // [신규 No.22] 사전검사 13 → 14종.
    topic: { count: jest.fn().mockResolvedValue(0) },
    // [신규 No.44] 사전검사 14 → 15종.
    messageFeedback: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>, auditLogService: { record: jest.Mock }) {
  // [신규 No.22] ChatbotCopyTargetService는 copy()에서만 쓰인다 — 이 스펙의 permanentDelete 시험에는
  // 관여하지 않으므로 더미로 주입한다.
  return new ChatbotsService(prisma as never, auditLogService as never, {} as never);
}

describe('ChatbotsService.permanentDelete — 트랜잭션 원자성(code-reviewer 2차 Medium)', () => {
  it('16개 테이블 deleteMany와 chatbot.delete가 $transaction 콜백 안에서 tx.* 프리픽스로 1회씩 실행된다', async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock(tx);
    const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(prisma, auditLogService);

    await service.permanentDelete('bot-1', { confirmName: '삭제대상챗봇' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.embeddingVector.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.chatbotAnswerSetting.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.ragCallLog.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.apiCallLog.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.augmentationSuggestion.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.intentClassifierModel.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.trainingJob.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.testRunResult.deleteMany).toHaveBeenCalledWith({ where: { run: { chatbotId: 'bot-1' } } });
    expect(tx.testRun.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.testCase.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.testCaseSet.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.chatbotVersionPayload.deleteMany).toHaveBeenCalledWith({ where: { version: { chatbotId: 'bot-1' } } });
    expect(tx.chatbotVersion.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.chatbotVersionSequence.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.deploySchedule.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.chatbotHandoffSetting.deleteMany).toHaveBeenCalledWith({ where: { chatbotId: 'bot-1' } });
    expect(tx.chatbot.delete).toHaveBeenCalledWith({ where: { id: 'bot-1' } });

    // 챗봇 로우 삭제도 트랜잭션 컨텍스트(tx)를 통해서만 실행되고, 트랜잭션 밖의 prisma.chatbot.delete는
    // 호출되지 않는다(원자성 보장의 핵심 — 별도 커넥션/논트랜잭션 삭제가 섞이지 않아야 한다).
    expect(prisma.chatbot.delete).not.toHaveBeenCalled();

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PURGE', targetId: 'bot-1' }),
    );
  });

  it('중간 단계(trainingJob.deleteMany)가 실패하면 전체가 실패로 전파되고 PURGE 감사로그가 기록되지 않는다(부분 커밋 방지)', async () => {
    const tx = buildTxMock();
    tx.trainingJob.deleteMany.mockRejectedValue(new Error('DB 연결 끊김'));
    const prisma = buildPrismaMock(tx);
    const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(prisma, auditLogService);

    await expect(service.permanentDelete('bot-1', { confirmName: '삭제대상챗봇' })).rejects.toThrow('DB 연결 끊김');

    // 트랜잭션 콜백 안에서 앞서 호출된 deleteMany들은 실행됐지만(실제 Prisma $transaction이라면 이 시점에
    // 예외로 전체가 롤백된다), 트랜잭션이 실패했으므로 chatbot.delete까지는 도달하지 않는다.
    expect(tx.chatbot.delete).not.toHaveBeenCalled();
    // 트랜잭션 실패 시 permanentDelete()는 그 예외를 그대로 던지고, 트랜잭션 이후 코드(PURGE 감사로그
    // 기록)는 실행되지 않는다 — "챗봇 로우만 ARCHIVED로 남는 부분 실행 상태"가 되지 않았음을 방증한다.
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('ARCHIVED가 아닌 챗봇은 트랜잭션을 시작하기도 전에 CHATBOT_NOT_ARCHIVED로 거부된다', async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock(tx);
    prisma.chatbot.findUnique.mockResolvedValue({ ...ARCHIVED_CHATBOT, status: 'ACTIVE' });
    const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    const service = buildService(prisma, auditLogService);

    await expect(service.permanentDelete('bot-1', { confirmName: '삭제대상챗봇' })).rejects.toBeInstanceOf(ApiException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
