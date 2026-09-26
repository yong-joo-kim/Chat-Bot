import { ApiException } from '../../common/api.exception';
import { WorkflowRunOpsService } from './workflow-run-ops.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../audit-logs/audit-log.service';
import type { WorkflowRunStore } from '../core/workflow-run.store';

/**
 * `WorkflowRunOpsService` 단위 시험(mock Prisma/store) — 코드 리뷰 R1 시험 공백 (f).
 * 실 SQLite 경합·`deliveryId` 불변은 `integration/workflow-automation.integration.spec.ts`가 다룬다.
 * 이 파일은 재발송·취소의 **전건 사전검사 전체 거부**와 **경합(CAS count 불일치) 롤백** 분기를 결정적으로
 * 검증한다(기존 관행 — `feedback/message-feedback.service.spec.ts` 선례: `getStatus()`·`getResponse()`).
 */
async function expectApiException(promise: Promise<unknown>, status: number, code: string): Promise<void> {
  try {
    await promise;
    fail('예외가 던져져야 한다');
  } catch (e) {
    expect((e as ApiException).getStatus()).toBe(status);
    expect((e as ApiException).getResponse()).toMatchObject({ code });
  }
}

describe('WorkflowRunOpsService', () => {
  function makePrisma(rows: Array<{ id: string; status: string; payloadBytes: number | null; payloadPurgedAt: Date | null }>): PrismaService {
    return { workflowRun: { findMany: jest.fn().mockResolvedValue(rows) } } as unknown as PrismaService;
  }

  function makeAudit(): AuditLogService {
    return { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService;
  }

  function makeStore(overrides: Partial<Record<'retryManual' | 'cancelManual', jest.Mock>> = {}): WorkflowRunStore {
    return {
      retryManual: jest.fn().mockResolvedValue(0),
      cancelManual: jest.fn().mockResolvedValue(0),
      ...overrides,
    } as unknown as WorkflowRunStore;
  }

  const chatbotId = 'chatbot-1';
  const runId1 = '11111111-1111-4111-8111-111111111111';
  const runId2 = '22222222-2222-4222-8222-222222222222';

  describe('retry — 재발송', () => {
    it('요청 id 일부가 이 챗봇 소속이 아니면(교차 챗봇) 404 NOT_FOUND다', async () => {
      const prisma = makePrisma([{ id: runId1, status: 'FAILED', payloadBytes: 10, payloadPurgedAt: null }]); // runId2 없음(교차 챗봇 혹은 미존재)
      const service = new WorkflowRunOpsService(prisma, makeAudit(), makeStore());

      await expectApiException(service.retry(chatbotId, { runIds: [runId1, runId2] }), 404, 'NOT_FOUND');
    });

    it('일부가 FAILED가 아니거나 본문이 소거됐으면 전체 거부(409 WORKFLOW_RUN_NOT_RETRYABLE) — 유효한 것도 재발송되지 않는다', async () => {
      const rows = [
        { id: runId1, status: 'FAILED', payloadBytes: 10, payloadPurgedAt: null },
        { id: runId2, status: 'PENDING', payloadBytes: null, payloadPurgedAt: null }, // 재발송 불가
      ];
      const prisma = makePrisma(rows);
      const store = makeStore();
      const service = new WorkflowRunOpsService(prisma, makeAudit(), store);

      await expectApiException(service.retry(chatbotId, { runIds: [runId1, runId2] }), 409, 'WORKFLOW_RUN_NOT_RETRYABLE');
      expect(store.retryManual).not.toHaveBeenCalled();
    });

    it('경합(CAS count가 요청 수보다 적음) — 409로 응답하고 감사 기록을 남기지 않는다', async () => {
      const rows = [
        { id: runId1, status: 'FAILED', payloadBytes: 10, payloadPurgedAt: null },
        { id: runId2, status: 'FAILED', payloadBytes: 10, payloadPurgedAt: null },
      ];
      const prisma = makePrisma(rows);
      const audit = makeAudit();
      const store = makeStore({ retryManual: jest.fn().mockResolvedValue(1) }); // 사전검사는 2건, CAS는 1건만 성공(경합)
      const service = new WorkflowRunOpsService(prisma, audit, store);

      await expectApiException(service.retry(chatbotId, { runIds: [runId1, runId2] }), 409, 'WORKFLOW_RUN_NOT_RETRYABLE');
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('전건 사전검사 통과 + CAS count 일치 — 성공하고 감사 1건을 남긴다', async () => {
      const rows = [
        { id: runId1, status: 'FAILED', payloadBytes: 10, payloadPurgedAt: null },
        { id: runId2, status: 'FAILED', payloadBytes: 10, payloadPurgedAt: null },
      ];
      const prisma = makePrisma(rows);
      const audit = makeAudit();
      const store = makeStore({ retryManual: jest.fn().mockResolvedValue(2) });
      const service = new WorkflowRunOpsService(prisma, audit, store);

      const result = await service.retry(chatbotId, { runIds: [runId1, runId2] });

      expect(result).toEqual({ updated: 2 });
      expect(audit.record).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancel — 취소', () => {
    it('요청 id 일부가 이 챗봇 소속이 아니면 404 NOT_FOUND다', async () => {
      const prisma = makePrisma([{ id: runId1, status: 'PENDING', payloadBytes: null, payloadPurgedAt: null }]);
      const service = new WorkflowRunOpsService(prisma, makeAudit(), makeStore());

      await expectApiException(service.cancel(chatbotId, { runIds: [runId1, runId2] }), 404, 'NOT_FOUND');
    });

    it('PENDING·HELD가 아닌 상태가 섞이면 400 INVALID_STATUS_TRANSITION이다', async () => {
      const rows = [
        { id: runId1, status: 'PENDING', payloadBytes: null, payloadPurgedAt: null },
        { id: runId2, status: 'SUCCEEDED', payloadBytes: null, payloadPurgedAt: null },
      ];
      const prisma = makePrisma(rows);
      const service = new WorkflowRunOpsService(prisma, makeAudit(), makeStore());

      await expectApiException(service.cancel(chatbotId, { runIds: [runId1, runId2] }), 400, 'INVALID_STATUS_TRANSITION');
    });

    it('PENDING·HELD만 있으면 취소하고 감사 1건을 남긴다', async () => {
      const rows = [
        { id: runId1, status: 'PENDING', payloadBytes: null, payloadPurgedAt: null },
        { id: runId2, status: 'HELD', payloadBytes: null, payloadPurgedAt: null },
      ];
      const prisma = makePrisma(rows);
      const audit = makeAudit();
      const store = makeStore({ cancelManual: jest.fn().mockResolvedValue(2) });
      const service = new WorkflowRunOpsService(prisma, audit, store);

      const result = await service.cancel(chatbotId, { runIds: [runId1, runId2] });

      expect(result).toEqual({ updated: 2 });
      expect(audit.record).toHaveBeenCalledTimes(1);
    });
  });
});
