import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkflowSummaryResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkflowTriggerService } from '../triggers/workflow-trigger.service';

const TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'EXPIRED'] as const;

/** [신규 No.41] 7/30일 요약(§13.4) — KST 일 버킷 기준. */
@Injectable()
export class WorkflowSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly triggers: WorkflowTriggerService,
  ) {}

  async summarize(days: 7 | 30, scope?: { chatbotId: string }): Promise<WorkflowSummaryResponse> {
    const now = new Date();
    const since = new Date(now.getTime() - days * 86_400_000);
    const where: Record<string, unknown> = { createdAt: { gte: since }, ...(scope?.chatbotId ? { chatbotId: scope.chatbotId } : {}) };

    const [statusGroups, byTargetGroups, byEventGroups, dailyGroups, latencySample] = await Promise.all([
      this.prisma.workflowRun.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.workflowRun.groupBy({ by: ['targetId', 'status'], where, _count: { _all: true } }),
      this.prisma.workflowRun.groupBy({ by: ['eventType', 'status'], where, _count: { _all: true } }),
      this.prisma.workflowRun.groupBy({ by: ['dayBucket', 'status'], where, _count: { _all: true } }),
      this.prisma.workflowRun.findMany({
        where: { ...where, status: 'SUCCEEDED', deliveryLatencyMs: { not: null } },
        select: { deliveryLatencyMs: true },
        orderBy: { completedAt: 'desc' },
        take: 10_000,
      }),
    ]);

    const totals = { occurred: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0, expired: 0, pending: 0, held: 0 };
    for (const g of statusGroups) {
      totals.occurred += g._count._all;
      const key = g.status.toLowerCase() as keyof typeof totals;
      if (key in totals && key !== 'occurred') totals[key] = (totals[key] ?? 0) + g._count._all;
    }

    const targetNames = await this.prisma.workflowTarget.findMany({ select: { id: true, name: true } });
    const targetNameMap = new Map(targetNames.map((t) => [t.id, t.name]));
    const byTargetMap = new Map<string, { succeeded: number; failed: number }>();
    for (const g of byTargetGroups) {
      const entry = byTargetMap.get(g.targetId) ?? { succeeded: 0, failed: 0 };
      if (g.status === 'SUCCEEDED') entry.succeeded += g._count._all;
      if (g.status === 'FAILED') entry.failed += g._count._all;
      byTargetMap.set(g.targetId, entry);
    }

    const byEventMap = new Map<string, { succeeded: number; failed: number }>();
    for (const g of byEventGroups) {
      const entry = byEventMap.get(g.eventType) ?? { succeeded: 0, failed: 0 };
      if (g.status === 'SUCCEEDED') entry.succeeded += g._count._all;
      if (g.status === 'FAILED') entry.failed += g._count._all;
      byEventMap.set(g.eventType, entry);
    }

    const dailyMap = new Map<string, { succeeded: number; failed: number; skipped: number }>();
    for (const g of dailyGroups) {
      const entry = dailyMap.get(g.dayBucket) ?? { succeeded: 0, failed: 0, skipped: 0 };
      if (g.status === 'SUCCEEDED') entry.succeeded += g._count._all;
      if (g.status === 'FAILED') entry.failed += g._count._all;
      if (g.status === 'SKIPPED') entry.skipped += g._count._all;
      dailyMap.set(g.dayBucket, entry);
    }

    const terminalCount = TERMINAL_STATUSES.reduce((sum, s) => sum + (statusGroups.find((g) => g.status === s)?._count._all ?? 0), 0);
    const retryCount = await this.prisma.workflowRun.count({ where: { ...where, status: { in: [...TERMINAL_STATUSES] }, attemptCount: { gt: 1 } } });
    const retryRate = terminalCount > 0 ? retryCount / terminalCount : 0;

    const latencies = latencySample.map((r) => r.deliveryLatencyMs as number).sort((a, b) => a - b);
    const p95DeliveryMs = latencies.length > 0 ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null;
    const approximated = latencySample.length >= 10_000;

    const failingTargets = await this.prisma.workflowTarget.count({ where: { consecutiveFailures: { gte: 10 } } });
    const failedRetained = await this.prisma.workflowRun.count({ where: { ...where, status: 'FAILED', payloadPurgedAt: null } });
    const oldestPending = await this.prisma.workflowRun.findFirst({ where: { ...where, status: 'PENDING' }, orderBy: { nextAttemptAt: 'asc' }, select: { nextAttemptAt: true } });
    const oldestPendingMinutes = oldestPending?.nextAttemptAt ? Math.max(0, Math.round((now.getTime() - oldestPending.nextAttemptAt.getTime()) / 60_000)) : null;

    return {
      days,
      timezone: 'Asia/Seoul',
      featureEnabled: this.config.get<boolean>('WORKFLOW_ENABLED') ?? true,
      totals,
      retryRate,
      p95DeliveryMs,
      approximated,
      byTarget: [...byTargetMap.entries()].map(([targetId, v]) => ({ targetId, targetName: targetNameMap.get(targetId) ?? targetId, ...v })),
      byEvent: [...byEventMap.entries()].map(([eventType, v]) => ({ eventType: eventType as never, ...v })),
      daily: [...dailyMap.entries()].map(([dayBucket, v]) => ({ dayBucket, ...v })),
      attention: {
        failingTargets,
        failedRetained,
        secretMissingTargets: 0,
        oldestPendingMinutes,
        enqueueFailures24h: this.triggers.enqueueFailures24h(),
      },
    };
  }
}
