import { Inject, Injectable } from '@nestjs/common';
import {
  hasPermission,
  DEPLOY_SCHEDULE_ACTION_LABELS as ACTION_LABELS,
  DEPLOY_SCHEDULE_ACTIVE_STATUSES,
  DEPLOY_SCHEDULE_LIMITS,
  checkScheduleTimeRules,
} from '@chat-bot/shared-types';
import type {
  CreateDeployScheduleDto,
  DeployScheduleDetail,
  ReadinessWarning,
  ResumeDeployScheduleDto,
  UpdateDeployScheduleDto,
} from '@chat-bot/shared-types';
import type { SessionUser } from '../common/auth/session-context';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { isBusyError } from '../common/prisma/busy-error';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ExecutorRegistry } from './executors/executor.registry';
import { DeploySchedulePreviewService } from './preview/deploy-schedule-preview.service';
import { ReadinessWarningsService } from './readiness/readiness-warnings.service';
import { DeployScheduleQueryService } from './deploy-schedule.query.service';
import { DeployScheduleRepository } from './engine/deploy-schedule.repository';
import { preservesOrder } from './lib/chain-rules';
import { isPostRunTestApplicable } from './lib/required-permissions';

const ACTIVE = [...DEPLOY_SCHEDULE_ACTIVE_STATUSES];

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * [신규 2026-09-23 No.28] 쓰기 서비스 — 생성·수정·취소·재개·확인 + `AuditLog` 기록 지점 + 권한 판정(§8.2).
 * `prisma.deploySchedule.*` 쓰기 호출이 허용되는 2파일 중 하나다(§16 D-1, engine/repository와 함께).
 */
