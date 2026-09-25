import { Injectable, Logger } from '@nestjs/common';
import type { ChatbotVersion as PrismaChatbotVersion } from '@prisma/client';
import type { RestoreBlocker, RestorePreviewResponse, RestoreRequestDto, RestoreResponse, VersionAssetKind } from '@chat-bot/shared-types';
import { SNAPSHOT_SCHEMA_VERSION } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { isBusyError } from '../../common/prisma/busy-error';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import type { ScheduledInvocation } from '../../audit-logs/audit-log.service';
import { DialogueBundleService } from '../../dialogue-common/dialogue-bundle.service';
import { AnswerSettingsCacheService } from '../../answer-settings/answer-settings-cache.service';
import { ReindexQueueService } from '../../embedding/index/reindex-queue.service';
import { VersionCaptureService } from '../capture/version-capture.service';
import { VersionRetentionService } from '../capture/version-retention.service';
import { VersionPayloadReader } from '../read/version-payload.reader';
import { hydrateSnapshot } from '../lib/snapshot-hydrate';
import { checkSnapshotIntegrity } from '../lib/snapshot-integrity';
import { computeContentHash } from '../lib/snapshot-canonical';
import { diffSnapshots } from '../lib/version-diff';
import { planRestore } from '../lib/restore-plan';
import { normalizeSnapshotTopics } from '../lib/snapshot-topic-normalize';
import { computeTopicExposureChange } from '../lib/topic-exposure';
import { RestoreLockRegistry } from './restore-lock.registry';
import { RestoreWarningsService } from './restore-warnings.service';
import { VersionRestoreApplier } from './version-restore.applier';
import { findCrossChatbotIdConflicts } from './cross-chatbot-check';

const NOT_FOUND_MESSAGE = '요청하신 버전을 찾을 수 없습니다.';
const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'];

/** 미리보기·확정 오케스트레이션, 잠금, 후속 처리, 감사(§8). */
@Injectable()
export class VersionRestoreService {
  private readonly logger = new Logger('VersionRestoreService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly versionCapture: VersionCaptureService,
    private readonly payloadReader: VersionPayloadReader,
    private readonly warningsService: RestoreWarningsService,
    private readonly applier: VersionRestoreApplier,
    private readonly restoreLock: RestoreLockRegistry,
    private readonly bundleService: DialogueBundleService,
    private readonly answerSettingsCache: AnswerSettingsCacheService,
    private readonly reindexQueue: ReindexQueueService,
    private readonly auditLogService: AuditLogService,
    private readonly retention: VersionRetentionService,
  ) {}

