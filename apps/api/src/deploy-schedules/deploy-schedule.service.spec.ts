import { DeployScheduleService } from './deploy-schedule.service';
import { ApiException } from '../common/api.exception';

/**
 * `resume()`의 P2002(부분 유니크① `deploy_schedules_chatbotId_scheduledAt_active_key`) 매핑
 * 회귀 테스트(code-review 1라운드 M1). `create()`/`update()`와 동일하게 `isUniqueConstraintViolation`
 * 이 전역 필터의 기본 분기(DUPLICATE_SLUG)로 떨어지지 않고 `400 DEPLOY_SCHEDULE_INVALID_TIME`으로
 * 변환되는지 확인한다.
 */
describe('DeployScheduleService.resume — P2002 매핑(code-review M1)', () => {
  const HELD_ROW = {
    id: 'sched-1',
    chatbotId: 'bot-1',
    action: 'SET_WEB_CHANNEL',
    params: JSON.stringify({ enabled: true }),
    status: 'HELD',
    targetVersionId: null,
    expectedContentHash: null,
    predecessorScheduleId: null,
    createdById: 'user-1',
  };

  function p2002(): { code: string } {
    return { code: 'P2002' };
  }

  function buildService(txError: unknown) {
    const prisma = {
      chatbot: { findUnique: jest.fn().mockResolvedValue({ status: 'DRAFT' }) },
      deploySchedule: { findUnique: jest.fn().mockResolvedValue(HELD_ROW) },
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', role: 'EDITOR' }) },
      $transaction: jest.fn().mockRejectedValue(txError),
    };
    const registry = {
      get: jest.fn().mockReturnValue({ requiredPermissions: () => ['channel:write'] }),
    };
    const previewService = {};
    const readiness = {};
    const queryService = { buildDetail: jest.fn() };
    const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    const repository = { holdRestoreSuccessorsOnCancel: jest.fn().mockResolvedValue(undefined) };
    const clock = { now: () => new Date('2027-01-01T00:00:00Z') };

    return new DeployScheduleService(
      prisma as never,
      registry as never,
      previewService as never,
      readiness as never,
      queryService as never,
      auditLogService as never,
      repository as never,
      clock as never,
    );
  }

  const user = { id: 'user-1', email: 'editor@test.local', role: 'EDITOR', status: 'ACTIVE' } as never;
  const dto = { scheduledAt: new Date('2027-01-01T01:00:00Z') } as never;

  it('P2002는 DUPLICATE_SLUG가 아니라 400 DEPLOY_SCHEDULE_INVALID_TIME으로 변환된다', async () => {
    const service = buildService(p2002());
    await expect(service.resume('bot-1', 'sched-1', user, dto)).rejects.toMatchObject({
      response: { code: 'DEPLOY_SCHEDULE_INVALID_TIME' },
      status: 400,
    });
  });

  it('P2002 이외의 예외는 그대로 전파된다(회귀 방지)', async () => {
    const service = buildService(new Error('DB 연결 끊김'));
    await expect(service.resume('bot-1', 'sched-1', user, dto)).rejects.toThrow('DB 연결 끊김');
  });

  it('ApiException은 그대로 다시 던져진다(이중 변환 없음)', async () => {
    const service = buildService(new ApiException('VALIDATION_FAILED', 400, 'x'));
    await expect(service.resume('bot-1', 'sched-1', user, dto)).rejects.toMatchObject({ response: { code: 'VALIDATION_FAILED' } });
  });
});

/**
 * `cancel()`의 R6(§6.2·§7.7) — 후속 PENDING RESTORE_VERSION을 HELD로 전파하는 로직이 인라인
 * 재구현이 아니라 `repository.holdRestoreSuccessorsOnCancel()` 호출로 위임되는지 확인한다
 * (code-review 1라운드 L3 — 죽은 코드 제거·단일 구현).
 */
describe('DeployScheduleService.cancel — R6 위임(code-review L3)', () => {
  function buildService(row: { targetVersionId: string | null; scheduledAt: Date }) {
    const tx = { deploySchedule: { update: jest.fn().mockResolvedValue({ id: 'sched-1', action: 'RESTORE_VERSION', ...row }) } };
    const prisma = {
      chatbot: { findUnique: jest.fn().mockResolvedValue({ status: 'DRAFT' }) },
      deploySchedule: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sched-1',
          chatbotId: 'bot-1',
          action: 'RESTORE_VERSION',
          params: JSON.stringify({ versionId: 'v-1' }),
          status: 'PENDING',
          scheduledAt: row.scheduledAt,
          targetVersionId: row.targetVersionId,
        }),
      },
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    };
    const registry = { get: jest.fn().mockReturnValue({ requiredPermissions: () => ['dialogue:write', 'chatbot:write'] }) };
    const queryService = { buildDetail: jest.fn() };
    const auditLogService = { record: jest.fn().mockResolvedValue(undefined) };
    const repository = { holdRestoreSuccessorsOnCancel: jest.fn().mockResolvedValue(undefined) };
    const clock = { now: () => new Date('2027-01-01T00:00:00Z') };
    return {
      service: new DeployScheduleService(prisma as never, registry as never, {} as never, {} as never, queryService as never, auditLogService as never, repository as never, clock as never),
      repository,
    };
  }

  const user = { id: 'user-1', email: 'editor@test.local', role: 'ADMIN', status: 'ACTIVE' } as never;

  it('targetVersionId가 있으면(RESTORE_VERSION) repository.holdRestoreSuccessorsOnCancel을 호출한다', async () => {
    const scheduledAt = new Date('2027-01-01T02:00:00Z');
    const { service, repository } = buildService({ targetVersionId: 'v-1', scheduledAt });
    await service.cancel('bot-1', 'sched-1', user);
    expect(repository.holdRestoreSuccessorsOnCancel).toHaveBeenCalledWith(expect.anything(), 'bot-1', scheduledAt, expect.any(Date), 'sched-1');
  });

  it('targetVersionId가 없으면(PUBLISH·SET_WEB_CHANNEL) 호출하지 않는다', async () => {
    const scheduledAt = new Date('2027-01-01T02:00:00Z');
    const { service, repository } = buildService({ targetVersionId: null, scheduledAt });
    await service.cancel('bot-1', 'sched-1', user);
    expect(repository.holdRestoreSuccessorsOnCancel).not.toHaveBeenCalled();
  });
});