@Injectable()
export class DeployScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExecutorRegistry,
    private readonly previewService: DeploySchedulePreviewService,
    private readonly readiness: ReadinessWarningsService,
    private readonly queryService: DeployScheduleQueryService,
    private readonly auditLogService: AuditLogService,
    private readonly repository: DeployScheduleRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private assertAnyManagePermission(user: SessionUser): void {
    const any = hasPermission(user.role, 'chatbot:write') || hasPermission(user.role, 'channel:write') || hasPermission(user.role, 'dialogue:write');
    if (!any) throw new ApiException('FORBIDDEN', 403, '이 작업을 수행할 권한이 없습니다.');
  }

  private async assertScope(chatbotId: string, allowArchived: boolean): Promise<{ status: string }> {
    const row = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true } });
    if (!row) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    if (!allowArchived && row.status === 'ARCHIVED') {
      throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇에는 예약을 만들 수 없습니다.');
    }
    return row;
  }

  async create(chatbotId: string, user: SessionUser, dto: CreateDeployScheduleDto): Promise<{ schedule: DeployScheduleDetail; readinessWarnings: ReadinessWarning[] }> {
    this.assertAnyManagePermission(user);
    await this.assertScope(chatbotId, false);

    const executor = this.registry.get(dto.action);
    const params = executor.paramsSchema.parse(dto);
    const required = executor.requiredPermissions(params);
    const missing = required.filter((p) => !hasPermission(user.role, p));
    if (missing.length > 0 || (dto.postRunTestSetId && !hasPermission(user.role, 'simulation:write'))) {
      await this.auditLogService.record({
        action: 'PERMISSION_DENIED',
        targetType: 'Session',
        targetId: user.id,
        summary: `POST deploy-schedules(${dto.action}) · 요구 권한 ${required.join('+')}`,
        actorOverride: { id: user.id, email: user.email, role: user.role },
      });
      throw new ApiException('FORBIDDEN', 403, '이 작업을 수행할 권한이 없습니다.');
    }

    if (dto.postRunTestSetId && !isPostRunTestApplicable(dto.action)) {
      throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '이 동작에는 실행 직후 검증을 적용할 수 없습니다.', [
        { field: 'precondition', message: 'TEST_SET_NOT_APPLICABLE' },
      ]);
    }

    const now = this.clock.now();
    const previewResp = await this.previewService.preview(chatbotId, dto);
    if (previewResp.restore) {
      const blocking = previewResp.restore.blockers.filter((b) => b.code === 'INTEGRITY_FAILED' || b.code === 'SCHEMA_UNSUPPORTED' || b.code === 'CHATBOT_ARCHIVED');
      if (blocking.length > 0) {
        throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '미리보기에서 차단 사유가 발견되어 예약을 생성할 수 없습니다.', [
          { field: 'precondition', message: 'RESTORE_BLOCKED' },
        ]);
      }
      if (previewResp.restore.requiresAcknowledgeActive && !('acknowledgeActive' in dto && dto.acknowledgeActive === true)) {
        throw new ApiException('VALIDATION_FAILED', 400, '운영 중(또는 공개 예정) 챗봇입니다. 영향을 확인했는지 체크해 주세요.', [
          { field: 'acknowledgeActive', message: '운영 중 챗봇 복원 확인이 필요합니다.' },
        ]);
      }
    }
    if (previewResp.preconditionFailures.length > 0) {
      throw new ApiException(
        'DEPLOY_SCHEDULE_PRECONDITION_FAILED',
        409,
        '현재 상태에서 이 예약을 만들 수 없습니다.',
        previewResp.preconditionFailures.map((f) => ({ field: 'precondition', message: f.code })),
      );
    }

    if (dto.postRunTestSetId) {
      const set = await this.prisma.testCaseSet.findFirst({ where: { id: dto.postRunTestSetId, chatbotId } });
      if (!set) {
        throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '지정한 검증 세트를 찾을 수 없습니다.', [
          { field: 'precondition', message: 'TEST_SET_INVALID' },
        ]);
      }
    }

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const activeRows = await tx.deploySchedule.findMany({
          where: { chatbotId, status: { in: ACTIVE } },
          select: { id: true, action: true, scheduledAt: true, targetContentHash: true },
        });

        const timeViolations = checkScheduleTimeRules({ scheduledAt: dto.scheduledAt, now, otherActiveTimes: activeRows.map((r) => r.scheduledAt) });
        if (timeViolations.length > 0) {
          throw new ApiException('DEPLOY_SCHEDULE_INVALID_TIME', 400, '예약 시각이 규칙을 위반했습니다.', timeViolations.map((v) => ({ field: 'scheduledAt', message: v.rule })));
        }
        if (activeRows.length >= DEPLOY_SCHEDULE_LIMITS.maxActivePerChatbot) {
          throw new ApiException('DEPLOY_SCHEDULE_LIMIT_EXCEEDED', 409, `챗봇당 활성 예약은 최대 ${DEPLOY_SCHEDULE_LIMITS.maxActivePerChatbot}건입니다.`);
        }

        const derived = await executor.resolveForInsert(tx, {
          chatbotId,
          scheduledAt: dto.scheduledAt,
          params,
          previewedContentHash: 'previewedContentHash' in dto ? dto.previewedContentHash : undefined,
          now,
          activeRestoreSiblings: activeRows.filter((r) => r.action === 'RESTORE_VERSION').map((r) => ({ id: r.id, scheduledAt: r.scheduledAt, targetContentHash: r.targetContentHash })),
          activeSiblingActions: activeRows.map((r) => r.action as never),
        });

        return tx.deploySchedule.create({
          data: {
            chatbotId,
            action: dto.action,
            params: JSON.stringify(params),
            targetVersionId: derived.targetVersionId ?? null,
            targetVersionNo: derived.targetVersionNo ?? null,
            targetContentHash: derived.targetContentHash ?? null,
            expectedContentHash: derived.expectedContentHash ?? null,
            predecessorScheduleId: derived.predecessorScheduleId ?? null,
            acknowledgeActive: 'acknowledgeActive' in dto ? Boolean(dto.acknowledgeActive) : false,
            postRunTestSetId: dto.postRunTestSetId ?? null,
            scheduledAt: dto.scheduledAt,
            status: 'PENDING',
            memo: dto.memo ?? null,
            createdById: user.id,
            createdByEmail: user.email,
            createdByRole: user.role,
          },
        });
      });
    } catch (e) {
      if (e instanceof ApiException) throw e;
      if (isUniqueConstraintViolation(e)) {
        throw new ApiException('DEPLOY_SCHEDULE_INVALID_TIME', 400, '같은 챗봇에 같은 분(minute)의 활성 예약이 이미 있습니다.');
      }
      if (isBusyError(e)) throw new ApiException('RESTORE_BUSY', 409, '다른 변경과 동시에 처리되어 예약을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.');
      throw e;
    }

    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'DeploySchedule',
      targetId: created.id,
      targetName: `${ACTION_LABELS[dto.action]} · ${dto.scheduledAt.toISOString()}`,
      chatbotId,
      after: { action: created.action, status: created.status, scheduledAt: created.scheduledAt, targetVersionNo: created.targetVersionNo, memo: created.memo, ...params },
    });

    const readinessWarnings = await this.readiness.compute({
      action: dto.action,
      chatbotId,
      scheduledAt: dto.scheduledAt,
      now,
      enableWebChannel: 'enableWebChannel' in dto ? dto.enableWebChannel : undefined,
    });

    return { schedule: await this.queryService.buildDetail(created), readinessWarnings };
  }

  async update(chatbotId: string, scheduleId: string, user: SessionUser, dto: UpdateDeployScheduleDto): Promise<DeployScheduleDetail> {
    this.assertAnyManagePermission(user);
    await this.assertScope(chatbotId, false);
    const current = await this.getRowOrThrow(chatbotId, scheduleId);
    this.assertOwnActionPermission(user, current);

    if (current.status !== 'PENDING' && current.status !== 'HELD') {
      throw new ApiException('DEPLOY_SCHEDULE_NOT_MODIFIABLE', 409, '대기 또는 보류 상태의 예약만 수정할 수 있습니다.');
    }

    const now = this.clock.now();
    const newScheduledAt = dto.scheduledAt ?? current.scheduledAt;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.scheduledAt) {
        const others = await tx.deploySchedule.findMany({
          where: { chatbotId, status: { in: ACTIVE }, id: { not: scheduleId } },
          select: { scheduledAt: true },
        });
        const timeViolations = checkScheduleTimeRules({ scheduledAt: newScheduledAt, now, otherActiveTimes: others.map((o) => o.scheduledAt) });
        if (timeViolations.length > 0) {
          throw new ApiException('DEPLOY_SCHEDULE_INVALID_TIME', 400, '예약 시각이 규칙을 위반했습니다.', timeViolations.map((v) => ({ field: 'scheduledAt', message: v.rule })));
        }
        if (!preservesOrder(current.scheduledAt, newScheduledAt, others)) {
          throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '다른 활성 예약과의 상대 순서를 바꾸는 시각으로는 수정할 수 없습니다.', [
            { field: 'precondition', message: 'ORDER_CHANGE' },
          ]);
        }
      }

      try {
        return await tx.deploySchedule.update({
          where: { id: scheduleId },
          data: { ...(dto.scheduledAt ? { scheduledAt: dto.scheduledAt } : {}), ...(dto.memo !== undefined ? { memo: dto.memo } : {}) },
        });
      } catch (e) {
        if (isUniqueConstraintViolation(e)) {
          throw new ApiException('DEPLOY_SCHEDULE_INVALID_TIME', 400, '같은 챗봇에 같은 분(minute)의 활성 예약이 이미 있습니다.');
        }
        throw e;
      }
    });

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'DeploySchedule',
      targetId: updated.id,
      targetName: `${ACTION_LABELS[updated.action as keyof typeof ACTION_LABELS]} · ${updated.scheduledAt.toISOString()}`,
      chatbotId,
      before: { scheduledAt: current.scheduledAt, memo: current.memo },
      after: { scheduledAt: updated.scheduledAt, memo: updated.memo },
    });

    return this.queryService.buildDetail(updated);
  }

  async cancel(chatbotId: string, scheduleId: string, user: SessionUser): Promise<DeployScheduleDetail> {
    this.assertAnyManagePermission(user);
    await this.assertScope(chatbotId, true); // ARCHIVED 챗봇도 취소는 허용(AC-D5-3류)
    const current = await this.getRowOrThrow(chatbotId, scheduleId);
    this.assertOwnActionPermission(user, current);

    if (current.status !== 'PENDING' && current.status !== 'HELD') {
      throw new ApiException('DEPLOY_SCHEDULE_NOT_MODIFIABLE', 409, '대기 또는 보류 상태의 예약만 취소할 수 있습니다.');
    }

    const now = this.clock.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.deploySchedule.update({ where: { id: scheduleId }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: user.id, cancelledByEmail: user.email } });
      // R6 — targetVersionId가 있으면(RESTORE_VERSION) 후속 PENDING RESTORE_VERSION만 HELD. 인라인
      // 재구현 대신 repository의 단일 구현을 재사용한다(code-review 1라운드 L3 — 죽은 코드 제거).
      if (row.targetVersionId !== null) {
        await this.repository.holdRestoreSuccessorsOnCancel(tx, chatbotId, row.scheduledAt, now, scheduleId);
      }
      return row;
    });

    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'DeploySchedule',
      targetId: updated.id,
      targetName: `${ACTION_LABELS[updated.action as keyof typeof ACTION_LABELS]} · ${updated.scheduledAt.toISOString()}`,
      chatbotId,
      before: { status: current.status },
      after: { status: 'CANCELLED' },
      summary: '예약 취소',
    });

    return this.queryService.buildDetail(updated);
  }

  async resume(chatbotId: string, scheduleId: string, user: SessionUser, dto: ResumeDeployScheduleDto): Promise<DeployScheduleDetail> {
    this.assertAnyManagePermission(user);
    await this.assertScope(chatbotId, false);
    const current = await this.getRowOrThrow(chatbotId, scheduleId);
    this.assertOwnActionPermission(user, current);

    if (current.status !== 'HELD') {
      throw new ApiException('DEPLOY_SCHEDULE_NOT_MODIFIABLE', 409, '보류 상태의 예약만 재개할 수 있습니다.');
    }

    // 원 예약자가 현재 권한을 잃었으면 재개해도 쓸모없다(§6.5).
    const creator = await this.prisma.user.findUnique({ where: { id: current.createdById }, select: { status: true, role: true } });
    const executor = this.registry.get(current.action as never);
    const currentParams = JSON.parse(current.params) as Record<string, unknown>;
    const required = executor.requiredPermissions(currentParams as never);
    if (!creator || creator.status !== 'ACTIVE' || !required.every((p) => hasPermission(creator.role as never, p))) {
      throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '원 예약자의 권한이 유지되지 않아 재개할 수 없습니다. 취소 후 새로 예약해 주세요.');
    }

    const now = this.clock.now();

    // RESTORE_VERSION이면 새 미리보기 해시로 R1·R2·R4를 재적용한다.
    let derivedExpectedHash: string | null = current.expectedContentHash;
    let derivedPredecessorId: string | null = current.predecessorScheduleId;

    let updated;
    try {
      updated = await this.prisma.$transaction(async (tx) => {
        const others = await tx.deploySchedule.findMany({ where: { chatbotId, status: { in: ACTIVE }, id: { not: scheduleId } }, select: { scheduledAt: true } });
        const timeViolations = checkScheduleTimeRules({ scheduledAt: dto.scheduledAt, now, otherActiveTimes: others.map((o) => o.scheduledAt) });
        if (timeViolations.length > 0) {
          throw new ApiException('DEPLOY_SCHEDULE_INVALID_TIME', 400, '예약 시각이 규칙을 위반했습니다.', timeViolations.map((v) => ({ field: 'scheduledAt', message: v.rule })));
        }

        if (current.targetVersionId !== null) {
          if (dto.previewedContentHash === undefined) {
            throw new ApiException('VALIDATION_FAILED', 400, '복원 예약 재개는 새 미리보기 해시가 필요합니다.', [{ field: 'previewedContentHash', message: '필수 값입니다.' }]);
          }
          const activeRestores = await tx.deploySchedule.findMany({
            where: { chatbotId, action: 'RESTORE_VERSION', status: { in: ACTIVE }, id: { not: scheduleId } },
            select: { id: true, scheduledAt: true, targetContentHash: true },
          });
          const derived = await executor.resolveForInsert(tx, {
            chatbotId,
            scheduledAt: dto.scheduledAt,
            params: currentParams as never,
            previewedContentHash: dto.previewedContentHash,
            now,
            activeRestoreSiblings: activeRestores,
            activeSiblingActions: activeRestores.map(() => 'RESTORE_VERSION' as never),
          });
          derivedExpectedHash = derived.expectedContentHash ?? null;
          derivedPredecessorId = derived.predecessorScheduleId ?? null;
        }

        return tx.deploySchedule.update({
          where: { id: scheduleId },
          data: {
            status: 'PENDING',
            scheduledAt: dto.scheduledAt,
            expectedContentHash: derivedExpectedHash,
            predecessorScheduleId: derivedPredecessorId,
            attemptCount: 0,
            lastAttemptAt: null,
            lastTransientReason: null,
            heldReason: null,
            heldByScheduleId: null,
            heldAt: null,
          },
        });
      });
    } catch (e) {
      if (e instanceof ApiException) throw e;
      if (isUniqueConstraintViolation(e)) {
        // 부분 유니크①(deploy_schedules_chatbotId_scheduledAt_active_key) 위반 — 전역 P2002 분기(예:
        // DUPLICATE_SLUG)로 떨어지지 않도록 이 서비스가 직접 변환한다(§4.2, code-review M1).
        throw new ApiException('DEPLOY_SCHEDULE_INVALID_TIME', 400, '같은 챗봇에 같은 분(minute)의 활성 예약이 이미 있습니다.');
      }
      if (isBusyError(e)) throw new ApiException('RESTORE_BUSY', 409, '다른 변경과 동시에 처리되어 예약을 재개하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      throw e;
    }

    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'DeploySchedule',
      targetId: updated.id,
      targetName: `${ACTION_LABELS[updated.action as keyof typeof ACTION_LABELS]} · ${updated.scheduledAt.toISOString()}`,
      chatbotId,
      before: { status: 'HELD' },
      after: { status: 'PENDING', scheduledAt: updated.scheduledAt },
      summary: '보류 해제',
    });

    return this.queryService.buildDetail(updated);
  }

  async acknowledge(chatbotId: string, scheduleId: string, user: SessionUser): Promise<DeployScheduleDetail> {
    this.assertAnyManagePermission(user);
    await this.assertScope(chatbotId, true);
    const current = await this.getRowOrThrow(chatbotId, scheduleId);
    this.assertOwnActionPermission(user, current);

    if (!['FAILED', 'MISSED', 'HELD'].includes(current.status)) {
      throw new ApiException('DEPLOY_SCHEDULE_NOT_MODIFIABLE', 409, '실패·누락·보류 상태의 예약만 확인 처리할 수 있습니다.');
    }
    if (current.acknowledgedAt) return this.queryService.buildDetail(current); // 멱등

    const now = this.clock.now();
    const updated = await this.prisma.deploySchedule.update({
      where: { id: scheduleId },
      data: { acknowledgedAt: now, acknowledgedById: user.id, acknowledgedByEmail: user.email },
    });
    return this.queryService.buildDetail(updated);
  }

  private async getRowOrThrow(chatbotId: string, scheduleId: string) {
    const row = await this.prisma.deploySchedule.findUnique({ where: { id: scheduleId } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 예약을 찾을 수 없습니다.');
    return row;
  }

  private assertOwnActionPermission(user: SessionUser, row: { action: string; params: string }): void {
    const executor = this.registry.get(row.action as never);
    const params = JSON.parse(row.params) as Record<string, unknown>;
    const required = executor.requiredPermissions(params as never);
    if (!required.every((p) => hasPermission(user.role, p))) {
      throw new ApiException('FORBIDDEN', 403, '이 작업을 수행할 권한이 없습니다.');
    }
  }
}