  /** [신규 No.40] select에 `prodVersionId` 추가(경고 입력 전달만 — 복원 의미론 무변경). */
  private async assertScope(chatbotId: string): Promise<{ id: string; name: string; status: string; prodVersionId: string | null }> {
    const row = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true, name: true, status: true, prodVersionId: true } });
    if (!row) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    return row;
  }

  /** [신규 No.40 — §13.1] 모드 켜짐일 때만 `ENV_DRAFT_ONLY` 경고를 만든다(버전 번호 조회). */
  private async buildEnvDraftOnlyWarning(chatbotId: string, prodVersionId: string): Promise<{ code: 'ENV_DRAFT_ONLY'; prodVersionNo: number; stagingVersionNo: number | null }> {
    const [prodRow, envRow] = await Promise.all([
      this.prisma.chatbotVersion.findUnique({ where: { id: prodVersionId }, select: { versionNo: true } }),
      this.prisma.chatbotEnvironment.findUnique({ where: { chatbotId }, select: { stagingVersionId: true } }),
    ]);
    let stagingVersionNo: number | null = null;
    if (envRow?.stagingVersionId) {
      const stagingRow = await this.prisma.chatbotVersion.findUnique({ where: { id: envRow.stagingVersionId }, select: { versionNo: true } });
      stagingVersionNo = stagingRow?.versionNo ?? null;
    }
    return { code: 'ENV_DRAFT_ONLY', prodVersionNo: prodRow?.versionNo ?? 0, stagingVersionNo };
  }

  private async findActiveJobs(chatbotId: string): Promise<Array<{ source: 'TRAINING_JOB' | 'TEST_RUN'; kind: string; status: string; progress: number }>> {
    const [trainingJobs, testRuns] = await Promise.all([
      this.prisma.trainingJob.findMany({ where: { chatbotId, status: { in: ACTIVE_JOB_STATUSES } }, select: { kind: true, status: true, progress: true } }),
      this.prisma.testRun.findMany({ where: { chatbotId, status: { in: ACTIVE_JOB_STATUSES } }, select: { mode: true, status: true, progress: true } }),
    ]);
    return [
      ...trainingJobs.map((j) => ({ source: 'TRAINING_JOB' as const, kind: j.kind, status: j.status, progress: j.progress })),
      ...testRuns.map((r) => ({ source: 'TEST_RUN' as const, kind: r.mode, status: r.status, progress: r.progress })),
    ];
  }

  async preview(chatbotId: string, versionId: string): Promise<RestorePreviewResponse> {
    const chatbot = await this.assertScope(chatbotId);

    const versionRow = await this.prisma.chatbotVersion.findUnique({ where: { id: versionId } });
    if (!versionRow || versionRow.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const blockers: RestoreBlocker[] = [];
    if (chatbot.status === 'ARCHIVED') blockers.push({ code: 'CHATBOT_ARCHIVED' });

    const activeJobs = await this.findActiveJobs(chatbotId);
    if (activeJobs.length > 0) blockers.push({ code: 'ACTIVE_JOB', jobs: activeJobs });

    if (this.restoreLock.isLocked(chatbotId)) blockers.push({ code: 'RESTORE_IN_PROGRESS' });

    const currentData = await this.versionCapture.captureSnapshotData(chatbotId);

    let targetLoad: Awaited<ReturnType<VersionPayloadReader['loadStrict']>> | null = null;
    try {
      targetLoad = await this.payloadReader.loadStrict(versionId);
    } catch (e) {
      if (e instanceof ApiException) {
        const body = e.getResponse() as { code?: string; details?: Array<{ field: string; message: string }> };
        if (body.code === 'VERSION_SCHEMA_UNSUPPORTED') {
          blockers.push({ code: 'SCHEMA_UNSUPPORTED', schemaVersion: versionRow.schemaVersion });
        } else if (body.code === 'VERSION_INTEGRITY_FAILED') {
          blockers.push({ code: 'INTEGRITY_FAILED', violations: [], total: 0 });
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    let diffResult: ReturnType<typeof diffSnapshots> = { summary: { rows: [], totalChanged: 0, identical: true }, items: [] };
    let targetContentHash = versionRow.contentHash;
    let warnings: RestorePreviewResponse['warnings'] = [];

    if (targetLoad) {
      // [신규 No.22 — §11.2] 대상 스냅샷을 현재 토픽 기준으로 정규화한다(없는 토픽 → 공통).
      // 트랜잭션 밖 — 미리보기와 확정 사이에 토픽이 지워져도 확정은 트랜잭션 안에서 다시 정규화한다.
      const currentTopicRows = await this.prisma.topic.findMany({ where: { chatbotId }, select: { id: true, enabled: true } });
      const existingTopicIds = new Set(currentTopicRows.map((t) => t.id));
      const normalized = normalizeSnapshotTopics(targetLoad.envelope, existingTopicIds);
      const effectiveTargetEnvelope = normalized.envelope;

      const hydrated = hydrateSnapshot(effectiveTargetEnvelope, chatbotId);
      const { violations, violationsTotal } = checkSnapshotIntegrity(hydrated, 'RESTORE');
      // §5.5 ⑤ / FR-H3-11 — DB 의존 검사라 순수 함수 밖에서 별도로 수행한다(L-1).
      const crossChatbotViolations = await findCrossChatbotIdConflicts(this.prisma, chatbotId, effectiveTargetEnvelope);
      const allViolations = [...violations, ...crossChatbotViolations];
      if (allViolations.length > 0) {
        blockers.push({
          code: 'INTEGRITY_FAILED',
          violations: allViolations.slice(0, 100),
          total: violationsTotal + crossChatbotViolations.length,
        });
      } else {
        // [신규 No.22] 정규화로 봉투가 바뀌었으면 기대 해시를 정규화본으로 다시 계산한다(§11.2) —
        // 그래야 복원 트랜잭션의 사후 해시 검증(§8)과 충돌하지 않는다.
        targetContentHash = normalized.changed
          ? computeContentHash(effectiveTargetEnvelope)
          : targetLoad.upcastedFrom !== undefined
            ? computeContentHash(effectiveTargetEnvelope)
            : versionRow.contentHash;
        diffResult = diffSnapshots(currentData.envelope, effectiveTargetEnvelope, currentData.integrityWarningCount, versionRow.integrityWarningCount);
        warnings = await this.warningsService.computeWarnings(
          chatbotId,
          chatbot.status,
          currentData.envelope,
          effectiveTargetEnvelope,
          versionRow.integrityWarningCount,
          targetLoad.upcastedFrom,
          SNAPSHOT_SCHEMA_VERSION,
          { topics: currentTopicRows, missingCount: normalized.missingCount },
        );
      }
    }

    if (currentData.contentHash === targetContentHash) blockers.push({ code: 'NO_CHANGES' });

    // [신규 No.40 — §13.1] 모드 켜짐 — 복원은 초안에만 적용된다는 경고.
    if (chatbot.prodVersionId) {
      warnings = [...warnings, await this.buildEnvDraftOnlyWarning(chatbotId, chatbot.prodVersionId)];
    }

    const laterVersionCount = await this.prisma.chatbotVersion.count({ where: { chatbotId, versionNo: { gt: versionRow.versionNo } } });

    return {
      targetVersion: { id: versionRow.id, versionNo: versionRow.versionNo, trigger: versionRow.trigger as never, createdAt: versionRow.createdAt, schemaVersion: versionRow.schemaVersion },
      currentContentHash: currentData.contentHash,
      targetContentHash,
      diffSummary: diffResult.summary,
      changesUndone: diffResult.summary.totalChanged,
      laterVersionCount,
      blockers,
      warnings,
      restorable: blockers.length === 0,
    };
  }

  /**
   * `invocation`(선택 4번째 인자, §9.2)이 있으면 예약 실행기(`deploy-schedules/executors/restore-version.executor.ts`)
   * 경유다 — 감사 주체를 `actorOverride`로 남기고 summary에 접두어를 붙이며, `BEFORE_RESTORE` 백업의
   * `createdBy*`도 예약자로 남긴다(타이머 경로에서 요청 컨텍스트가 없어 `null`이 되는 문제 방지).
   * 미지정(관리자 요청 핸들러 경로)이면 **바이트 단위로 기존과 동일**하다(AC-D5-4).
   */
  async restore(chatbotId: string, versionId: string, dto: RestoreRequestDto, invocation?: ScheduledInvocation): Promise<RestoreResponse> {
    const chatbot = await this.assertScope(chatbotId);
    if (chatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 복원할 수 없습니다.');
    if (chatbot.status === 'ACTIVE' && dto.acknowledgeActive !== true) {
      throw new ApiException('VALIDATION_FAILED', 400, '운영 중인 챗봇입니다. 영향을 확인했는지 체크해 주세요.', [
        { field: 'acknowledgeActive', message: '운영 중인 챗봇 복원 확인이 필요합니다.' },
      ]);
    }

    if (!this.restoreLock.tryAcquire(chatbotId)) {
      throw new ApiException('RESTORE_IN_PROGRESS', 409, '이미 이 챗봇에 대한 복원이 진행 중입니다.');
    }

    try {
      const versionRow = await this.prisma.chatbotVersion.findUnique({ where: { id: versionId } });
      if (!versionRow || versionRow.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

      const targetLoad = await this.payloadReader.loadStrict(versionId);

      // [신규 No.22 — §11.2] 대상 스냅샷을 현재 토픽 기준으로 정규화한다(트랜잭션 밖 준비 단계 —
      // 인증(확인 체크) 판정용. 실제 적용은 트랜잭션 안에서 **다시** 최신 토픽 집합으로 정규화한다).
      const topicRowsPre = await this.prisma.topic.findMany({ where: { chatbotId }, select: { id: true, enabled: true } });
      const normalizedPre = normalizeSnapshotTopics(targetLoad.envelope, new Set(topicRowsPre.map((t) => t.id)));

      const hydrated = hydrateSnapshot(normalizedPre.envelope, chatbotId);
      const { violations } = checkSnapshotIntegrity(hydrated, 'RESTORE');
      // §5.5 ⑤ / FR-H3-11 — DB 의존 검사라 순수 함수 밖에서 별도로 수행한다(L-1). 준비 단계(트랜잭션
      // 밖)에서 수행하며, 호출 자체는 tx가 아니므로 순차/병렬 제약(M-1)과 무관하다.
      const crossChatbotViolations = await findCrossChatbotIdConflicts(this.prisma, chatbotId, normalizedPre.envelope);
      const allViolations = [...violations, ...crossChatbotViolations];
      if (allViolations.length > 0) {
        throw new ApiException(
          'VERSION_INTEGRITY_FAILED',
          422,
          '대상 버전의 무결성 검사를 통과하지 못해 복원할 수 없습니다.',
          allViolations.slice(0, 100).map((v) => ({ field: v.id, message: v.rule })),
        );
      }
      const targetContentHash = normalizedPre.changed
        ? computeContentHash(normalizedPre.envelope)
        : targetLoad.upcastedFrom !== undefined
          ? computeContentHash(normalizedPre.envelope)
          : versionRow.contentHash;

      // [신규 No.22 — PM 확정 2026-09-25] 토픽 노출 변화(`TOPIC_EXPOSURE_CHANGE`)가 있는데
      // `acknowledgeTopicExposure`가 true가 아니면 복원을 거부한다(`acknowledgeActive`와 같은 패턴).
      const currentDataForGate = await this.versionCapture.captureSnapshotData(chatbotId);
      const exposureForGate = computeTopicExposureChange(topicRowsPre, currentDataForGate.envelope, normalizedPre.envelope);
      if ((exposureForGate.exposed > 0 || exposureForGate.hidden > 0) && dto.acknowledgeTopicExposure !== true) {
        throw new ApiException('VALIDATION_FAILED', 400, '토픽 노출이 바뀝니다. 영향을 확인했는지 체크해 주세요.', [
          { field: 'acknowledgeTopicExposure', message: '토픽 노출 변화 확인이 필요합니다.' },
        ]);
      }

      let backupVersionRow!: PrismaChatbotVersion;
      let summaryRows: ReturnType<typeof diffSnapshots>['summary']['rows'] = [];
      let reindexWasRunning = false;
      let classifierDeletedCount = 0;
      // [신규 No.22] 트랜잭션 안에서 재정규화한 최종 기대 해시(§11.2) — 사후 검증·응답이 이 값을 쓴다.
      let effectiveTargetHash = targetContentHash;

      try {
        await this.prisma.$transaction(
          async (tx) => {
            const freshChatbot = await tx.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true } });
            if (!freshChatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
            if (freshChatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 복원할 수 없습니다.');

            // ⚠ tx(인터랙티브 트랜잭션 클라이언트)는 단일 커넥션이다 — Promise.all 병렬 발행 금지
            // (설계서 §6.1). 두 count를 순차 await한다.
            const trainingJobCount = await tx.trainingJob.count({ where: { chatbotId, status: { in: ACTIVE_JOB_STATUSES } } });
            const testRunCount = await tx.testRun.count({ where: { chatbotId, status: { in: ACTIVE_JOB_STATUSES } } });
            if (trainingJobCount + testRunCount > 0) {
              throw new ApiException('RESTORE_BLOCKED_BY_ACTIVE_JOB', 409, '진행 중인 작업이 있어 복원할 수 없습니다.');
            }

            // [신규 No.22 — §11.2] 트랜잭션 안에서 대상 스냅샷을 **다시** 최신 토픽 집합으로 정규화한다
            // (권위 있는 적용본 — 준비 단계 이후 토픽이 바뀌었을 수 있다). tx는 단일 커넥션이므로 순차 조회.
            // [신규 — M-3 코드리뷰 대응] enabled도 함께 읽는다 — 노출 게이트 재확인에 필요하다.
            const topicRowsInTx = await tx.topic.findMany({ where: { chatbotId }, select: { id: true, enabled: true } });
            const normalizedInTx = normalizeSnapshotTopics(targetLoad.envelope, new Set(topicRowsInTx.map((t) => t.id)));
            const effectiveTargetEnvelope = normalizedInTx.envelope;
            effectiveTargetHash = normalizedInTx.changed
              ? computeContentHash(effectiveTargetEnvelope)
              : targetLoad.upcastedFrom !== undefined
                ? computeContentHash(effectiveTargetEnvelope)
                : versionRow.contentHash;

            const currentCaptured = await this.versionCapture.readConsistent(chatbotId, tx);
            const currentData = this.versionCapture.computeFromCaptured(currentCaptured, new Date());
            if (currentData.contentHash !== dto.expectedCurrentHash) {
              throw new ApiException('RESTORE_PREVIEW_STALE', 409, '미리보기 이후 자산이 변경되었습니다. 차이를 다시 확인해 주세요.');
            }
            if (currentData.contentHash === effectiveTargetHash) {
              throw new ApiException('RESTORE_NO_CHANGES', 409, '이미 해당 버전과 동일한 상태입니다.');
            }

            // [신규 — M-3 코드리뷰 대응 / §11.2 TOCTOU 재확인] 트랜잭션 안에서 노출 변화를 **다시**
            // 계산해 게이트를 재확인한다. 확인 시점(트랜잭션 밖 `exposureForGate`)과 값이 다르면(다른
            // 요청이 그 사이 토픽을 토글했거나 자산을 옮겼을 수 있다) 재시도를 유도하기 위해
            // `RESTORE_PREVIEW_STALE`로 거부한다 — 값이 같아 재확인 자체는 필요 없더라도, 노출 변화가
            // 있는데 확인 체크가 없으면 여전히 거부한다(단독 요청 경로에서도 동작해야 하는 1차 방어선).
            const exposureInTx = computeTopicExposureChange(topicRowsInTx, currentData.envelope, effectiveTargetEnvelope);
            if (exposureInTx.exposed !== exposureForGate.exposed || exposureInTx.hidden !== exposureForGate.hidden) {
              throw new ApiException('RESTORE_PREVIEW_STALE', 409, '미리보기 이후 자산이 변경되었습니다. 차이를 다시 확인해 주세요.');
            }
            if ((exposureInTx.exposed > 0 || exposureInTx.hidden > 0) && dto.acknowledgeTopicExposure !== true) {
              throw new ApiException('VALIDATION_FAILED', 400, '토픽 노출이 바뀝니다. 영향을 확인했는지 체크해 주세요.', [
                { field: 'acknowledgeTopicExposure', message: '토픽 노출 변화 확인이 필요합니다.' },
              ]);
            }

            // L-1 잔여 — 준비 단계(트랜잭션 밖)의 교차 챗봇 ID 검사와 쓰기 사이의 TOCTOU 창을 없앤다.
            // tx는 단일 커넥션이므로 순차 조회한다(§6.1, M-1과 동일한 이유).
            const crossChatbotViolationsInTx = await findCrossChatbotIdConflicts(tx, chatbotId, effectiveTargetEnvelope);
            if (crossChatbotViolationsInTx.length > 0) {
              throw new ApiException(
                'VERSION_INTEGRITY_FAILED',
                422,
                '대상 버전의 무결성 검사를 통과하지 못해 복원할 수 없습니다.',
                crossChatbotViolationsInTx.slice(0, 100).map((v) => ({ field: v.id, message: v.rule })),
              );
            }

            // BEFORE_RESTORE 백업 — 해시 동일 생략 규칙의 예외(항상 새 행). 크기 초과 시 예외가
            // 그대로 전파되어 트랜잭션이 롤백된다(fail-closed, FR-0-72).
            backupVersionRow = await this.versionCapture.persistWithin(tx, chatbotId, currentData, {
              trigger: 'BEFORE_RESTORE',
              restoredFromVersionId: versionRow.id,
              restoredFromVersionNo: versionRow.versionNo,
              actor: invocation?.actor?.id ? { id: invocation.actor.id, email: invocation.actor.email } : undefined,
              triggerContext: invocation?.triggerContext,
            });

            const plan = planRestore(currentData.envelope, effectiveTargetEnvelope);
            summaryRows = diffSnapshots(currentData.envelope, effectiveTargetEnvelope, currentData.integrityWarningCount, versionRow.integrityWarningCount).summary.rows;

            const applyResult = await this.applier.apply(tx, chatbotId, plan);
            classifierDeletedCount = applyResult.classifierDeletedCount;

            const afterCaptured = await this.versionCapture.readConsistent(chatbotId, tx);
            const afterData = this.versionCapture.computeFromCaptured(afterCaptured, new Date());
            if (afterData.contentHash !== effectiveTargetHash) {
              this.logger.warn(
                `복원 사후 검증 실패(전체 롤백): chatbotId=${chatbotId} expected=${effectiveTargetHash.slice(0, 8)} actual=${afterData.contentHash.slice(0, 8)}`,
              );
              throw new ApiException('INTERNAL_ERROR', 500, '복원 처리 중 내부 오류가 발생했습니다. 변경 사항이 저장되지 않았습니다.');
            }

            reindexWasRunning = this.reindexQueue.isRunning(chatbotId);
          },
          { timeout: this.versionCapture.txTimeoutMs(), maxWait: this.versionCapture.txTimeoutMs() },
        );
      } catch (e) {
        if (e instanceof ApiException) throw e;
        if (isBusyError(e)) {
          // §9.1 — BUSY 경합(재시도 가능)과 해시 불일치(재시도 무의미)를 코드로 분리한다.
          // 해시 불일치는 여전히 RESTORE_PREVIEW_STALE이다(위 트랜잭션 안 명시적 throw).
          throw new ApiException(
            'RESTORE_BUSY',
            409,
            '다른 변경과 동시에 처리되어 복원하지 못했습니다. 변경 사항은 저장되지 않았습니다. 잠시 후 다시 시도해 주세요.',
          );
        }
        throw e;
      }

      // 커밋 직후 — 동기, await 없이 연속 실행(단일 지점, 복제 금지)
      this.bundleService.invalidate(chatbotId);
      this.answerSettingsCache.invalidate(chatbotId);

      const summary: Record<VersionAssetKind, { added: number; removed: number; modified: number }> = {
        INTENT: { added: 0, removed: 0, modified: 0 },
        KEYWORD: { added: 0, removed: 0, modified: 0 },
        HOMONYM: { added: 0, removed: 0, modified: 0 },
        CONTEXT: { added: 0, removed: 0, modified: 0 },
        NODE: { added: 0, removed: 0, modified: 0 },
        FAQ: { added: 0, removed: 0, modified: 0 },
        ANSWER_SETTING: { added: 0, removed: 0, modified: 0 },
        PROFILE: { added: 0, removed: 0, modified: 0 },
      };
      for (const row of summaryRows) {
        if (row.kind === 'INTEGRITY_WARNING') continue;
        summary[row.kind] = { added: row.added, removed: row.removed, modified: row.modified };
      }
      // M-3: applier의 deleteMany 결과 count를 그대로 쓴다 — 분류기 행이 없던 챗봇은 false다.
      const classifierDeleted = classifierDeletedCount > 0;

      await this.auditLogService.record({
        action: 'RESTORE',
        targetType: 'Chatbot',
        targetId: chatbotId,
        targetName: chatbot.name,
        chatbotId,
        after: {
          fromVersionNo: versionRow.versionNo,
          backupVersionNo: backupVersionRow.versionNo,
          counts: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v])),
        },
        summary: `${invocation?.auditSummaryPrefix ?? ''}v${versionRow.versionNo}로 복원 (백업 v${backupVersionRow.versionNo})`,
        ...(invocation ? { actorOverride: invocation.actor } : {}),
      });

      await this.retention.pruneBestEffort(chatbotId, backupVersionRow.id);

      return {
        restoredFromVersionNo: versionRow.versionNo,
        backupVersionNo: backupVersionRow.versionNo,
        backupVersionId: backupVersionRow.id,
        contentHash: effectiveTargetHash,
        summary,
        reindexScheduled: true,
        reindexWasRunning,
        classifierDeleted,
        upcastedFromSchemaVersion: targetLoad.upcastedFrom,
      };
    } finally {
      this.restoreLock.release(chatbotId);
    }
  }
}
