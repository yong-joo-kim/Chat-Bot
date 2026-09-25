import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, ChatbotVersion as PrismaChatbotVersion } from '@prisma/client';
import type {
  AutoSnapshotOutcome,
  ChatbotVersionTrigger,
  CreateChatbotVersionResponse,
  FallbackPolicy,
  VersionCounts,
  VersionIntegrityWarning,
  VersionTriggerContext,
} from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { DialogueBundleService } from '../../dialogue-common/dialogue-bundle.service';
import { parseSkin } from '../../chatbots/lib/skin.util';
import { buildSnapshotEnvelope, computeVersionCounts } from '../lib/snapshot-envelope';
import type { CapturedAssets, SnapshotEnvelope } from '../lib/snapshot-envelope';
import { computeContentHash, computeTiebreakHash, serializeEnvelopeForStorage } from '../lib/snapshot-canonical';
import { hydrateSnapshot } from '../lib/snapshot-hydrate';
import { checkSnapshotIntegrity } from '../lib/snapshot-integrity';
import { toVersionDetailDto } from '../version.mapper';
import { VersionRetentionService } from './version-retention.service';

export interface CaptureSnapshotData {
  envelope: SnapshotEnvelope;
  contentHash: string;
  /** [신규 No.40] §6.1 — null = 보조 필드 없음(있을 수 없다, buildSnapshotEnvelope가 항상 채운다). */
  tiebreakHash: string | null;
  counts: VersionCounts;
  sizeBytes: number;
  integrityWarnings: VersionIntegrityWarning[];
  integrityWarningCount: number;
  serialized: string;
}

export interface PersistMeta {
  trigger: ChatbotVersionTrigger;
  triggerContext?: VersionTriggerContext;
  label?: string;
  memo?: string;
  restoredFromVersionId?: string;
  restoredFromVersionNo?: number;
  /** [신규 2026-09-23 No.28] 지정 시 `currentActorSnapshot()`(ALS) 대신 이 값을 쓴다 — 예약 실행기처럼
   * 요청 컨텍스트가 없는 경로에서 `BEFORE_RESTORE` 백업의 `createdBy*`가 `null`이 되지 않게 한다(§9.2). */
  actor?: { id: string; email: string };
}

/** 자동 스냅샷 5종 중 `MANUAL`·`BEFORE_RESTORE`를 제외한 나머지(§6.4 훅 8지점이 넘기는 트리거). */
export type AutoCaptureTrigger = Exclude<ChatbotVersionTrigger, 'MANUAL' | 'BEFORE_RESTORE'>;

/**
 * 캡처 모듈의 유일한 서비스(§2.1) — 일관 읽기 캡처 · 영속화(수동/자동/BEFORE_RESTORE 공용).
 * **대화 자산 쓰기 0건**(FR-0-69) — `ChatbotVersion`·`ChatbotVersionPayload`·`ChatbotVersionSequence`
 * 3테이블만 쓴다.
 */
@Injectable()
export class VersionCaptureService {
  private readonly logger = new Logger('VersionCaptureService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly bundleService: DialogueBundleService,
    private readonly auditLogService: AuditLogService,
    private readonly retention: VersionRetentionService,
  ) {}

  txTimeoutMs(): number {
    return this.config.get<number>('VERSION_TX_TIMEOUT_MS') ?? 30000;
  }

  private maxSnapshotBytes(): number {
    return this.config.get<number>('VERSION_SNAPSHOT_MAX_BYTES') ?? 20_971_520;
  }

  private autoSnapshotEnabled(): boolean {
    return this.config.get<boolean>('VERSION_AUTO_SNAPSHOT_ENABLED') ?? true;
  }

