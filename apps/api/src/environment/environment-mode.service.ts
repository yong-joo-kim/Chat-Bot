import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  DisableEnvironmentDto,
  DisableEnvironmentPreviewResponse,
  EnableEnvironmentDto,
  EnableEnvironmentPreviewResponse,
  EnvironmentStatus,
  UpdateEnvironmentGateDto,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { isBusyError } from '../common/prisma/busy-error';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { VersionCaptureService } from '../versions/capture/version-capture.service';
import { VersionRetentionService } from '../versions/capture/version-retention.service';
import { VersionPayloadReader } from '../versions/read/version-payload.reader';
import { hydrateForServing, hasPotentialNodeTies } from '../versions/lib/snapshot-serving';
import { diffSnapshots } from '../versions/lib/version-diff';
import { deriveSemanticSlots } from '../embedding/lib/semantic-slots';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { EmbeddingTextVectorService } from '../embedding/text-vector/embedding-text-vector.service';
import { VersionVectorResolver } from '../embedding/version-vectors/version-vector.resolver';
import { RestoreLockRegistry } from '../versions/restore/restore-lock.registry';
import { EnvironmentPointerWriter } from './core/environment-pointer.writer';
import { EnvironmentReadService } from './core/environment-read.service';
import { VersionBundleService } from './serving/version-bundle.service';
import { EnvironmentScheduleHooks } from '../deploy-schedules/env-hooks/environment-schedule.hooks';
import { decideEnvInitVersion } from './lib/enable-plan';
import { decideDisable } from './lib/disable-plan';

/**
 * [신규 No.40] 켜기/끄기 미리보기·확정 · 게이트 설정(§5 · §10). 최상위 `environment/` 모듈 소속 —
 * `EnvironmentPointerWriter`는 `EnvironmentCoreModule`에서 export하지 않으므로 이 서비스 전용 인스턴스를
 * `environment.module.ts`가 별도로 제공한다(주입 경로는 core를 거치지 않는다).
 */
@Injectable()
export class EnvironmentModeService {
  private readonly logger = new Logger('EnvironmentModeService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly chatbotScope: ChatbotScopeService,
    private readonly versionCapture: VersionCaptureService,
    private readonly versionRetention: VersionRetentionService,
    private readonly payloadReader: VersionPayloadReader,
    private readonly auditLogService: AuditLogService,
    private readonly writer: EnvironmentPointerWriter,
    private readonly environmentRead: EnvironmentReadService,
    private readonly hooks: EnvironmentScheduleHooks,
    private readonly embeddingProviderFactory: EmbeddingProviderFactory,
    private readonly textVectorService: EmbeddingTextVectorService,
    private readonly versionVectorResolver: VersionVectorResolver,
    // [신규 No.40 R1 — M-2] `enable()` 진입부 잠금 검사(§5.3 ①) — `VersionRestoreService`와 같은
    // 인스턴스(`RestoreLockModule` 공유, `versions/restore/restore-lock.module.ts`).
    private readonly restoreLock: RestoreLockRegistry,
    // [신규 No.40 R1 — M-1] 끄기 커밋 후 L1/L2 캐시 제거(§5.4) — `environment`(top)는 `serving`을
    // import할 수 있으므로(§2.2) 직접 주입한다(core와 달리 이벤트가 필요 없다).
    private readonly versionBundles: VersionBundleService,
  ) {}

  private txTimeoutMs(): number {
    return this.config.get<number>('VERSION_TX_TIMEOUT_MS') ?? 30000;
  }

  async getStatus(chatbotId: string): Promise<EnvironmentStatus> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true, prodVersionId: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');

    const pointer = await this.environmentRead.getPointerStatus(chatbotId);
    if (!chatbot.prodVersionId) {
      const envRow = await this.prisma.chatbotEnvironment.findUnique({ where: { chatbotId }, select: { chatbotId: true } });
      return { enabled: false, gate: envRow ? pointer.gate : null };
    }

