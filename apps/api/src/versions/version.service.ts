import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChatbotVersionDetail,
  ChatbotVersionListItem,
  ChatbotVersionListQuery,
  ChatbotVersionTrigger,
  CreateChatbotVersionDto,
  CreateChatbotVersionResponse,
  Paginated,
  UpdateChatbotVersionDto,
  VersionAuditCount,
  VersionContentPage,
  VersionContentQuery,
  VersionCurrentStatus,
} from '@chat-bot/shared-types';
import { VERSION_TRIGGER_GROUPS, redactLegacyApiOutputs, deriveEnvironmentBadges } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { VersionCaptureService } from './capture/version-capture.service';
import { VersionRetentionService } from './capture/version-retention.service';
import { VersionPayloadReader } from './read/version-payload.reader';
import { hydrateSnapshot } from './lib/snapshot-hydrate';
import { diffSnapshots } from './lib/version-diff';
import type { SnapshotEnvelope } from './lib/snapshot-envelope';
import { toVersionDetailDto, toVersionListItemDto } from './version.mapper';

const NOT_FOUND_MESSAGE = '요청하신 버전을 찾을 수 없습니다.';

/** 목록·상세·현재상태·라벨/메모/고정·삭제 + `AuditLog` 기록 지점 — **payload 미접근**(§16 V-7). */
@Injectable()
export class VersionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly config: ConfigService,
    private readonly versionCapture: VersionCaptureService,
    private readonly retention: VersionRetentionService,
    private readonly payloadReader: VersionPayloadReader,
    private readonly auditLogService: AuditLogService,
  ) {}

  private pinnedMax(): number {
    return this.config.get<number>('VERSION_PINNED_MAX') ?? 10;
  }

  /** [신규 No.40 — §13.3] 모드 켜짐일 때만(2쿼리 추가) 환경 배지 판정 입력을 모은다. */
  private async loadBadgeContext(chatbotId: string, prodVersionId: string): Promise<{ prodVersionId: string; stagingVersionId: string | null; prodHistoryIds: ReadonlySet<string> }> {
    const [env, historyDesc] = await Promise.all([
      this.prisma.chatbotEnvironment.findUnique({ where: { chatbotId }, select: { stagingVersionId: true } }),
      this.prisma.environmentSwitchLog.findMany({
        where: { chatbotId, environment: 'PROD' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { toVersionId: true },
      }),
    ]);
    const prodHistoryIds = new Set(historyDesc.map((h) => h.toVersionId).filter((v): v is string => !!v));
    return { prodVersionId, stagingVersionId: env?.stagingVersionId ?? null, prodHistoryIds };
  }

  async list(chatbotId: string, query: ChatbotVersionListQuery): Promise<Paginated<ChatbotVersionListItem>> {
    const { prodVersionId } = await this.scope.assertReadable(chatbotId);

    const triggers = query.triggerGroup?.flatMap((g) => VERSION_TRIGGER_GROUPS[g]) as ChatbotVersionTrigger[] | undefined;

    const where = {
      chatbotId,
      ...(triggers && triggers.length > 0 ? { trigger: { in: triggers } } : {}),
      ...(query.pinned !== undefined ? { pinned: query.pinned } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.chatbotVersion.findMany({
        where,
        orderBy: { versionNo: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.chatbotVersion.count({ where }),
    ]);

    const items = rows.map(toVersionListItemDto);
    if (prodVersionId) {
      const badgeCtx = await this.loadBadgeContext(chatbotId, prodVersionId);
      for (const item of items) {
        const badges = deriveEnvironmentBadges(item.id, badgeCtx);
        if (badges.length > 0) item.environmentBadges = badges;
      }
    }

    return toPaginated(items, total, query.page, query.pageSize);
  }

  async current(chatbotId: string): Promise<VersionCurrentStatus> {
    const { prodVersionId } = await this.scope.assertReadable(chatbotId);
    const data = await this.versionCapture.captureSnapshotData(chatbotId);
    const latestRow = await this.prisma.chatbotVersion.findFirst({ where: { chatbotId }, orderBy: { versionNo: 'desc' } });
    const latestVersion = latestRow ? toVersionListItemDto(latestRow) : null;
    const stagingDiff = prodVersionId ? await this.loadStagingDiff(chatbotId, data) : undefined;
    return {
      contentHash: data.contentHash,
      counts: data.counts,
      latestVersion,
      hasUnsavedChanges: latestVersion === null || latestVersion.contentHash !== data.contentHash,
      ...(stagingDiff ? { stagingDiff } : {}),
    };
  }

  /**
   * [신규 No.40 — ui-spec §4.5] 모드 켜짐일 때만(추가 쿼리 1~2 + 스테이징이 초안과 다를 때만 본문
   * 읽기 1회) "지금 스테이징 → 지금 초안" 변경 요약을 계산한다. 스테이징이 없거나 초안과 이미
   * 같으면(대개 승격 직후) 본문을 읽지 않는다. 본문 읽기 실패는 흡수한다(가용성 우선 — `current()`는
   * payload 오류로 실패하지 않는다, §16 V-7 payload 미접근 원칙과 별개로 이 지점은 예외적으로
   * `VersionPayloadReader`를 거친다 — `detail()`의 `loadForContent` 선례와 같다).
   */
  private async loadStagingDiff(chatbotId: string, draft: { envelope: SnapshotEnvelope; contentHash: string; integrityWarningCount: number }) {
    const env = await this.prisma.chatbotEnvironment.findUnique({ where: { chatbotId }, select: { stagingVersionId: true } });
    if (!env?.stagingVersionId) return undefined;
    const stagingRow = await this.prisma.chatbotVersion.findUnique({ where: { id: env.stagingVersionId }, select: { contentHash: true, integrityWarningCount: true } });
    if (!stagingRow || stagingRow.contentHash === draft.contentHash) return undefined;
    try {
      const loaded = await this.payloadReader.loadStrict(env.stagingVersionId);
      return diffSnapshots(loaded.envelope, draft.envelope, stagingRow.integrityWarningCount, draft.integrityWarningCount).summary;
    } catch {
      return undefined;
    }
  }

  private async findRowOrThrow(chatbotId: string, versionId: string) {
    const row = await this.prisma.chatbotVersion.findUnique({ where: { id: versionId } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async detail(chatbotId: string, versionId: string): Promise<ChatbotVersionDetail> {
    const { prodVersionId } = await this.scope.assertReadable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, versionId);

    let payloadStatus: 'OK' | 'CORRUPT' | 'SCHEMA_UNSUPPORTED' = 'OK';
    try {
      const loaded = await this.payloadReader.loadForContent(versionId);
      payloadStatus = loaded.schemaSupported ? 'OK' : 'SCHEMA_UNSUPPORTED';
    } catch {
      payloadStatus = 'CORRUPT';
    }

    const dto = toVersionDetailDto(row, payloadStatus);
    if (prodVersionId) {
      const badgeCtx = await this.loadBadgeContext(chatbotId, prodVersionId);
      const badges = deriveEnvironmentBadges(row.id, badgeCtx);
      if (badges.length > 0) dto.environmentBadges = badges;
    }
    return dto;
  }

  async create(chatbotId: string, dto: CreateChatbotVersionDto): Promise<CreateChatbotVersionResponse> {
    await this.scope.assertWritable(chatbotId);
    return this.versionCapture.captureManual(chatbotId, dto);
  }

  async content(chatbotId: string, versionId: string, query: VersionContentQuery): Promise<VersionContentPage> {
    await this.scope.assertReadable(chatbotId);
    await this.findRowOrThrow(chatbotId, versionId);

    const loaded = await this.payloadReader.loadForContent(versionId);

    if (!loaded.schemaSupported) {
      const raw = loaded.raw as { assets?: Record<string, unknown[]> } | null;
      const kindKeyMap: Record<string, string> = {
        INTENT: 'intents',
        KEYWORD: 'keywords',
        HOMONYM: 'homonyms',
        NODE: 'dialogNodes',
        CONTEXT: 'contexts',
        FAQ: 'faqs',
      };
      const rawItems = (raw?.assets?.[kindKeyMap[query.kind] ?? ''] as unknown[] | undefined) ?? [];
      return { kind: query.kind, schemaSupported: false, items: rawItems, total: rawItems.length, page: 1, pageSize: rawItems.length || 1 };
    }

    const hydrated = hydrateSnapshot(loaded.envelope, chatbotId);
    let items: unknown[];
    switch (query.kind) {
      case 'INTENT':
        items = hydrated.bundle.intents;
        break;
      case 'KEYWORD':
        items = hydrated.bundle.keywords;
        break;
      case 'HOMONYM':
        items = hydrated.bundle.homonyms;
        break;
      case 'NODE':
        // [No.26] 응답 가림(FR-L1-6·FR-L8-3) — v1 API_CONDITION 헤더 값·URL을 가린다.
        items = hydrated.bundle.dialogNodes.map((n) => ({ ...n, outputs: redactLegacyApiOutputs(n.outputs) }));
        break;
      case 'CONTEXT':
        items = hydrated.bundle.contexts;
        break;
      case 'FAQ':
        items = hydrated.bundle.faqs;
        break;
      case 'ANSWER_SETTING':
        items = hydrated.answerSetting ? [hydrated.answerSetting] : [];
        break;
      case 'PROFILE':
        items = [hydrated.profile];
        break;
    }

    if (query.q) {
      const q = query.q.toLowerCase();
      items = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
    }

    const total = items.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const paged = items.slice((page - 1) * pageSize, page * pageSize);

    return { kind: query.kind, schemaSupported: true, items: paged, total, page, pageSize };
  }

  async update(chatbotId: string, versionId: string, dto: UpdateChatbotVersionDto): Promise<ChatbotVersionDetail> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, versionId);

    if (dto.pinned === true && !current.pinned) {
      await this.prisma.$transaction(async (tx) => {
        const pinnedCount = await tx.chatbotVersion.count({ where: { chatbotId, pinned: true } });
        if (pinnedCount >= this.pinnedMax()) {
          throw new ApiException('VERSION_PINNED_LIMIT_EXCEEDED', 409, `고정 버전은 최대 ${this.pinnedMax()}개까지 가능합니다.`);
        }
        await tx.chatbotVersion.update({ where: { id: versionId }, data: { pinned: true } });
      });
    }

    const row = await this.prisma.chatbotVersion.update({
      where: { id: versionId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.memo !== undefined ? { memo: dto.memo } : {}),
        ...(dto.pinned !== undefined && !(dto.pinned === true && !current.pinned) ? { pinned: dto.pinned } : {}),
      },
    });

    const summary = dto.pinned !== undefined ? (dto.pinned ? '고정' : '고정 해제') : undefined;
    await this.auditLogService.record({
      action: 'UPDATE',
      targetType: 'ChatbotVersion',
      targetId: row.id,
      targetName: row.label ? `v${row.versionNo} · ${row.label}` : `v${row.versionNo}`,
      chatbotId,
      before: { versionNo: current.versionNo, trigger: current.trigger, label: current.label, memo: current.memo, pinned: current.pinned, sizeBytes: current.sizeBytes },
      after: { versionNo: row.versionNo, trigger: row.trigger, label: row.label, memo: row.memo, pinned: row.pinned, sizeBytes: row.sizeBytes },
      summary,
    });

    return toVersionDetailDto(row, 'OK');
  }

  async remove(chatbotId: string, versionId: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, versionId);
    if (current.pinned) {
      throw new ApiException('VERSION_PINNED', 409, '고정된 버전은 삭제할 수 없습니다. 먼저 고정을 해제해 주세요.');
    }

    await this.retention.deleteOne(versionId);

    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'ChatbotVersion',
      targetId: current.id,
      targetName: current.label ? `v${current.versionNo} · ${current.label}` : `v${current.versionNo}`,
      chatbotId,
      before: { versionNo: current.versionNo, trigger: current.trigger, label: current.label, memo: current.memo, pinned: current.pinned, sizeBytes: current.sizeBytes },
    });
  }

  async auditCount(chatbotId: string, versionId: string): Promise<VersionAuditCount> {
    await this.scope.assertReadable(chatbotId);
    const current = await this.findRowOrThrow(chatbotId, versionId);

    const next = await this.prisma.chatbotVersion.findFirst({
      where: { chatbotId, versionNo: { gt: current.versionNo } },
      orderBy: { versionNo: 'asc' },
      select: { createdAt: true },
    });

    const from = current.createdAt;
    const to = next?.createdAt ?? new Date();

    const maxRangeDays = this.config.get<number>('AUDIT_QUERY_MAX_RANGE_DAYS') ?? 90;
    const maxRangeMs = maxRangeDays * 86_400_000;
    let clamped = false;
    let linkFrom = from;
    if (to.getTime() - from.getTime() > maxRangeMs) {
      linkFrom = new Date(to.getTime() - maxRangeMs);
      clamped = true;
    }

    const count = await this.prisma.auditLog.count({ where: { chatbotId, createdAt: { gte: from, lt: to } } });

    return {
      versionId,
      from,
      to,
      count,
      link: { chatbotId, from: linkFrom, to, clamped },
    };
  }
}
