import type { ApprovalPolicyStatus, ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { DeploySchedulesEngine } from '../deploy-schedules/engine/deploy-schedule.engine';
import { FakeClock, bootHarness } from './helpers/ai-guardrails.harness';
import type { Harness } from './helpers/ai-guardrails.harness';
import { setupApprovalBot } from './helpers/ai-guardrails-approval.helpers';
import type { ApprovalBot } from './helpers/ai-guardrails-approval.helpers';

/**
 * 운영 전환 2인 승인(No.36) × 예약 배포(No.28 · 40) — `ai-guardrails-설계.md` §10.7 · AC-AG6-7.
 * 예약 생성 경로는 그대로이고(순환 의존 회피 — R-6), 실행기가 `ProdSwitchService.switch()`에서 승인된 요청을 확인한다.
 * `DEPLOY_SCHEDULE_ENABLED`는 끈 채 `engine.tick()`을 직접 호출한다(CLAUDE.md 규약). `ENV_APPROVAL_OFF_LOCKED=true`로 끄기 잠금도 확인한다.
 */
interface ApiErr {
  code: string;
  details?: Array<{ field: string; message: string }>;
}

describe('운영 전환 2인 승인 × 예약 배포 통합 시험', () => {
  let h: Harness & { moduleRef: { get: <T>(token: new (...args: never[]) => T) => T } };
  let clock: FakeClock;
  let engine: DeploySchedulesEngine;

  beforeAll(async () => {
    clock = new FakeClock(new Date('2026-03-01T00:00:00.000Z'));
    h = (await bootHarness({ tmpPrefix: 'prod-switch-approval-schedule-', clock, env: { ENV_APPROVAL_OFF_LOCKED: 'true' } })) as typeof h;
    engine = h.moduleRef.get(DeploySchedulesEngine);
  }, 90_000);

  afterAll(async () => {
    await h?.close();
  }, 20_000);

  const requestPath = (chatbotId: string, id?: string, verb?: string) => `/chatbots/${chatbotId}/environment/approval/requests${id ? `/${id}` : ''}${verb ? `/${verb}` : ''}`;
  const prodOf = async (chatbotId: string) => (await h.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } }))!.prodVersionId;

  async function createSchedule(bot: ApprovalBot, minutesAhead = 10): Promise<{ id: string; scheduledAt: Date }> {
    const scheduledAt = new Date(clock.now().getTime() + minutesAhead * 60_000);
    const res = await h.admin<{ schedule: { id: string } } & ApiErr>('POST', `/chatbots/${bot.id}/deploy-schedules`, {
      action: 'SWITCH_PROD_VERSION',
      targetVersionId: bot.v2Id,
      previewedProdVersionId: bot.v1Id,
      scheduledAt: scheduledAt.toISOString(),
      acknowledgeWarnings: true,
    });
    expect(res.status).toBe(201);
    // 예약 시각은 서버가 분 단위로 정규화한다(초·밀리초 0) — 저장된 값을 기준으로 삼는다.
    const stored = await h.prisma.deploySchedule.findUnique({ where: { id: res.body.schedule.id } });
    return { id: res.body.schedule.id, scheduledAt: stored!.scheduledAt };
  }

  const scheduleRow = (id: string) => h.prisma.deploySchedule.findUnique({ where: { id } });

  it('AC-AG6-7: 승인 없이 도래한 예약은 실행 0 · FAILED(APPROVAL_MISSING)이고 재시도하지 않는다', async () => {
    const bot = await setupApprovalBot(h, '예약미승인');
    const schedule = await createSchedule(bot);

    clock.advance(schedule.scheduledAt.getTime() - clock.now().getTime() + 5_000);
    await engine.tick();
    await engine.tick();

    const row = await scheduleRow(schedule.id);
    expect(row).toMatchObject({ status: 'FAILED', failureReason: 'APPROVAL_MISSING' });
    expect(await prodOf(bot.id)).toBe(bot.v1Id);
    expect(await h.prisma.environmentSwitchLog.count({ where: { chatbotId: bot.id, method: 'SCHEDULED' } })).toBe(0);
  });

  it('예약 + 승인 요청(예약 작성자 = 요청자) → 다른 관리자 승인(선점만) → 도래 시 전환 실행 · 이력에 승인 표식', async () => {
    const bot = await setupApprovalBot(h, '예약승인');
    const schedule = await createSchedule(bot, 30);

    const created = await h.admin<ProdSwitchApprovalSummary & ApiErr>('POST', requestPath(bot.id), { action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: schedule.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'PENDING', action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: schedule.id });
    // 만료 = min(요청 + TTL(24h), 예약 시각) → 예약 시각(30분 뒤).
    expect(new Date(created.body.expiresAt).getTime()).toBe(schedule.scheduledAt.getTime());

    // 승인자가 예약 작성자가 되는 우회 차단 — 작성자가 아닌 사람은 요청할 수 없다.
    const bot2 = await setupApprovalBot(h, '예약타인');
    const otherSchedule = await createSchedule(bot2, 30);
    const foreign = await h.admin2<ApiErr>('POST', requestPath(bot2.id), { action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: otherSchedule.id });
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('FORBIDDEN');

    const approved = await h.admin2<{ request: ProdSwitchApprovalSummary; switch: unknown }>('POST', requestPath(bot.id, created.body.id, 'approve'), {});
    expect(approved.status).toBe(200);
    expect(approved.body.request).toMatchObject({ status: 'APPROVED', outcome: 'SCHEDULED', executedAt: null });
    expect(approved.body.switch).toBeNull();
    expect(await prodOf(bot.id)).toBe(bot.v1Id); // 전환은 예약 시각에.

    clock.advance(schedule.scheduledAt.getTime() - clock.now().getTime() + 5_000);
    await engine.tick();

    const row = await scheduleRow(schedule.id);
    expect(row).toMatchObject({ status: 'SUCCEEDED', outcome: 'APPLIED' });
    expect(await prodOf(bot.id)).toBe(bot.v2Id);
    const log = await h.prisma.environmentSwitchLog.findFirst({ where: { chatbotId: bot.id, method: 'SCHEDULED' } });
    expect(log).toMatchObject({ approvalMode: 'APPROVED', approvalRequestId: created.body.id, deployScheduleId: schedule.id });

    // 요청 행은 추가 쓰기 0 — 실행됨은 이력 조인으로 표시된다.
    const status = await h.admin<ApprovalPolicyStatus>('GET', `/chatbots/${bot.id}/environment/approval`);
    expect(status.body.recent[0]).toMatchObject({ id: created.body.id, status: 'APPROVED', outcome: 'SCHEDULED' });
    expect(status.body.recent[0].executedAt).not.toBeNull();
  });

  it('예약이 취소되면 대기 요청은 지연 종결(SCHEDULE_INACTIVE)되고 승인은 409 APPROVAL_BASE_CHANGED', async () => {
    const bot = await setupApprovalBot(h, '예약취소');
    const schedule = await createSchedule(bot, 30);
    const created = await h.admin<ProdSwitchApprovalSummary>('POST', requestPath(bot.id), { action: 'SCHEDULED_PROD_SWITCH', deployScheduleId: schedule.id });
    expect(created.status).toBe(201);

    const cancelled = await h.admin('POST', `/chatbots/${bot.id}/deploy-schedules/${schedule.id}/cancel`);
    expect(cancelled.status).toBe(200);

    const res = await h.admin2<ApiErr>('POST', requestPath(bot.id, created.body.id, 'approve'), {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('APPROVAL_BASE_CHANGED');
    expect(await h.prisma.prodSwitchApprovalRequest.findUnique({ where: { id: created.body.id } })).toMatchObject({ status: 'CANCELLED', closedReason: 'SCHEDULE_INACTIVE' });
  });

  it('서버 잠금(ENV_APPROVAL_OFF_LOCKED=true)이면 정책 끄기는 409(OFF_LOCKED)이고 켜기·TTL 변경은 허용된다', async () => {
    const bot = await setupApprovalBot(h, '끄기잠금');
    const off = await h.admin<ApiErr>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: false, ttlHours: 24 });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe('APPROVAL_POLICY_UNAVAILABLE');
    expect(off.body.details?.find((d) => d.field === 'reason')?.message).toBe('OFF_LOCKED');

    const ttl = await h.admin<ApprovalPolicyStatus>('PUT', `/chatbots/${bot.id}/environment/approval`, { required: true, ttlHours: 48 });
    expect(ttl.status).toBe(200);
    expect(ttl.body).toMatchObject({ policy: { required: true, ttlHours: 48 }, offLocked: true });
  });
});