    const [prodRow, stagingRow, draft, activeSchedule] = await Promise.all([
      this.prisma.chatbotVersion.findUnique({ where: { id: chatbot.prodVersionId }, select: { id: true, versionNo: true, createdAt: true, label: true, contentHash: true } }),
      pointer.stagingVersionId
        ? this.prisma.chatbotVersion.findUnique({ where: { id: pointer.stagingVersionId }, select: { id: true, versionNo: true, createdAt: true, label: true, contentHash: true } })
        : Promise.resolve(null),
      this.versionCapture.captureSnapshotData(chatbotId),
      this.prisma.deploySchedule.findFirst({
        where: { chatbotId, action: 'SWITCH_PROD_VERSION', status: { in: ['PENDING', 'HELD'] } },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, targetVersionNo: true, status: true },
      }),
    ]);

    const provider = await this.embeddingProviderFactory.getProvider();

    const legacyTiebreakOf = async (versionId: string): Promise<{ legacyTiebreak: boolean; readFailed: boolean; semanticPending: number }> => {
      try {
        const loaded = await this.payloadReader.loadStrict(versionId);
        const served = hydrateForServing(loaded.envelope, chatbotId);
        const slots = deriveSemanticSlots(served.bundle);
        let semanticPending = slots.length;
        if (provider) {
          const resolution = await this.versionVectorResolver.resolve(chatbotId, provider.modelId, slots);
          semanticPending = resolution.missing;
        }
        return { legacyTiebreak: served.legacyTiebreak, readFailed: false, semanticPending };
      } catch {
        return { legacyTiebreak: false, readFailed: true, semanticPending: 0 };
      }
    };

    const prodExtra = await legacyTiebreakOf(chatbot.prodVersionId);
    const stagingExtra = stagingRow ? await legacyTiebreakOf(stagingRow.id) : null;

    return {
      enabled: true,
      enabledAt: pointer.enabledAt ?? new Date(0),
      prod: {
        versionId: chatbot.prodVersionId,
        versionNo: prodRow?.versionNo ?? 0,
        capturedAt: prodRow?.createdAt ?? new Date(0),
        label: prodRow?.label ?? null,
        switchedAt: pointer.enabledAt ?? new Date(0),
        legacyTiebreak: prodExtra.legacyTiebreak,
        readFailed: prodExtra.readFailed,
        semanticPending: prodExtra.semanticPending,
      },
      staging: stagingRow
        ? {
            versionId: stagingRow.id,
            versionNo: stagingRow.versionNo,
            capturedAt: stagingRow.createdAt,
            label: stagingRow.label ?? null,
            legacyTiebreak: stagingExtra?.legacyTiebreak ?? false,
            semanticPending: stagingExtra?.semanticPending ?? 0,
          }
        : null,
      draft: {
        contentHash: draft.contentHash,
        sameAsProd: prodRow ? draft.contentHash === prodRow.contentHash : false,
        sameAsStaging: stagingRow ? draft.contentHash === stagingRow.contentHash : false,
      },
      gate: pointer.gate,
      activeSwitchSchedule: activeSchedule
        ? { scheduleId: activeSchedule.id, scheduledAt: activeSchedule.scheduledAt, targetVersionNo: activeSchedule.targetVersionNo ?? 0, status: activeSchedule.status as 'PENDING' | 'HELD' }
        : null,
    };
  }

  async enablePreview(chatbotId: string): Promise<EnableEnvironmentPreviewResponse> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true, prodVersionId: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');

    const blockers: EnableEnvironmentPreviewResponse['blockers'] = [];
    if (chatbot.status === 'ARCHIVED') blockers.push('CHATBOT_ARCHIVED');
    if (chatbot.prodVersionId) blockers.push('ALREADY_ENABLED');
    const running = await this.prisma.deploySchedule.count({ where: { chatbotId, status: 'RUNNING' } });
    if (running > 0) blockers.push('SCHEDULE_RUNNING');

    const data = await this.versionCapture.captureSnapshotData(chatbotId);
    const latest = await this.prisma.chatbotVersion.findFirst({
      where: { chatbotId },
      orderBy: { versionNo: 'desc' },
      select: { id: true, versionNo: true, contentHash: true, tiebreakHash: true },
    });
    const plan = decideEnvInitVersion({ latest, captured: { contentHash: data.contentHash, tiebreakHash: data.tiebreakHash } });
    const heldRestoreSchedules = await this.prisma.deploySchedule.count({ where: { chatbotId, action: 'RESTORE_VERSION', status: 'PENDING' } });

    return {
      draftContentHash: data.contentHash,
      version: plan.action === 'REUSE' ? { action: 'REUSE', versionId: plan.versionId, versionNo: plan.versionNo } : { action: 'CREATE' },
      heldRestoreSchedules,
      blockers,
    };
  }

  async enable(chatbotId: string, dto: EnableEnvironmentDto): Promise<EnvironmentStatus & { heldRestoreSchedules: number }> {
    await this.chatbotScope.assertWritable(chatbotId);
    // [신규 No.40 R1 — M-2] §5.3 ① — 복원 진행 중(잠금 획득 상태)이면 켜기를 거부한다(같은 챗봇의
    // 캡처·포인터 쓰기가 복원과 경합하지 않도록 — RESTORE_BUSY 선례와 같은 "빠른 실패" 성질).
    if (this.restoreLock.isLocked(chatbotId)) {
      throw new ApiException('ENV_SWITCH_BUSY', 409, '복원이 진행 중이어서 켤 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
    const running = await this.prisma.deploySchedule.count({ where: { chatbotId, status: 'RUNNING' } });
    if (running > 0) throw new ApiException('ENV_SWITCH_BUSY', 409, '진행 중인 예약이 있어 켤 수 없습니다. 잠시 후 다시 시도해 주세요.');

    let heldRestoreSchedules = 0;
    let versionId = '';
    let versionNo = 0;
    let createdNew = false;

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const chatbot = await tx.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true, prodVersionId: true } });
          if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
          if (chatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다.');
          if (chatbot.prodVersionId) throw new ApiException('ENV_MODE_ALREADY_ENABLED', 409, '이미 환경 분리 모드가 켜져 있습니다.');

          const captured = await this.versionCapture.readConsistent(chatbotId, tx);
          const now = new Date();
          const data = this.versionCapture.computeFromCaptured(captured, now);
          if (data.contentHash !== dto.expectedDraftHash) {
            throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 초안이 바뀌었습니다. 다시 확인해 주세요.');
          }

          const latest = await tx.chatbotVersion.findFirst({
            where: { chatbotId },
            orderBy: { versionNo: 'desc' },
            select: { id: true, versionNo: true, contentHash: true, tiebreakHash: true },
          });
          const plan = decideEnvInitVersion({ latest, captured: { contentHash: data.contentHash, tiebreakHash: data.tiebreakHash } });

          let versionRow;
          let created = false;
          if (plan.action === 'REUSE') {
            versionRow = await tx.chatbotVersion.findUnique({ where: { id: plan.versionId } });
            if (!versionRow) throw new ApiException('INTERNAL_ERROR', 500, '버전을 찾을 수 없습니다.');
          } else {
            versionRow = await this.versionCapture.persistWithin(tx, chatbotId, data, { trigger: 'ENV_INIT' });
            created = true;
          }

          const actor = this.auditLogService.currentActorSnapshot();
          const count = await this.writer.enable(tx, {
            chatbotId,
            versionId: versionRow.id,
            versionNo: versionRow.versionNo,
            versionCreatedAt: versionRow.createdAt,
            now,
            actor,
            reason: dto.reason,
          });
          if (count === 0) throw new ApiException('ENV_MODE_ALREADY_ENABLED', 409, '이미 환경 분리 모드가 켜져 있습니다.');

          const held = await this.hooks.holdRestoreForEnvModeChange(tx, chatbotId, now);

          return { versionRow, created, held };
        },
        { timeout: this.txTimeoutMs(), maxWait: this.txTimeoutMs() },
      );
      versionId = result.versionRow.id;
      versionNo = result.versionRow.versionNo;
      createdNew = result.created;
      heldRestoreSchedules = result.held;
    } catch (e) {
      if (e instanceof ApiException) throw e;
      if (isBusyError(e)) throw new ApiException('ENV_SWITCH_BUSY', 409, '다른 변경과 동시에 처리되어 켤 수 없습니다. 잠시 후 다시 시도해 주세요.');
      throw e;
    }

    // 커밋 후(fire-and-forget 성격 — 실패해도 켜기 자체는 성공).
    try {
      if (createdNew) await this.versionRetention.pruneBestEffort(chatbotId, versionId);
    } catch {
      this.logger.warn(`켜기 후 보존 정리 실패(흡수): chatbotId=${chatbotId}`);
    }
    try {
      const loaded = await this.payloadReader.loadStrict(versionId);
      const served = hydrateForServing(loaded.envelope, chatbotId);
      const slots = deriveSemanticSlots(served.bundle);
      const provider = await this.embeddingProviderFactory.getProvider();
      if (provider) await this.textVectorService.pin(chatbotId, provider.modelId, slots);
    } catch {
      this.logger.warn(`켜기 후 벡터 보존 실패(흡수): chatbotId=${chatbotId}`);
    }

    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'ChatbotEnvironment',
      targetId: chatbotId,
      chatbotId,
      before: { enabled: false },
      after: { enabled: true, prodVersionNo: versionNo, stagingVersionNo: versionNo },
      summary: `환경 분리 시작 v${versionNo} · 보류 예약 ${heldRestoreSchedules}건`,
    });

    const status = await this.getStatus(chatbotId);
    return { ...(status as EnvironmentStatus), heldRestoreSchedules };
  }

  async disablePreview(chatbotId: string): Promise<DisableEnvironmentPreviewResponse> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } });
    if (!chatbot?.prodVersionId) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');

    const [prodRow, draft] = await Promise.all([
      this.prisma.chatbotVersion.findUnique({ where: { id: chatbot.prodVersionId }, select: { id: true, versionNo: true, createdAt: true, label: true, contentHash: true } }),
      this.versionCapture.captureSnapshotData(chatbotId),
    ]);
    if (!prodRow) throw new ApiException('INTERNAL_ERROR', 500, '운영 버전을 찾을 수 없습니다.');

    const prodLoaded = await this.payloadReader.loadStrict(chatbot.prodVersionId);
    const diff = diffSnapshots(prodLoaded.envelope, draft.envelope, 0, 0);
    const prodServed = hydrateForServing(prodLoaded.envelope, chatbotId);

    const cancellable = await this.prisma.deploySchedule.count({ where: { chatbotId, action: 'SWITCH_PROD_VERSION', status: { in: ['PENDING', 'HELD'] } } });

    return {
      prod: { versionId: prodRow.id, versionNo: prodRow.versionNo, capturedAt: prodRow.createdAt, label: prodRow.label ?? null },
      draftContentHash: draft.contentHash,
      prodContentHash: prodRow.contentHash,
      draftDiffersFromProd: !diff.summary.identical,
      diffSummary: diff.summary,
      cancelledSwitchSchedules: cancellable,
      potentialTieShift: hasPotentialNodeTies(prodServed.bundle.dialogNodes),
    };
  }

  async disable(chatbotId: string, dto: DisableEnvironmentDto): Promise<EnvironmentStatus & { cancelledSwitchSchedules: number }> {
    await this.chatbotScope.assertWritable(chatbotId);
    const running = await this.prisma.deploySchedule.count({ where: { chatbotId, status: 'RUNNING' } });
    if (running > 0) throw new ApiException('ENV_SWITCH_BUSY', 409, '진행 중인 예약이 있어 끌 수 없습니다.');

    let cancelledSwitchSchedules = 0;
    try {
      cancelledSwitchSchedules = await this.prisma.$transaction(
        async (tx) => {
          const chatbot = await tx.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } });
          if (!chatbot?.prodVersionId) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');
          if (chatbot.prodVersionId !== dto.expectedProdVersionId) throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 운영 버전이 바뀌었습니다.');

          const captured = await this.versionCapture.readConsistent(chatbotId, tx);
          const now = new Date();
          const data = this.versionCapture.computeFromCaptured(captured, now);
          if (data.contentHash !== dto.expectedDraftHash) throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 초안이 바뀌었습니다.');

          const prodRow = await tx.chatbotVersion.findUnique({ where: { id: chatbot.prodVersionId }, select: { contentHash: true } });
          const decision = decideDisable({ mode: dto.mode, draftContentHash: data.contentHash, prodContentHash: prodRow?.contentHash ?? '' });
          if (decision === 'NEED_RESTORE') {
            throw new ApiException('ENV_DRAFT_NOT_RESTORED', 409, '초안이 운영 버전과 다릅니다. 먼저 운영 버전으로 복원한 뒤 다시 시도해 주세요.');
          }

          const actor = this.auditLogService.currentActorSnapshot();
          const count = await this.writer.disable(tx, { chatbotId, expectedProdVersionId: dto.expectedProdVersionId, mode: dto.mode, now, actor, reason: dto.reason });
          if (count === 0) throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 운영 버전이 바뀌었습니다.');

          return this.hooks.cancelSwitchForEnvDisable(tx, chatbotId, actor, now);
        },
        { timeout: this.txTimeoutMs(), maxWait: this.txTimeoutMs() },
      );
    } catch (e) {
      if (e instanceof ApiException) throw e;
      if (isBusyError(e)) throw new ApiException('ENV_SWITCH_BUSY', 409, '다른 변경과 동시에 처리되어 끌 수 없습니다.');
      throw e;
    }

    // [신규 No.40 R1 — M-1] §5.4 "L1/L2 캐시 해당 챗봇 제거" — 모드 꺼진 챗봇이 이전 운영 버전의
    // 캐시 항목을 들고 있지 않게 한다(직접 호출 — 실패해도 끄기 자체는 성공해야 하므로 흡수하지 않고
    // 동기 호출만 한다, 실패 가능성 없음).
    this.versionBundles.invalidateChatbot(chatbotId);

    try {
      await this.textVectorService.purgeChatbot(chatbotId);
    } catch {
      this.logger.warn(`끄기 후 벡터 보존 저장소 정리 실패(흡수): chatbotId=${chatbotId}`);
    }

    await this.auditLogService.record({
      action: 'STATUS_CHANGE',
      targetType: 'ChatbotEnvironment',
      targetId: chatbotId,
      chatbotId,
      before: { enabled: true },
      after: { enabled: false },
      summary: `환경 분리 종료(${dto.mode === 'KEEP_PROD' ? '운영 유지' : '초안을 운영으로'}) · 취소 예약 ${cancelledSwitchSchedules}건`,
    });

    const status = await this.getStatus(chatbotId);
    return { ...(status as EnvironmentStatus), cancelledSwitchSchedules };
  }

  async updateGate(chatbotId: string, dto: UpdateEnvironmentGateDto): Promise<UpdateEnvironmentGateDto> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');

    const before = await this.environmentRead.getPointerStatus(chatbotId);
    await this.writer.updateGate(chatbotId, dto);
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'ChatbotEnvironment',
      targetId: chatbotId,
      chatbotId,
      before: { gateMode: before.gate.mode, gateTestSetId: before.gate.testSetId, gateMinPassRate: before.gate.minPassRate, gateValidHours: before.gate.validHours },
      after: { gateMode: dto.mode, gateTestSetId: dto.testSetId, gateMinPassRate: dto.minPassRate, gateValidHours: dto.validHours },
    });
    return dto;
  }
}
