import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeploySchedule as PrismaDeploySchedule } from '@prisma/client';
import {
  DEPLOY_SCHEDULE_ACTIVE_STATUSES,
  DEPLOY_SCHEDULE_ATTENTION_STATUSES,
  DEPLOY_SCHEDULE_LIMITS,
} from '@chat-bot/shared-types';
import type {
  DeployScheduleDetail,
  DeployScheduleListItem,
  DeployScheduleListQuery,
  DeployScheduleMeta,
  DeployScheduleNotice,
  DeployScheduleStateCheck,
  DeployScheduleSummary,
  Paginated,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { CLOCK } from '../common/polling/clock';
import type { Clock } from '../common/polling/clock';
import { VersionCaptureService } from '../versions/capture/version-capture.service';
import { toDetail, toListItem } from './deploy-schedule.mapper';
import { ReadinessWarningsService } from './readiness/readiness-warnings.service';

const ACTIVE = [...DEPLOY_SCHEDULE_ACTIVE_STATUSES];
const ATTENTION = [...DEPLOY_SCHEDULE_ATTENTION_STATUSES];

/** [신규 2026-09-23 No.28] 읽기 전용 — 목록·상세·notice·summary·meta·state-check(§13). */
@Injectable()
export class DeployScheduleQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly versionCapture: VersionCaptureService,
    private readonly readiness: ReadinessWarningsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async findRowOrThrow(chatbotId: string, scheduleId: string): Promise<PrismaDeploySchedule> {
    const row = await this.prisma.deploySchedule.findUnique({ where: { id: scheduleId } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 예약을 찾을 수 없습니다.');
    return row;
  }

  async list(chatbotId: string | undefined, query: DeployScheduleListQuery): Promise<Paginated<DeployScheduleListItem>> {
    const where = {
      ...(chatbotId ? { chatbotId } : query.chatbotId ? { chatbotId: query.chatbotId } : {}),
      ...(query.status && query.status.length > 0 ? { status: { in: query.status } } : {}),
      ...(query.action && query.action.length > 0 ? { action: { in: query.action } } : {}),
      ...(query.from || query.to ? { scheduledAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } } : {}),
      ...(query.needsAttention ? { status: { in: ATTENTION }, acknowledgedAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.deploySchedule.findMany({
        where,
        orderBy: { scheduledAt: query.order },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.deploySchedule.count({ where }),
    ]);

    let names = new Map<string, string>();
    if (!chatbotId) {
      const chatbotIds = Array.from(new Set(rows.map((r) => r.chatbotId)));
      const chatbots = await this.prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true } });
      names = new Map(chatbots.map((c) => [c.id, c.name]));
    }

    return toPaginated(rows.map((r) => toListItem(r, chatbotId ? undefined : names.get(r.chatbotId))), total, query.page, query.pageSize);
  }

  async detail(chatbotId: string, scheduleId: string): Promise<DeployScheduleDetail> {
    const row = await this.findRowOrThrow(chatbotId, scheduleId);
    return this.buildDetail(row);
  }

  async buildDetail(row: PrismaDeploySchedule, chatbotName?: string): Promise<DeployScheduleDetail> {
    const [predecessorRow, heldByRow, backupRow] = await Promise.all([
      row.predecessorScheduleId
        ? this.prisma.deploySchedule.findUnique({ where: { id: row.predecessorScheduleId }, select: { id: true, scheduledAt: true, status: true, targetVersionNo: true } })
        : Promise.resolve(null),
      row.heldByScheduleId
        ? this.prisma.deploySchedule.findUnique({ where: { id: row.heldByScheduleId }, select: { id: true, scheduledAt: true, status: true, action: true } })
        : Promise.resolve(null),
      // targetVersionId는 RESTORE_VERSION만 채운다 — 동작 리터럴 대신 이 값으로 판별한다(§16 D-10).
      row.targetVersionId !== null && (row.outcome === 'APPLIED' || row.outcome === 'RECOVERED')
        ? this.prisma.chatbotVersion.findFirst({
            where: { chatbotId: row.chatbotId, trigger: 'BEFORE_RESTORE', restoredFromVersionId: row.targetVersionId ?? undefined },
            orderBy: { versionNo: 'desc' },
            select: { id: true, versionNo: true },
          })
        : Promise.resolve(null),
    ]);

    const earliestHeld = await this.prisma.deploySchedule.findFirst({
      where: { chatbotId: row.chatbotId, status: 'HELD', scheduledAt: { lt: row.scheduledAt } },
      orderBy: { scheduledAt: 'asc' },
      select: { id: true },
    });

    let readinessWarnings: DeployScheduleDetail['readinessWarnings'] = [];
    if (row.status === 'PENDING' || row.status === 'HELD') {
      const params = JSON.parse(row.params) as { enableWebChannel?: boolean };
      readinessWarnings = await this.readiness.compute({
        action: row.action as never,
        chatbotId: row.chatbotId,
        scheduledAt: row.scheduledAt,
        now: this.clock.now(),
        earlierHeldScheduleId: earliestHeld?.id,
        enableWebChannel: params.enableWebChannel,
      });
    }

    return toDetail(row, {
      chatbotName,
      predecessor: predecessorRow ? { id: predecessorRow.id, scheduledAt: predecessorRow.scheduledAt, status: predecessorRow.status as never, targetVersionNo: predecessorRow.targetVersionNo } : null,
      heldBy: heldByRow ? { id: heldByRow.id, scheduledAt: heldByRow.scheduledAt, status: heldByRow.status as never, action: heldByRow.action as never } : null,
      revert: backupRow ? { backupVersionId: backupRow.id, backupVersionNo: backupRow.versionNo } : null,
      readinessWarnings,
    });
  }

  async notice(chatbotId: string): Promise<DeployScheduleNotice> {
    const now = this.clock.now();
    const [activeCount, upcomingRestore] = await Promise.all([
      this.prisma.deploySchedule.count({ where: { chatbotId, status: { in: ACTIVE } } }),
      this.prisma.deploySchedule.findFirst({
        where: { chatbotId, action: 'RESTORE_VERSION', status: { in: ['PENDING', 'HELD'] } },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, scheduledAt: true, status: true, targetVersionNo: true, predecessorScheduleId: true },
      }),
    ]);
    void now;

    if (!upcomingRestore) return { upcomingRestore: null, activeCount };

    let chainLength = 1;
    let cursor = upcomingRestore.predecessorScheduleId;
    while (cursor) {
      chainLength += 1;
      const pred: { predecessorScheduleId: string | null } | null = await this.prisma.deploySchedule.findUnique({ where: { id: cursor }, select: { predecessorScheduleId: true } });
      cursor = pred?.predecessorScheduleId ?? null;
      if (chainLength > DEPLOY_SCHEDULE_LIMITS.maxActivePerChatbot + 1) break; // 안전장치
    }

    return {
      upcomingRestore: {
        scheduleId: upcomingRestore.id,
        scheduledAt: upcomingRestore.scheduledAt,
        status: upcomingRestore.status as 'PENDING' | 'HELD',
        targetVersionNo: upcomingRestore.targetVersionNo,
        chainLength,
      },
      activeCount,
    };
  }

  async summary(): Promise<DeployScheduleSummary> {
    const now = this.clock.now();
    const since = new Date(now.getTime() - 24 * 3_600_000);

    const attentionRows = await this.prisma.deploySchedule.groupBy({
      by: ['chatbotId'],
      where: { status: { in: ATTENTION }, acknowledgedAt: null },
      _count: { _all: true },
    });
    const chatbotIds = attentionRows.map((r) => r.chatbotId).slice(0, 100);
    const chatbots = await this.prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true } });
    const nameById = new Map(chatbots.map((c) => [c.id, c.name]));

    const [succeeded, failed, missed] = await Promise.all([
      this.prisma.deploySchedule.count({ where: { status: 'SUCCEEDED', finishedAt: { gte: since } } }),
      this.prisma.deploySchedule.count({ where: { status: 'FAILED', finishedAt: { gte: since } } }),
      this.prisma.deploySchedule.count({ where: { status: 'MISSED', finishedAt: { gte: since } } }),
    ]);

    return {
      needsAttention: {
        total: attentionRows.reduce((sum, r) => sum + r._count._all, 0),
        byChatbot: attentionRows
          .slice(0, 100)
          .map((r) => ({ chatbotId: r.chatbotId, chatbotName: nameById.get(r.chatbotId) ?? '', count: r._count._all }))
          .filter((r) => r.chatbotName !== ''),
      },
      last24h: { succeeded, failed, missed },
      generatedAt: now,
    };
  }

  async meta(): Promise<DeployScheduleMeta> {
    const now = this.clock.now();
    const timezone = this.config.get<string>('STATS_TIMEZONE') ?? 'Asia/Seoul';
    let timezoneFallback = false;
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      timezoneFallback = true;
    }

    const pollIntervalMs = this.config.get<number>('DEPLOY_SCHEDULE_POLL_INTERVAL_MS') ?? 30_000;
    const overdueThreshold = new Date(now.getTime() - (pollIntervalMs * 2 + 60_000));
    const overduePendingCount = await this.prisma.deploySchedule.count({
      where: { status: 'PENDING', attemptCount: 0, scheduledAt: { lt: overdueThreshold } },
    });

    return {
      timezone: timezoneFallback ? 'Asia/Seoul' : timezone,
      timezoneFallback,
      engine: {
        enabledOnThisInstance: this.config.get<boolean>('DEPLOY_SCHEDULE_ENABLED') ?? true,
        pollIntervalMs,
        misfireGraceMinutes: this.config.get<number>('DEPLOY_SCHEDULE_MISFIRE_GRACE_MINUTES') ?? 10,
        retryWindowMinutes: this.config.get<number>('DEPLOY_SCHEDULE_RETRY_WINDOW_MINUTES') ?? 15,
        leaseMinutes: this.config.get<number>('DEPLOY_SCHEDULE_LEASE_MINUTES') ?? 5,
        overduePendingCount,
      },
      limits: DEPLOY_SCHEDULE_LIMITS,
    };
  }

  async stateCheck(chatbotId: string, scheduleId: string): Promise<DeployScheduleStateCheck> {
    const row = await this.findRowOrThrow(chatbotId, scheduleId);
    const now = this.clock.now();
    // RESTORE_VERSION만 expectedContentHash(기준 해시 바인딩)를 갖는다 — 동작 리터럴 대신 이 값의
    // 존재로 적용 가능 여부를 판별한다(§16 D-10, 이 서비스는 분기 허용 파일 밖이다).
    if (row.expectedContentHash === null) {
      return { applicable: false, basis: 'CURRENT', matches: true, checkedAt: now };
    }

    let basis: 'CURRENT' | 'CHAIN_HEAD' = 'CURRENT';
    let headScheduleId: string | undefined;
    let cursor = row.predecessorScheduleId;
    let hops = 0;
    while (cursor) {
      basis = 'CHAIN_HEAD';
      headScheduleId = cursor;
      const pred: { predecessorScheduleId: string | null } | null = await this.prisma.deploySchedule.findUnique({ where: { id: cursor }, select: { predecessorScheduleId: true } });
      cursor = pred?.predecessorScheduleId ?? null;
      hops += 1;
      // notice()와 같은 상한(안전장치 — 순환·비정상 체인 방어, code-review 1라운드 L4).
      if (hops > DEPLOY_SCHEDULE_LIMITS.maxActivePerChatbot + 1) break;
    }

    const current = await this.versionCapture.captureSnapshotData(chatbotId);
    return {
      applicable: true,
      basis,
      headScheduleId,
      currentContentHash: current.contentHash,
      expectedContentHash: row.expectedContentHash ?? undefined,
      matches: current.contentHash === row.expectedContentHash,
      checkedAt: now,
    };
  }
}
