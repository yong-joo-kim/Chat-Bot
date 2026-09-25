import { TopicAssignmentService } from './topic-assignment.service';

/**
 * M-1 코드리뷰 대응 — 일괄 지정 감사 기록의 targetType 분기(§15 D-14). 대상이 "공통"
 * (`topicId: null`)이면 `Topic` 행이 없으므로 `targetType: 'Chatbot'` · `targetId: chatbotId`로
 * 기록해야 한다. 실제 토픽 대상이면 기존대로 `targetType: 'Topic'`이다.
 */

const NOW = new Date('2026-01-01T00:00:00.000Z');

function buildTxMock(rows: Array<{ id: string; topicId: string | null; updatedAt: Date }>) {
  return {
    intent: {
      findMany: jest.fn().mockResolvedValue(rows),
      updateMany: jest.fn().mockResolvedValue({ count: rows.length }),
    },
  };
}

function buildService(tx: ReturnType<typeof buildTxMock>, opts: { topicExists?: boolean } = {}) {
  const prisma = {
    $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    topic: { findUnique: jest.fn().mockResolvedValue(opts.topicExists === false ? null : { enabled: true }) },
  };
  const scope = { assertWritable: jest.fn().mockResolvedValue(undefined) };
  const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
  const bundleService = { invalidate: jest.fn() };
  const topicLookup = { assertTopicInChatbot: jest.fn().mockResolvedValue(undefined) };

  const service = new TopicAssignmentService(prisma as never, scope as never, auditLogService as never, bundleService as never, topicLookup as never);
  return { service, prisma, scope, auditLogService, bundleService, topicLookup };
}

describe('TopicAssignmentService.assign — 감사 targetType 분기(M-1)', () => {
  it('대상이 실제 토픽이면 targetType=Topic · targetId=topicId로 기록한다', async () => {
    const rows = [{ id: 'intent-1', topicId: null, updatedAt: NOW }];
    const tx = buildTxMock(rows);
    const { service, auditLogService } = buildService(tx);

    await service.assign('chatbot-1', { kind: 'INTENT', ids: ['intent-1'], topicId: 'topic-1' });

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', targetType: 'Topic', targetId: 'topic-1', chatbotId: 'chatbot-1' }),
    );
  });

  it('대상이 공통(topicId=null)이면 targetType=Chatbot · targetId=chatbotId로 기록한다', async () => {
    const rows = [{ id: 'intent-1', topicId: 'topic-1', updatedAt: NOW }];
    const tx = buildTxMock(rows);
    const { service, auditLogService } = buildService(tx);

    await service.assign('chatbot-1', { kind: 'INTENT', ids: ['intent-1'], topicId: null });

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', targetType: 'Chatbot', targetId: 'chatbot-1', chatbotId: 'chatbot-1' }),
    );
  });

  it('변경 건수가 0이면(이미 대상과 동일) 감사를 기록하지 않는다(멱등)', async () => {
    const rows = [{ id: 'intent-1', topicId: 'topic-1', updatedAt: NOW }];
    const tx = buildTxMock(rows);
    const { service, auditLogService } = buildService(tx);

    await service.assign('chatbot-1', { kind: 'INTENT', ids: ['intent-1'], topicId: 'topic-1' });

    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('감사 호출에 before/after를 넘기지 않는다(요약 전용 — AUDIT_FIELDS 화이트리스트 우회가 아니다)', async () => {
    const rows = [{ id: 'intent-1', topicId: null, updatedAt: NOW }];
    const tx = buildTxMock(rows);
    const { service, auditLogService } = buildService(tx);

    await service.assign('chatbot-1', { kind: 'INTENT', ids: ['intent-1'], topicId: 'topic-1' });

    const call = auditLogService.record.mock.calls[0][0];
    expect(call.before).toBeUndefined();
    expect(call.after).toBeUndefined();
    expect(typeof call.summary).toBe('string');
  });
});