  /** §6.1 — 스냅샷 범위 전체를 하나의 인터랙티브 트랜잭션에서 일관되게 읽는다(FR-H1-6). */
  async readConsistent(chatbotId: string, tx: Prisma.TransactionClient): Promise<CapturedAssets> {
    const bundle = await this.bundleService.build(chatbotId, tx);
    const answerSettingRow = await tx.chatbotAnswerSetting.findUnique({ where: { chatbotId } });
    const chatbotRow = await tx.chatbot.findUnique({
      where: { id: chatbotId },
      select: { name: true, avatarUrl: true, description: true, skin: true },
    });
    if (!chatbotRow) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');

    const { skin } = parseSkin(chatbotRow.skin);

    return {
      chatbotId,
      bundle,
      answerSetting: answerSettingRow
        ? {
            chatbotId,
            semanticEnabled: answerSettingRow.semanticEnabled,
            acceptThreshold: answerSettingRow.acceptThreshold,
            lowThreshold: answerSettingRow.lowThreshold,
            marginThreshold: answerSettingRow.marginThreshold,
            ragEnabled: answerSettingRow.ragEnabled,
            ragCompany: answerSettingRow.ragCompany,
            ragCategory: answerSettingRow.ragCategory,
            ragSubcategory: answerSettingRow.ragSubcategory,
            ragSimilarityThreshold: answerSettingRow.ragSimilarityThreshold,
            fallbackPolicy: answerSettingRow.fallbackPolicy as FallbackPolicy,
            showSources: answerSettingRow.showSources,
            ragTimeoutMs: answerSettingRow.ragTimeoutMs,
            createdAt: answerSettingRow.createdAt,
            updatedAt: answerSettingRow.updatedAt,
          }
        : null,
      profile: {
        name: chatbotRow.name,
        avatarUrl: chatbotRow.avatarUrl,
        description: chatbotRow.description,
        skin,
      },
    };
  }

  /** 읽기 트랜잭션(§6.1) 밖에서 정규 직렬화·해시·건수·크기·무결성 경고를 계산한다(§6.2 ①②). 저장하지 않는다. */
  computeFromCaptured(captured: CapturedAssets, capturedAt: Date): CaptureSnapshotData {
    const envelope = buildSnapshotEnvelope(captured, capturedAt);
    const counts = computeVersionCounts(envelope);
    const contentHash = computeContentHash(envelope);
    const tiebreakHash = computeTiebreakHash(envelope);
    const serialized = serializeEnvelopeForStorage(envelope);
    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    const hydrated = hydrateSnapshot(envelope, captured.chatbotId);
    const { warnings, warningsTotal } = checkSnapshotIntegrity(hydrated, 'CAPTURE');
    return {
      envelope,
      contentHash,
      tiebreakHash,
      counts,
      sizeBytes,
      integrityWarnings: warnings,
      integrityWarningCount: warningsTotal,
      serialized,
    };
  }

  /** 읽기 트랜잭션을 직접 열어 계산까지 끝낸다(수동/자동 캡처, 복원 미리보기의 "현재" 계산 공용). */
  async captureSnapshotData(chatbotId: string): Promise<CaptureSnapshotData> {
    const captured = await this.prisma.$transaction((tx) => this.readConsistent(chatbotId, tx), {
      timeout: this.txTimeoutMs(),
      maxWait: this.txTimeoutMs(),
    });
    return this.computeFromCaptured(captured, new Date());
  }

  /**
   * 계산된 스냅샷을 호출자의 트랜잭션 안에서 영속화한다(§6.2 ④, §8.3 ⑧ BEFORE_RESTORE 백업 공용).
   * 크기 상한 초과 시 예외를 던진다 — 호출자의 트랜잭션이 그대로 롤백된다(BEFORE_RESTORE는 이 성질로
   * fail-closed가 된다, FR-0-72). 해시 동일 시 생략 판단은 **호출자**가 한다(BEFORE_RESTORE는 예외 없이
   * 항상 호출된다 — FR-H1-5 예외).
   */
  async persistWithin(tx: Prisma.TransactionClient, chatbotId: string, data: CaptureSnapshotData, meta: PersistMeta): Promise<PrismaChatbotVersion> {
    if (data.sizeBytes > this.maxSnapshotBytes()) {
      throw new ApiException(
        'VERSION_SNAPSHOT_TOO_LARGE',
        422,
        `스냅샷 크기가 상한(${Math.floor(this.maxSnapshotBytes() / (1024 * 1024))}MB)을 초과해 저장할 수 없습니다.`,
      );
    }

    const seq = await tx.chatbotVersionSequence.upsert({
      where: { chatbotId },
      create: { chatbotId, lastVersionNo: 1 },
      update: { lastVersionNo: { increment: 1 } },
    });
    const actor = meta.actor ?? this.auditLogService.currentActorSnapshot();

    const versionRow = await tx.chatbotVersion.create({
      data: {
        chatbotId,
        versionNo: seq.lastVersionNo,
        trigger: meta.trigger,
        triggerContext: meta.triggerContext ? JSON.stringify(meta.triggerContext) : null,
        schemaVersion: data.envelope.schemaVersion,
        contentHash: data.contentHash,
        tiebreakHash: data.tiebreakHash,
        counts: JSON.stringify(data.counts),
        sizeBytes: data.sizeBytes,
        integrityWarnings: JSON.stringify(data.integrityWarnings),
        integrityWarningCount: data.integrityWarningCount,
        label: meta.label ?? null,
        memo: meta.memo ?? null,
        restoredFromVersionId: meta.restoredFromVersionId ?? null,
        restoredFromVersionNo: meta.restoredFromVersionNo ?? null,
        createdById: actor?.id ?? null,
        createdByEmail: actor?.email ?? null,
      },
    });
    await tx.chatbotVersionPayload.create({ data: { versionId: versionRow.id, payload: data.serialized } });
    return versionRow;
  }

