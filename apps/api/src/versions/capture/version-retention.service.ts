import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatbotVersionTrigger } from '@chat-bot/shared-types';
import { DEPLOY_SCHEDULE_ACTIVE_STATUSES } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { EnvironmentCacheEvents } from '../../common/events/environment-cache.events';
import { selectVersionsToPrune } from '../lib/retention-policy';
import type { VersionMeta } from '../lib/retention-policy';
import { computeEnvironmentProtectedIds } from '../lib/environment-protected-versions';

const ENV_PROD_HISTORY_PROTECTED_DEFAULT = 5;

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
    // [신규 No.40 R1 — M-1] `versions → environment/** import 0`(§2.2)을 지키며 삭제된 버전을
    // `environment/serving`의 L1 캐시(`VersionBundleService.invalidateVersion`)에 알리는 전역 이벤트
    // 버스(`common/events` — environment 하위가 아니다, 방향 위반 아님).
    private readonly cacheEvents: EnvironmentCacheEvents,
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
      // [신규 No.40] 예약 참조 검사에 SWITCH_PROD_VERSION도 포함한다(§13.2 — 예약 참조 409가 먼저다).
      const refs = await tx.deploySchedule.findMany({
        where: { targetVersionId: versionId, action: { in: ['RESTORE_VERSION', 'SWITCH_PROD_VERSION'] }, status: { in: [...DEPLOY_SCHEDULE_ACTIVE_STATUSES] } },
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

      // [신규 No.40] §13.2 — 환경 포인터·운영 이력 보호 집합 검사(모드 꺼진 챗봇은 조회 1회 추가 후 null).
      const versionRow = await tx.chatbotVersion.findUnique({ where: { id: versionId }, select: { chatbotId: true } });
      if (versionRow) {
        const env = await tx.chatbotEnvironment.findUnique({ where: { chatbotId: versionRow.chatbotId }, select: { stagingVersionId: true } });
        if (env) {
          const chatbot = await tx.chatbot.findUnique({ where: { id: versionRow.chatbotId }, select: { prodVersionId: true } });
          const historyDesc = await tx.environmentSwitchLog.findMany({
            where: { chatbotId: versionRow.chatbotId, environment: 'PROD' },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { toVersionId: true },
          });
          const protectedIds = computeEnvironmentProtectedIds({
            prodVersionId: chatbot?.prodVersionId ?? null,
            stagingVersionId: env.stagingVersionId,
            prodHistoryDesc: historyDesc,
            historyN: this.config.get<number>('ENV_PROD_HISTORY_PROTECTED') ?? ENV_PROD_HISTORY_PROTECTED_DEFAULT,
          });
          if (protectedIds.has(versionId)) {
            const kind = chatbot?.prodVersionId === versionId ? 'PROD' : env.stagingVersionId === versionId ? 'STAGING' : 'PROD_HISTORY';
            throw new ApiException('VERSION_REFERENCED_BY_ENVIRONMENT', 409, '환경(운영/스테이징/운영 이력)이 참조하는 버전은 삭제할 수 없습니다.', [
              { field: 'environment', message: kind },
            ]);
          }
        }
      }

      await tx.chatbotVersionPayload.deleteMany({ where: { versionId } });
      await tx.chatbotVersion.delete({ where: { id: versionId } });
    });

    // [신규 No.40 R1 — M-1] 커밋 후 — `VersionBundleService`(environment/serving)의 L1 코어 캐시가
    // 이 versionId를 들고 있으면 지운다(§13.2 "삭제되면 L1 코어 항목을 제거한다"). 구독자가 없어도
    // (모드 미도입 배포 등) 안전하다 — `EventEmitter.emit()`은 리스너 0건이면 그냥 무시된다.
    this.cacheEvents.emitVersionDeleted(versionId);
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
          where: { chatbotId, action: { in: ['RESTORE_VERSION', 'SWITCH_PROD_VERSION'] }, status: { in: [...DEPLOY_SCHEDULE_ACTIVE_STATUSES] }, targetVersionId: { not: null } },
          select: { targetVersionId: true },
        });
        const externallyProtectedIds = new Set(refs.map((r) => r.targetVersionId!));

        // [신규 No.40] §13.2 — 환경 보호 집합을 추가한다(모드 꺼진 챗봇 = 조회 1회 후 null).
        const env = await tx.chatbotEnvironment.findUnique({ where: { chatbotId }, select: { stagingVersionId: true } });
        if (env) {
          const chatbot = await tx.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } });
          const historyDesc = await tx.environmentSwitchLog.findMany({
            where: { chatbotId, environment: 'PROD' },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { toVersionId: true },
          });
          const envProtected = computeEnvironmentProtectedIds({
            prodVersionId: chatbot?.prodVersionId ?? null,
            stagingVersionId: env.stagingVersionId,
            prodHistoryDesc: historyDesc,
            historyN: this.config.get<number>('ENV_PROD_HISTORY_PROTECTED') ?? ENV_PROD_HISTORY_PROTECTED_DEFAULT,
          });
          for (const id of envProtected) externallyProtectedIds.add(id);
        }

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
