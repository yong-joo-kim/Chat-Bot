import { Injectable } from '@nestjs/common';
import type { WorkflowRunBulkRequestDto, WorkflowRunBulkResult } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { WorkflowRunStore } from '../core/workflow-run.store';

/** [신규 No.41] 재발송·취소(§7.7) — 전건 사전검사 후 CAS 실행. */
@Injectable()
export class WorkflowRunOpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly store: WorkflowRunStore,
  ) {}

  async retry(chatbotId: string, dto: WorkflowRunBulkRequestDto): Promise<WorkflowRunBulkResult> {
    const rows = await this.prisma.workflowRun.findMany({
      where: { id: { in: dto.runIds }, chatbotId },
      select: { id: true, status: true, payloadBytes: true, payloadPurgedAt: true },
    });
    if (rows.length !== dto.runIds.length) throw new ApiException('NOT_FOUND', 404, '일부 실행 이력을 찾을 수 없습니다.');
    const invalid = rows.filter((r) => r.status !== 'FAILED' || r.payloadBytes === null || r.payloadPurgedAt !== null);
    if (invalid.length > 0) {
      throw new ApiException(
        'WORKFLOW_RUN_NOT_RETRYABLE',
        409,
        '재발송할 수 없는 실행 이력이 포함되어 있습니다.',
        invalid.map((r) => ({ field: r.id, message: '재발송 대상이 아닙니다(본문 소거·비실패 상태 포함)' })),
      );
    }

    const now = new Date();
    const count = await this.store.retryManual(dto.runIds, now);
    if (count !== dto.runIds.length) {
      throw new ApiException('WORKFLOW_RUN_NOT_RETRYABLE', 409, '재발송 처리 중 상태가 바뀌어 실패했습니다. 다시 시도해 주세요.');
    }

    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'WorkflowRun',
      targetId: chatbotId,
      targetName: `실패 ${count}건 재발송`,
      chatbotId,
      summary: `실패 ${count}건 재발송`,
    });

    return { updated: count };
  }

  async cancel(chatbotId: string, dto: WorkflowRunBulkRequestDto): Promise<WorkflowRunBulkResult> {
    const rows = await this.prisma.workflowRun.findMany({ where: { id: { in: dto.runIds }, chatbotId }, select: { id: true, status: true } });
    if (rows.length !== dto.runIds.length) throw new ApiException('NOT_FOUND', 404, '일부 실행 이력을 찾을 수 없습니다.');
    const invalid = rows.filter((r) => r.status !== 'PENDING' && r.status !== 'HELD');
    if (invalid.length > 0) {
      throw new ApiException(
        'INVALID_STATUS_TRANSITION',
        400,
        '대기·보류 상태가 아닌 실행 이력은 취소할 수 없습니다.',
        invalid.map((r) => ({ field: r.id, message: `현재 상태: ${r.status}` })),
      );
    }

    const now = new Date();
    const count = await this.store.cancelManual(dto.runIds, now);
    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'WorkflowRun',
      targetId: chatbotId,
      targetName: `${count}건 취소`,
      chatbotId,
      summary: `${count}건 취소`,
    });
    return { updated: count };
  }
}
