import type { DeploySchedule as PrismaDeploySchedule } from '@prisma/client';
import type {
  DeployScheduleAction,
  DeployScheduleDetail,
  DeployScheduleFailureReason,
  DeployScheduleHeldReason,
  DeployScheduleListItem,
  DeployScheduleOutcome,
  DeployScheduleResultSummary,
  DeployScheduleStatus,
  DeployScheduleTransientReason,
  ReadinessWarning,
} from '@chat-bot/shared-types';
import { DEPLOY_SCHEDULE_ATTENTION_STATUSES } from '@chat-bot/shared-types';

function parseParams(row: PrismaDeploySchedule): Record<string, unknown> {
  try {
    return JSON.parse(row.params) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function needsAttention(row: PrismaDeploySchedule): boolean {
  return (DEPLOY_SCHEDULE_ATTENTION_STATUSES as readonly string[]).includes(row.status) && !row.acknowledgedAt;
}

export function toListItem(row: PrismaDeploySchedule, chatbotName?: string): DeployScheduleListItem {
  const params = parseParams(row);
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    chatbotName,
    action: row.action as DeployScheduleAction,
    status: row.status as DeployScheduleStatus,
    scheduledAt: row.scheduledAt,
    targetVersionId: row.targetVersionId,
    targetVersionNo: row.targetVersionNo,
    // 동작 리터럴 분기 대신 params 필드 유무로 판별한다(PUBLISH만 enableWebChannel을, SET_WEB_CHANNEL만
    // enabled를 갖는다 — §16 D-10, 매퍼는 분기 허용 파일 밖이다).
    enableWebChannel: 'enableWebChannel' in params ? ((params.enableWebChannel as boolean | undefined) ?? null) : null,
    channelEnabled: 'enabled' in params ? ((params.enabled as boolean | undefined) ?? null) : null,
    memo: row.memo,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt,
    attemptCount: row.attemptCount,
    lastTransientReason: row.lastTransientReason as DeployScheduleTransientReason | null,
    delaySeconds: row.delaySeconds,
    finishedAt: row.finishedAt,
    outcome: row.outcome as DeployScheduleOutcome | null,
    failureReason: row.failureReason as DeployScheduleFailureReason | null,
    heldReason: row.heldReason as DeployScheduleHeldReason | null,
    needsAttention: needsAttention(row),
  };
}

export function toDetail(
  row: PrismaDeploySchedule,
  extra: {
    chatbotName?: string;
    predecessor: { id: string; scheduledAt: Date; status: DeployScheduleStatus; targetVersionNo: number | null } | null;
    heldBy: { id: string; scheduledAt: Date; status: DeployScheduleStatus; action: DeployScheduleAction } | null;
    revert: { backupVersionId: string; backupVersionNo: number } | null;
    readinessWarnings: ReadinessWarning[];
  },
): DeployScheduleDetail {
  const params = parseParams(row);
  let resultSummary: DeployScheduleResultSummary | null = null;
  if (row.resultSummary) {
    try {
      resultSummary = JSON.parse(row.resultSummary) as DeployScheduleResultSummary;
    } catch {
      resultSummary = null;
    }
  }

  return {
    ...toListItem(row, extra.chatbotName),
    params: params as never,
    acknowledgeActive: row.acknowledgeActive,
    expectedContentHash: row.expectedContentHash,
    targetContentHash: row.targetContentHash,
    predecessor: extra.predecessor,
    heldBy: extra.heldBy,
    resultSummary,
    revert: extra.revert,
    postRunTestSetId: row.postRunTestSetId,
    testRunId: row.testRunId,
    cancelledByEmail: row.cancelledByEmail,
    cancelledAt: row.cancelledAt,
    acknowledgedByEmail: row.acknowledgedByEmail,
    acknowledgedAt: row.acknowledgedAt,
    readinessWarnings: extra.readinessWarnings,
  };
}
