import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WORKFLOW_LIMITS } from '@chat-bot/shared-types';
import type { CreateWorkflowSubscriptionDto, UpdateWorkflowSubscriptionDto, WorkflowSubscription } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { WorkflowCatalogService } from '../catalog/workflow-catalog.service';
import { WorkflowRunStore } from '../core/workflow-run.store';
import { workflowHoldMaxMs } from '../lib/hold-max';

const NOT_FOUND_MESSAGE = '요청하신 이벤트 구독을 찾을 수 없습니다.';

function toResponse(row: {
  id: string;
  chatbotId: string;
  eventType: string;
  targetId: string;
  enabled: boolean;
  pausedAt: Date | null;
  conditions: string;
  createdAt: Date;
  updatedAt: Date;
  target: { name: string; enabled: boolean; pausedAt: Date | null };
}): WorkflowSubscription {
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    eventType: row.eventType as never,
    targetId: row.targetId,
    targetName: row.target.name,
    targetEnabled: row.target.enabled,
    targetPaused: !!row.target.pausedAt,
    enabled: row.enabled,
    pausedAt: row.pausedAt,
    conditions: safeParseConditions(row.conditions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeParseConditions(json: string): { threshold?: number; includeStructuredAnswers?: boolean } {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * [신규 No.41] 챗봇 × 이벤트 × 대상 구독 관리(§14) — 환경 밖(저장 즉시 운영 반영, 캐시 30초 + 즉시 무효화).
 */
@Injectable()
export class WorkflowSubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLogService: AuditLogService,
    private readonly catalog: WorkflowCatalogService,
    private readonly store: WorkflowRunStore,
  ) {}

  async list(chatbotId: string): Promise<{ items: WorkflowSubscription[] }> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.workflowSubscription.findMany({
      where: { chatbotId },
      include: { target: { select: { name: true, enabled: true, pausedAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map(toResponse) };
  }

  private async findRowOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.workflowSubscription.findFirst({
      where: { id, chatbotId },
      include: { target: { select: { name: true, enabled: true, pausedAt: true } } },
    });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async create(chatbotId: string, dto: CreateWorkflowSubscriptionDto): Promise<WorkflowSubscription> {
    await this.scope.assertWritable(chatbotId);
    const count = await this.prisma.workflowSubscription.count({ where: { chatbotId } });
    if (count >= WORKFLOW_LIMITS.subscriptionsPerChatbot) {
      throw new ApiException('LIMIT_EXCEEDED', 409, `구독은 챗봇당 ${WORKFLOW_LIMITS.subscriptionsPerChatbot}개까지 등록할 수 있습니다.`);
    }
    const target = await this.prisma.workflowTarget.findUnique({ where: { id: dto.targetId } });
    if (!target) throw new ApiException('INVALID_REFERENCE', 404, '선택한 발송 대상을 찾을 수 없습니다.');

    try {
      const row = await this.prisma.workflowSubscription.create({
        data: { chatbotId, eventType: dto.eventType, targetId: dto.targetId, enabled: dto.enabled, conditions: JSON.stringify(dto.conditions) },
        include: { target: { select: { name: true, enabled: true, pausedAt: true } } },
      });
      await this.auditLogService.record({
        action: 'CREATE',
        targetType: 'WorkflowSubscription',
        targetId: row.id,
        targetName: `${dto.eventType} → ${target.name}`,
        chatbotId,
        after: { eventType: row.eventType, targetId: row.targetId, enabled: row.enabled, conditions: row.conditions },
      });
      this.catalog.invalidateSubscriptionCache();
      return toResponse(row);
    } catch (e) {
      if (isUniqueConstraintViolation(e)) throw new ApiException('DUPLICATE_NAME', 409, '같은 챗봇·이벤트·대상 구독이 이미 있습니다.');
      throw e;
    }
  }

  async update(chatbotId: string, id: string, dto: UpdateWorkflowSubscriptionDto): Promise<WorkflowSubscription> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);

    if (dto.targetId !== undefined) {
      const target = await this.prisma.workflowTarget.findUnique({ where: { id: dto.targetId } });
      if (!target) throw new ApiException('INVALID_REFERENCE', 404, '선택한 발송 대상을 찾을 수 없습니다.');
    }

    const row = await this.prisma.workflowSubscription.update({
      where: { id },
      data: {
        ...(dto.targetId !== undefined ? { targetId: dto.targetId } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.conditions !== undefined ? { conditions: JSON.stringify(dto.conditions) } : {}),
      },
      include: { target: { select: { name: true, enabled: true, pausedAt: true } } },
    });

    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'WorkflowSubscription',
      targetId: row.id,
      targetName: `${row.eventType} → ${row.target.name}`,
      chatbotId,
      before: { eventType: current.eventType, targetId: current.targetId, enabled: current.enabled, conditions: current.conditions },
      after: { eventType: row.eventType, targetId: row.targetId, enabled: row.enabled, conditions: row.conditions },
    });
    this.catalog.invalidateSubscriptionCache();
    return toResponse(row);
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    await this.prisma.workflowSubscription.delete({ where: { id } });
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'WorkflowSubscription',
      targetId: id,
      targetName: `${current.eventType} → ${current.target.name}`,
      chatbotId,
      before: { eventType: current.eventType, targetId: current.targetId, enabled: current.enabled, conditions: current.conditions },
    });
    this.catalog.invalidateSubscriptionCache();
  }

  async pause(chatbotId: string, id: string): Promise<WorkflowSubscription> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    const ok = await this.store.pauseSubscription(id, new Date());
    if (ok) {
      await this.auditLogService.record({ action: 'STATUS_CHANGE', targetType: 'WorkflowSubscription', targetId: id, targetName: current.eventType, chatbotId, summary: '일시 정지' });
    }
    return toResponse(await this.findRowOrThrow(chatbotId, id));
  }

  async resume(chatbotId: string, id: string): Promise<WorkflowSubscription> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, id);
    const { resumed, expired } = await this.store.resumeSubscription(id, new Date(), workflowHoldMaxMs(this.config));
    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'WorkflowSubscription',
      targetId: id,
      targetName: current.eventType,
      chatbotId,
      summary: `재개(발송 ${resumed} · 만료 ${expired})`,
    });
    return toResponse(await this.findRowOrThrow(chatbotId, id));
  }
}

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
