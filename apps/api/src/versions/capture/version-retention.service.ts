import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatbotVersionTrigger } from '@chat-bot/shared-types';
import { DEPLOY_SCHEDULE_ACTIVE_STATUSES } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { selectVersionsToPrune } from '../lib/retention-policy';
import type { VersionMeta } from '../lib/retention-policy';

/**
 * 보존 정리(§6.6, FR-H1-16/18/19) — 새 스냅샷 생성 **직후** 같은 요청 안에서 호출한다(스케줄러 없음).
 * best-effort — 실패는 흡수하고 경고 로그만 남긴다(다음 생성 때 다시 시도된다). 정리는 감사하지
 * 않는다(FR-H3-18).
 */
@Injectable()
export class VersionRetentionService {
  private readonly logger = new Logger('VersionRetentionService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private policy() {
    return {
      retentionAuto: this.config.get<number>('VERSION_RETENTION_AUTO') ?? 30,
      retentionManual: this.config.get<number>('VERSION_RETENTION_MANUAL') ?? 30,
      totalMaxBytes: this.config.get<number>('VERSION_TOTAL_MAX_BYTES_PER_CHATBOT') ?? 314572800,
    };
  }

  /**
   * [신규 2026-09-23 No.25] 수동 단건 삭제(§10.1 `DELETE .../versions/:versionId`) — `version.service.ts`가
   * `chatbotVersionPayload`를 직접 참조하지 않도록(§16 V-7) 이 서비스가 대신 지운다.
   *
   * [신규 2026-09-23 No.28] §9.3 — 활성(`PENDING`/`HELD`/`RUNNING`) 운영 예약 배포가 이 버전을
   * 대상으로 하면 삭제를 거부한다(`409 VERSION_REFERENCED_BY_SCHEDULE`). 조회·삭제를 한 트랜잭션으로
   * 묶어 "참조가 생긴 직후 버전이 사라지는" 경합 창을 없앤다(SQLite 직렬화, FR-D4-2(상태 변경)).
   */
  async deleteOne(versionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const refs = await tx.deploySchedule.findMany({
        where: { targetVersionId: versionId, status: { in: [...DEPLOY_SCHEDULE_ACTIVE_STATUSES] } },
        select: { id: true, scheduledAt: true },
        orderBy: { scheduledAt: 'asc' },
        take: 10,
      });
      if (refs.length > 0) {
        throw new ApiException(
          'VERSION_REFERENCED_BY_SCHEDULE',
          409,
          '이 버전을 대상으로 한 예약이 있어 삭제할 수 없습니다. 예약을 먼저 취소해 주세요.',
          refs.map((r) => ({ field: r.id, message: r.scheduledAt.toISOString() })),
        );
      }
      await tx.chatbotVersionPayload.deleteMany({ where: { versionId } });
      await tx.chatbotVersion.delete({ where: { id: versionId } });
    });
  }

  /**
   * [신규 2026-09-23 No.28] §9.3 — 읽기(메타 + 활성 예약 참조) + 선정 + 삭제를 한 트랜잭션으로 묶는다.
   * best-effort 성질은 불변이다(예외는 흡수하고 경고 로그만 — 다음 생성 때 다시 시도된다).
   */
  async pruneBestEffort(chatbotId: string, justCreatedId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.chatbotVersion.findMany({
          where: { chatbotId },
          select: { id: true, trigger: true, versionNo: true, pinned: true, sizeBytes: true },
        });
        const metas: VersionMeta[] = rows.map((r) => ({
          id: r.id,
          trigger: r.trigger as ChatbotVersionTrigger,
          versionNo: r.versionNo,
          pinned: r.pinned,
          sizeBytes: r.sizeBytes,
        }));

        const refs = await tx.deploySchedule.findMany({
          where: { chatbotId, action: 'RESTORE_VERSION', status: { in: [...DEPLOY_SCHEDULE_ACTIVE_STATUSES] }, targetVersionId: { not: null } },
          select: { targetVersionId: true },
        });
        const externallyProtectedIds = new Set(refs.map((r) => r.targetVersionId!));

        const result = selectVersionsToPrune(metas, this.policy(), justCreatedId, externallyProtectedIds);
        if (result.pruneIds.length === 0) return;

        await tx.chatbotVersionPayload.deleteMany({ where: { versionId: { in: result.pruneIds } } });
        await tx.chatbotVersion.deleteMany({ where: { id: { in: result.pruneIds } } });

        if (result.stillOverLimit) {
          this.logger.warn(`챗봇 ${chatbotId}의 버전 총량이 정리 후에도 상한을 초과합니다(고정 버전만 남음).`);
        }
      });
    } catch (e) {
      this.logger.warn(`버전 보존 정리 실패(best-effort): chatbotId=${chatbotId} error=${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
