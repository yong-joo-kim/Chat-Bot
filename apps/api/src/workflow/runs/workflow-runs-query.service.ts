import { Injectable } from '@nestjs/common';
import { WORKFLOW_LIMITS } from '@chat-bot/shared-types';
import type { WorkflowRunItem, WorkflowRunListQuery } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { toPaginated } from '../../common/pagination';
import type { Paginated } from '@chat-bot/shared-types';

const RUN_SELECT = {
  id: true,
  targetId: true,
  targetName: true,
  chatbotId: true,
  triggerKind: true,
  eventType: true,
  actionKey: true,
  nodeId: true,
  subscriptionId: true,
  sessionRef: true,
  status: true,
  statusReason: true,
  holdReason: true,
  attemptCount: true,
  nextAttemptAt: true,
  lastOutcome: true,
  lastHttpStatus: true,
  lastLatencyMs: true,
  personalDataMasked: true,
  fieldNames: true,
  payloadBytes: true,
  payloadPurgedAt: true,
  manualRetryCount: true,
  createdAt: true,
  completedAt: true,
} as const;

type RunRow = {
  id: string;
  targetId: string;
  targetName: string;
  chatbotId: string | null;
  triggerKind: string;
  eventType: string;
  actionKey: string | null;
  nodeId: string | null;
  subscriptionId: string | null;
  sessionRef: string | null;
  status: string;
  statusReason: string | null;
  holdReason: string | null;
  attemptCount: number;
  nextAttemptAt: Date | null;
  lastOutcome: string | null;
  lastHttpStatus: number | null;
  lastLatencyMs: number | null;
  personalDataMasked: boolean;
  fieldNames: string;
  payloadBytes: number | null;
  payloadPurgedAt: Date | null;
  manualRetryCount: number;
  createdAt: Date;
  completedAt: Date | null;
};

function toItem(row: RunRow): WorkflowRunItem {
  return {
    id: row.id,
    targetId: row.targetId,
    targetName: row.targetName,
    chatbotId: row.chatbotId,
    triggerKind: row.triggerKind as never,
    eventType: row.eventType as never,
    actionKey: row.actionKey,
    nodeId: row.nodeId,
    subscriptionId: row.subscriptionId,
    sessionRef: row.sessionRef,
    status: row.status as never,
    statusReason: row.statusReason as never,
    holdReason: row.holdReason as never,
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    lastOutcome: row.lastOutcome as never,
    lastHttpStatus: row.lastHttpStatus,
    lastLatencyMs: row.lastLatencyMs,
    personalDataMasked: row.personalDataMasked,
    fieldNames: safeParseArray(row.fieldNames),
    retryable: row.status === 'FAILED' && row.payloadBytes !== null && row.payloadPurgedAt === null,
    payloadPurged: row.payloadPurgedAt !== null,
    manualRetryCount: row.manualRetryCount,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** [신규 No.41] 실행 이력 조회(§13.1) — `payload` 컬럼을 읽지 않는다(select 허용 목록). */
@Injectable()
export class WorkflowRunsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: WorkflowRunListQuery, scope?: { chatbotId: string }): Promise<Paginated<WorkflowRunItem>> {
    const now = new Date();
    const from = query.from ?? new Date(now.getTime() - 7 * 86_400_000);
    const to = query.to ?? now;
    const rangeDays = (to.getTime() - from.getTime()) / 86_400_000;
    if (rangeDays > WORKFLOW_LIMITS.historyRangeDays) {
      throw new ApiException('STATS_RANGE_TOO_WIDE', 400, `조회 기간은 최대 ${WORKFLOW_LIMITS.historyRangeDays}일까지 가능합니다.`);
    }

    const where: Record<string, unknown> = { createdAt: { gte: from, lte: to } };
    if (scope?.chatbotId) where.chatbotId = scope.chatbotId;
    else if (query.chatbotId) where.chatbotId = query.chatbotId;
    if (query.targetId) where.targetId = query.targetId;
    if (query.triggerKind && query.triggerKind.length > 0) where.triggerKind = { in: query.triggerKind };
    if (query.eventType && query.eventType.length > 0) where.eventType = { in: query.eventType };
    if (query.status && query.status.length > 0) where.status = { in: query.status };
    if (query.retryableOnly) {
      where.status = 'FAILED';
      where.payloadPurgedAt = null;
    }

    const [rows, total] = await Promise.all([
      this.prisma.workflowRun.findMany({
        where,
        select: RUN_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.workflowRun.count({ where }),
    ]);

    return toPaginated(rows.map(toItem), total, query.page, query.pageSize);
  }
}
