import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RestoreVersionParamsSchema } from '@chat-bot/shared-types';
import type { Permission, RestoreBlocker, RestoreVersionParams } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import type { ScheduledInvocation } from '../../audit-logs/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VersionRestoreService } from '../../versions/restore/version-restore.service';
import { VersionCaptureService } from '../../versions/capture/version-capture.service';
import { requiredPermissions } from '../lib/required-permissions';
import { findPredecessor, hasLaterActiveRestore } from '../lib/chain-rules';
import { classifyExecutionError } from '../lib/outcome-classifier';
import { buildRestoreSummary, restoreSummaryFromResponse } from '../lib/result-summary';
import { judgeRestoreRecovery } from '../lib/recovery-judge';
import type {
  ActionPreviewResult,
  DeployActionExecutor,
  DerivedFields,
  ExecutionContext,
  ExecutionOutcome,
  InsertContext,
  PreviewContext,
  RecoveryContext,
  RecoveryVerdictOutcome,
} from './deploy-action-executor';

/**
 * [신규 2026-09-23 No.28] `RESTORE_VERSION` 실행기 — 저장소 전체에서 `VersionRestoreService.restore()`를
 * 호출하는 두 번째이자 마지막 파일이다(첫째 = `versions.controller.ts`, §16 D-3, J-11). `restore()`
 * 내부(잠금·준비·단일 트랜잭션·해시 재확인·백업·사후검증·invalidate·보존정리)는 한 줄도 바꾸지 않는다.
 */