  /** 수동 저장(§6.2, FR-H4-2). 직전 버전과 해시가 같으면 생성하지 않는다(FR-H1-5). */
  async captureManual(chatbotId: string, dto: { label?: string; memo?: string }): Promise<CreateChatbotVersionResponse> {
    const data = await this.captureSnapshotData(chatbotId);

    type ManualOutcome = { kind: 'UNCHANGED'; latestVersionNo: number; latestVersionId: string } | { kind: 'CREATED'; row: PrismaChatbotVersion };

    const result = await this.prisma.$transaction<ManualOutcome>(
      async (tx) => {
        const latest = await tx.chatbotVersion.findFirst({
          where: { chatbotId },
          orderBy: { versionNo: 'desc' },
          select: { id: true, versionNo: true, contentHash: true },
        });
        if (latest && latest.contentHash === data.contentHash) {
          return { kind: 'UNCHANGED', latestVersionNo: latest.versionNo, latestVersionId: latest.id };
        }
        const row = await this.persistWithin(tx, chatbotId, data, { trigger: 'MANUAL', label: dto.label, memo: dto.memo });
        return { kind: 'CREATED', row };
      },
      { timeout: this.txTimeoutMs(), maxWait: this.txTimeoutMs() },
    );

    if (result.kind === 'UNCHANGED') {
      return { unchanged: true, latestVersionNo: result.latestVersionNo, latestVersionId: result.latestVersionId };
    }

    const created = result.row;
    await this.retention.pruneBestEffort(chatbotId, created.id);
    await this.auditLogService.record({
      action: 'CREATE',
      targetType: 'ChatbotVersion',
      targetId: created.id,
      targetName: dto.label ? `v${created.versionNo} · ${dto.label}` : `v${created.versionNo}`,
      chatbotId,
      after: {
        versionNo: created.versionNo,
        trigger: 'MANUAL',
        label: dto.label ?? null,
        memo: dto.memo ?? null,
        pinned: false,
        sizeBytes: data.sizeBytes,
      },
    });

    return { unchanged: false, version: toVersionDetailDto(created, 'OK') };
  }

  /**
   * 자동 스냅샷(§6.4 훅 8지점 중 5종, §6.5) — **절대 throw하지 않는다**(fail-open, P-4).
   * `VERSION_AUTO_SNAPSHOT_ENABLED=false`면 캡처 자체를 시도하지 않는다.
   */
  async captureAuto(chatbotId: string, trigger: AutoCaptureTrigger, triggerContext?: VersionTriggerContext): Promise<AutoSnapshotOutcome> {
    if (!this.autoSnapshotEnabled()) return { status: 'DISABLED' };

    try {
      const data = await this.captureSnapshotData(chatbotId);

      const outcome = await this.prisma.$transaction<AutoSnapshotOutcome>(
        async (tx) => {
          const latest = await tx.chatbotVersion.findFirst({
            where: { chatbotId },
            orderBy: { versionNo: 'desc' },
            select: { id: true, versionNo: true, contentHash: true },
          });
          if (latest && latest.contentHash === data.contentHash) {
            return { status: 'UNCHANGED', versionNo: latest.versionNo, versionId: latest.id };
          }
          const created = await this.persistWithin(tx, chatbotId, data, { trigger, triggerContext });
          return { status: 'CREATED', versionNo: created.versionNo, versionId: created.id };
        },
        { timeout: this.txTimeoutMs(), maxWait: this.txTimeoutMs() },
      );

      if (outcome.status === 'CREATED' && outcome.versionId) await this.retention.pruneBestEffort(chatbotId, outcome.versionId);
      return outcome;
    } catch (e) {
      this.logger.warn(
        `자동 스냅샷 생성 실패(fail-open — 본 동작은 계속 진행됨): chatbotId=${chatbotId} trigger=${trigger} error=${e instanceof Error ? e.message : 'unknown'}`,
      );
      return { status: 'FAILED' };
    }
  }
}
