import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PromoteToStagingDto, PromoteToStagingResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { isBusyError } from '../common/prisma/busy-error';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { VersionCaptureService } from '../versions/capture/version-capture.service';
import { VersionRetentionService } from '../versions/capture/version-retention.service';
import { VersionPayloadReader } from '../versions/read/version-payload.reader';
import { hydrateForServing } from '../versions/lib/snapshot-serving';
import { deriveSemanticSlots } from '../embedding/lib/semantic-slots';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { EmbeddingTextVectorService } from '../embedding/text-vector/embedding-text-vector.service';
import { EnvironmentPointerWriter } from './core/environment-pointer.writer';
import { decideEnvInitVersion } from './lib/enable-plan';

interface StagingVersionRow {
  id: string;
  versionNo: number;
  contentHash: string;
  tiebreakHash: string | null;
  createdAt: Date;
}

/**
 * [신규 No.40] 초안 → 스테이징 승격(§9.2). 자산 테이블 쓰기 0(FR-0-153) — 캡처·포인터만 쓴다.
 */
@Injectable()
export class StagingPromotionService {
  private readonly logger = new Logger('StagingPromotionService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly versionCapture: VersionCaptureService,
    private readonly versionRetention: VersionRetentionService,
    private readonly payloadReader: VersionPayloadReader,
    private readonly auditLogService: AuditLogService,
    private readonly writer: EnvironmentPointerWriter,
    private readonly embeddingProviderFactory: EmbeddingProviderFactory,
    private readonly textVectorService: EmbeddingTextVectorService,
  ) {}

  private txTimeoutMs(): number {
    return this.config.get<number>('VERSION_TX_TIMEOUT_MS') ?? 30000;
  }

  async promote(chatbotId: string, dto: PromoteToStagingDto): Promise<PromoteToStagingResponse> {
    type TxResult = { outcome: 'CREATED' | 'REUSED' | 'NOOP'; version: StagingVersionRow; previousStagingVersionNo: number | null };

    let result: TxResult;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          const chatbot = await tx.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true, prodVersionId: true } });
          if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
          if (chatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다.');
          if (!chatbot.prodVersionId) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');

          const env = await tx.chatbotEnvironment.findUnique({ where: { chatbotId } });
          if (!env) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');
          if (env.stagingVersionId !== dto.expectedStagingVersionId) {
            throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 스테이징 버전이 바뀌었습니다.');
          }

          const stagingVersion: StagingVersionRow | null = env.stagingVersionId
            ? await tx.chatbotVersion.findUnique({
                where: { id: env.stagingVersionId },
                select: { id: true, versionNo: true, contentHash: true, tiebreakHash: true, createdAt: true },
              })
            : null;

          const captured = await this.versionCapture.readConsistent(chatbotId, tx);
          const now = new Date();
          const data = this.versionCapture.computeFromCaptured(captured, now);

          if (stagingVersion && stagingVersion.contentHash === data.contentHash && stagingVersion.tiebreakHash === data.tiebreakHash) {
            return { outcome: 'NOOP' as const, version: stagingVersion, previousStagingVersionNo: stagingVersion.versionNo };
          }

          const latest = await tx.chatbotVersion.findFirst({
            where: { chatbotId },
            orderBy: { versionNo: 'desc' },
            select: { id: true, versionNo: true, contentHash: true, tiebreakHash: true },
          });
          const plan = decideEnvInitVersion({ latest, captured: { contentHash: data.contentHash, tiebreakHash: data.tiebreakHash } });

          let versionRow: StagingVersionRow;
          let outcome: 'CREATED' | 'REUSED';
          if (plan.action === 'REUSE') {
            const row = await tx.chatbotVersion.findUnique({
              where: { id: plan.versionId },
              select: { id: true, versionNo: true, contentHash: true, tiebreakHash: true, createdAt: true },
            });
            if (!row) throw new ApiException('INTERNAL_ERROR', 500, '버전을 찾을 수 없습니다.');
            versionRow = row;
            outcome = 'REUSED';
          } else {
            const created = await this.versionCapture.persistWithin(tx, chatbotId, data, { trigger: 'PROMOTE', label: dto.label, memo: dto.memo });
            versionRow = { id: created.id, versionNo: created.versionNo, contentHash: created.contentHash, tiebreakHash: created.tiebreakHash, createdAt: created.createdAt };
            outcome = 'CREATED';
          }

          const actor = this.auditLogService.currentActorSnapshot();
          const count = await this.writer.setStaging(tx, {
            chatbotId,
            expectedStagingVersionId: dto.expectedStagingVersionId,
            versionId: versionRow.id,
            versionNo: versionRow.versionNo,
            now,
            actor,
          });
          if (count === 0) throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 스테이징 버전이 바뀌었습니다.');

          return { outcome, version: versionRow, previousStagingVersionNo: stagingVersion?.versionNo ?? null };
        },
        { timeout: this.txTimeoutMs(), maxWait: this.txTimeoutMs() },
      );
    } catch (e) {
      if (e instanceof ApiException) throw e;
      if (isBusyError(e)) throw new ApiException('ENV_SWITCH_BUSY', 409, '다른 변경과 동시에 처리되어 승격할 수 없습니다.');
      throw e;
    }

    if (result.outcome === 'CREATED') {
      try {
        await this.versionRetention.pruneBestEffort(chatbotId, result.version.id);
      } catch {
        this.logger.warn(`승격 후 보존 정리 실패(흡수): chatbotId=${chatbotId}`);
      }
    }

    if (result.outcome !== 'NOOP') {
      try {
        const loaded = await this.payloadReader.loadStrict(result.version.id);
        const served = hydrateForServing(loaded.envelope, chatbotId);
        const slots = deriveSemanticSlots(served.bundle);
        const provider = await this.embeddingProviderFactory.getProvider();
        if (provider) await this.textVectorService.pin(chatbotId, provider.modelId, slots);
      } catch {
        this.logger.warn(`승격 후 벡터 보존 실패(흡수): chatbotId=${chatbotId}`);
      }

      await this.auditLogService.record({
        action: 'UPDATE',
        targetType: 'ChatbotEnvironment',
        targetId: chatbotId,
        chatbotId,
        before: { stagingVersionNo: result.previousStagingVersionNo },
        after: { stagingVersionNo: result.version.versionNo },
        summary: `스테이징 승격 v${result.previousStagingVersionNo ?? '?'} → v${result.version.versionNo}(${result.outcome === 'CREATED' ? '생성' : '재사용'})`,
      });
    }

    return {
      outcome: result.outcome,
      staging: { versionId: result.version.id, versionNo: result.version.versionNo, capturedAt: result.version.createdAt, label: dto.label ?? null },
      previousStagingVersionNo: result.previousStagingVersionNo,
    };
  }
}