@Injectable()
export class RestoreVersionExecutor implements DeployActionExecutor<'RESTORE_VERSION'> {
  readonly action = 'RESTORE_VERSION' as const;
  readonly paramsSchema = RestoreVersionParamsSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly versionRestore: VersionRestoreService,
    private readonly versionCapture: VersionCaptureService,
  ) {}

  requiredPermissions(params: RestoreVersionParams): Permission[] {
    return requiredPermissions('RESTORE_VERSION', params);
  }

  async preview(ctx: PreviewContext<'RESTORE_VERSION'>): Promise<ActionPreviewResult> {
    const pred = findPredecessor(ctx.activeRestoreSiblings, ctx.scheduledAt);
    const rp = await this.versionRestore.preview(ctx.chatbotId, ctx.params.versionId);

    const baseContentHash = pred ? (pred.targetContentHash ?? '') : rp.currentContentHash;
    const base = pred
      ? {
          kind: 'SCHEDULE' as const,
          scheduleId: pred.id,
          scheduledAt: pred.scheduledAt,
          versionId: ctx.params.versionId,
          versionNo: rp.targetVersion.versionNo,
          contentHash: baseContentHash,
        }
      : { kind: 'CURRENT' as const, contentHash: rp.currentContentHash };

    // 예약 의미로 재해석 — ACTIVE_JOB·RESTORE_IN_PROGRESS는 경고로 격하(readiness가 별도 노출, FR-D2-3)
    let blockers: RestoreBlocker[] = rp.blockers.filter((b) => b.code !== 'ACTIVE_JOB' && b.code !== 'RESTORE_IN_PROGRESS' && b.code !== 'NO_CHANGES');
    const isNoChanges = pred ? rp.targetContentHash === baseContentHash : rp.currentContentHash === rp.targetContentHash;
    if (isNoChanges) blockers = [...blockers, { code: 'NO_CHANGES' as const }];

    const preconditionFailures: ActionPreviewResult['preconditionFailures'] = [];
    if (blockers.some((b) => b.code === 'INTEGRITY_FAILED' || b.code === 'SCHEMA_UNSUPPORTED' || b.code === 'CHATBOT_ARCHIVED')) {
      preconditionFailures.push({ code: 'RESTORE_BLOCKED' });
    }
    if (isNoChanges) preconditionFailures.push({ code: 'RESTORE_NO_CHANGES' });

    const requiresAcknowledgeActive = ctx.chatbotStatus === 'ACTIVE' || ctx.earlierActivePublishExists;

    return {
      preconditionFailures,
      restore: {
        base,
        targetVersion: { id: rp.targetVersion.id, versionNo: rp.targetVersion.versionNo },
        targetContentHash: rp.targetContentHash,
        diffSummary: rp.diffSummary,
        blockers,
        requiresAcknowledgeActive,
      },
    };
  }

  async resolveForInsert(tx: Prisma.TransactionClient, ctx: InsertContext<'RESTORE_VERSION'>): Promise<DerivedFields> {
    // R2 — 복원 체인은 뒤에만 붙는다.
    if (hasLaterActiveRestore(ctx.activeRestoreSiblings, ctx.scheduledAt)) {
      throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '이 챗봇에는 이 예약보다 늦은 복원 예약이 이미 있습니다.', [
        { field: 'precondition', message: 'CHAIN_ORDER' },
      ]);
    }

    const pred = findPredecessor(ctx.activeRestoreSiblings, ctx.scheduledAt);

    const versionRow = await tx.chatbotVersion.findUnique({ where: { id: ctx.params.versionId } });
    if (!versionRow || versionRow.chatbotId !== ctx.chatbotId) {
      throw new ApiException('NOT_FOUND', 404, '요청하신 버전을 찾을 수 없습니다.');
    }

    // R1 — 기준 해시: 선행 있으면 그 대상 해시, 없으면 트랜잭션 안에서 재계산한 현재 해시.
    let expectedContentHash: string;
    if (pred) {
      expectedContentHash = pred.targetContentHash ?? '';
    } else {
      const captured = await this.versionCapture.readConsistent(ctx.chatbotId, tx);
      const current = this.versionCapture.computeFromCaptured(captured, ctx.now);
      expectedContentHash = current.contentHash;
    }

    // R4 — 미리보기 이후 기준이 달라지면 거부.
    if (ctx.previewedContentHash !== undefined && ctx.previewedContentHash !== expectedContentHash) {
      throw new ApiException('RESTORE_PREVIEW_STALE', 409, '미리보기 이후 기준 상태가 변경되었습니다. 차이를 다시 확인해 주세요.');
    }

    const targetContentHash = versionRow.contentHash;
    if (targetContentHash === expectedContentHash) {
      throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '기준 상태와 대상 버전이 이미 동일합니다.', [
        { field: 'precondition', message: 'RESTORE_NO_CHANGES' },
      ]);
    }

    return {
      targetVersionId: versionRow.id,
      targetVersionNo: versionRow.versionNo,
      targetContentHash,
      expectedContentHash,
      predecessorScheduleId: pred?.id ?? null,
    };
  }

  async execute(ctx: ExecutionContext<'RESTORE_VERSION'>): Promise<ExecutionOutcome> {
    // §5.3 사전 확인(읽기) — restore() 호출 전에 예약 의미의 영구적 원인을 먼저 가른다.
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: ctx.chatbotId }, select: { status: true } });
    if (!chatbot) return { kind: 'PERMANENT', reason: 'CHATBOT_NOT_FOUND' };
    if (chatbot.status === 'ARCHIVED') return { kind: 'PERMANENT', reason: 'CHATBOT_ARCHIVED' };
    if (chatbot.status === 'ACTIVE' && !ctx.acknowledgeActive) return { kind: 'PERMANENT', reason: 'STATE_CHANGED' };
    const targetVersion = await this.prisma.chatbotVersion.findUnique({ where: { id: ctx.params.versionId }, select: { id: true } });
    if (!targetVersion) return { kind: 'PERMANENT', reason: 'TARGET_VERSION_MISSING' };

    const invocation: ScheduledInvocation = {
      actor: { id: ctx.actor.id, email: ctx.actor.email, role: ctx.actor.role },
      auditSummaryPrefix: ctx.auditSummaryPrefix,
      triggerContext: { deployScheduleId: ctx.deployScheduleId },
    };

    try {
      const response = await this.versionRestore.restore(
        ctx.chatbotId,
        ctx.params.versionId,
        { expectedCurrentHash: ctx.expectedContentHash ?? '', acknowledgeActive: ctx.acknowledgeActive },
        invocation,
      );
      return { kind: 'APPLIED', summary: restoreSummaryFromResponse(response) };
    } catch (e) {
      if (e instanceof ApiException) {
        const body = e.getResponse() as { code?: string };
        if (body.code === 'RESTORE_NO_CHANGES') {
          // NOOP — 백업을 만들지 않는다(§7.6). fromVersionNo/backupVersionNo/backupVersionId는
          // 생략한다(자리표시값 0/'' 금지, code-review M2).
          return { kind: 'NOOP', summary: buildRestoreSummary({ counts: {}, reindexWasRunning: false, classifierDeleted: false }) };
        }
      }
      return classifyExecutionError(e);
    }
  }

  async judgeRecovery(ctx: RecoveryContext<'RESTORE_VERSION'>): Promise<RecoveryVerdictOutcome> {
    const candidates = await this.prisma.chatbotVersion.findMany({
      where: { chatbotId: ctx.chatbotId, trigger: 'BEFORE_RESTORE', createdAt: { gte: ctx.claimedAt } },
      select: { id: true, versionNo: true, triggerContext: true },
    });
    const backup = candidates.find((c) => {
      if (!c.triggerContext) return false;
      try {
        return (JSON.parse(c.triggerContext) as { deployScheduleId?: string }).deployScheduleId === ctx.deployScheduleId;
      } catch {
        return false;
      }
    });

    if (backup) {
      // RECOVERED — 백업(따라서 fromVersionNo·backupVersionNo·backupVersionId)이 전부 실존한다.
      // fromVersionNo(= 대상 버전 번호, RestoreResponse.restoredFromVersionNo와 같은 의미)는 이 예약의
      // 대상 버전을 조회해 채운다(자리표시값 금지, code-review M2). 조회 실패 시에만 생략한다.
      const targetVersion = await this.prisma.chatbotVersion.findUnique({ where: { id: ctx.params.versionId }, select: { versionNo: true } });
      return {
        kind: 'RECOVERED',
        summary: buildRestoreSummary({
          ...(targetVersion ? { fromVersionNo: targetVersion.versionNo } : {}),
          backupVersionNo: backup.versionNo,
          backupVersionId: backup.id,
          counts: {},
          reindexWasRunning: false,
          classifierDeleted: false,
        }),
      };
    }

    const current = await this.versionCapture.captureSnapshotData(ctx.chatbotId);
    const verdict = judgeRestoreRecovery(false, current.contentHash === ctx.targetContentHash);
    if (verdict.kind === 'NOOP') {
      // NOOP — 우리가 쓰지 않았다(현재 해시가 이미 대상과 같음). 백업 없음 — 세 필드 생략.
      return { kind: 'NOOP', summary: buildRestoreSummary({ counts: {}, reindexWasRunning: false, classifierDeleted: false }) };
    }
    return { kind: 'INTERRUPTED' };
  }
}
