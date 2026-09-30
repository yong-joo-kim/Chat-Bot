import { Injectable } from '@nestjs/common';
import type { ProdSwitchApprovalRequest as RequestRow } from '@prisma/client';
import type { GateEvaluation, ProdSwitchApprovalSummary } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { canDecide } from './lib/approval-state';

function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** 게이트 스냅샷 판정 — 깨진 JSON은 `PASS`가 아니라 `WARN`(안전 측 표시). */
export function gateVerdictOf(row: Pick<RequestRow, 'gateSnapshot'>): GateEvaluation['verdict'] {
  const gate = parseJson<Partial<GateEvaluation>>(row.gateSnapshot, {});
  return gate.verdict === 'PASS' || gate.verdict === 'WARN' || gate.verdict === 'BLOCK' ? gate.verdict : 'WARN';
}

/**
 * 요청 행 → API 요약(설계서 §13.2). 챗봇 이름·요청자 활성 여부·예약 시각·실행 시각을 행 목록당 **일괄 조회**로 채운다
 * (N+1 없음). `canApprove`·`canCancel`은 표시용이며 서버가 승인·취소 시점에 다시 강제한다.
 */
@Injectable()
export class SwitchApprovalMapper {
  constructor(private readonly prisma: PrismaService) {}

  async toSummaries(rows: readonly RequestRow[], actorId: string): Promise<ProdSwitchApprovalSummary[]> {
    if (rows.length === 0) return [];

    const chatbotIds = [...new Set(rows.map((r) => r.chatbotId))];
    const requesterIds = [...new Set(rows.map((r) => r.requestedById))];
    const scheduleIds = [...new Set(rows.map((r) => r.deployScheduleId).filter((id): id is string => !!id))];
    const executedIds = rows.filter((r) => r.status === 'APPROVED' && r.outcome === 'SCHEDULED').map((r) => r.id);

    const [chatbots, users, schedules, logs] = await Promise.all([
      this.prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true } }),
      this.prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, status: true } }),
      scheduleIds.length > 0 ? this.prisma.deploySchedule.findMany({ where: { id: { in: scheduleIds } }, select: { id: true, scheduledAt: true } }) : Promise.resolve([]),
      executedIds.length > 0
        ? this.prisma.environmentSwitchLog.findMany({ where: { approvalRequestId: { in: executedIds } }, select: { approvalRequestId: true, createdAt: true } })
        : Promise.resolve([]),
    ]);
    const chatbotName = new Map(chatbots.map((c) => [c.id, c.name]));
    const userActive = new Map(users.map((u) => [u.id, u.status === 'ACTIVE']));
    const scheduledAt = new Map(schedules.map((s) => [s.id, s.scheduledAt]));
    const executedAt = new Map(logs.map((l) => [l.approvalRequestId as string, l.createdAt]));

    return rows.map((row) => {
      const pendingDecidable = canDecide(row.status, row.requestedById, actorId);
      return {
        id: row.id,
        chatbotId: row.chatbotId,
        chatbotName: chatbotName.get(row.chatbotId) ?? '',
        action: row.action as ProdSwitchApprovalSummary['action'],
        status: row.status as ProdSwitchApprovalSummary['status'],
        outcome: row.outcome as ProdSwitchApprovalSummary['outcome'],
        failureCode: row.failureCode,
        closedReason: row.closedReason as ProdSwitchApprovalSummary['closedReason'],
        target: { versionId: row.targetVersionId, versionNo: row.targetVersionNo },
        base: { versionId: row.baseProdVersionId, versionNo: row.baseProdVersionNo },
        deployScheduleId: row.deployScheduleId,
        scheduledAt: row.deployScheduleId ? (scheduledAt.get(row.deployScheduleId) ?? null) : null,
        gateVerdict: gateVerdictOf(row),
        warningCodes: parseJson<string[]>(row.warningCodes, []),
        diffChangedCount: row.diffChangedCount,
        reason: row.reason,
        decisionNote: row.decisionNote,
        requestedBy: { id: row.requestedById, email: row.requestedByEmail, active: userActive.get(row.requestedById) ?? false },
        decidedBy: row.decidedById && row.decidedByEmail ? { id: row.decidedById, email: row.decidedByEmail } : null,
        decidedAt: row.decidedAt,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
        canApprove: pendingDecidable,
        canCancel: row.status === 'PENDING' && row.requestedById === actorId,
        executedAt: row.status === 'APPROVED' && row.outcome === 'APPLIED' ? row.decidedAt : (executedAt.get(row.id) ?? null),
      };
    });
  }
}

/** 감사 스냅샷 투영 — 사유·메모 본문 0(설계서 §14). */
export function toApprovalAuditView(row: RequestRow): Record<string, unknown> {
  return {
    action: row.action,
    status: row.status,
    outcome: row.outcome,
    failureCode: row.failureCode,
    closedReason: row.closedReason,
    targetVersionNo: row.targetVersionNo,
    baseProdVersionNo: row.baseProdVersionNo,
    expiresAt: row.expiresAt,
    gateVerdict: gateVerdictOf(row),
  };
}
