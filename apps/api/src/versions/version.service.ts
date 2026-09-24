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
import { VERSION_TRIGGER_GROUPS, redactLegacyApiOutputs } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { VersionCaptureService } from './capture/version-capture.service';
import { VersionRetentionService } from './capture/version-retention.service';
import { VersionPayloadReader } from './read/version-payload.reader';
import { hydrateSnapshot } from './lib/snapshot-hydrate';
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

  async list(chatbotId: string, query: ChatbotVersionListQuery): Promise<Paginated<ChatbotVersionListItem>> {
    await this.scope.assertReadable(chatbotId);

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

    return toPaginated(rows.map(toVersionListItemDto), total, query.page, query.pageSize);
  }

  async current(chatbotId: string): Promise<VersionCurrentStatus> {
    await this.scope.assertReadable(chatbotId);
    const data = await this.versionCapture.captureSnapshotData(chatbotId);
    const latestRow = await this.prisma.chatbotVersion.findFirst({ where: { chatbotId }, orderBy: { versionNo: 'desc' } });
    const latestVersion = latestRow ? toVersionListItemDto(latestRow) : null;
    return {
      contentHash: data.contentHash,
      counts: data.counts,
      latestVersion,
      hasUnsavedChanges: latestVersion === null || latestVersion.contentHash !== data.contentHash,
    };
  }

  private async findRowOrThrow(chatbotId: string, versionId: string) {
    const row = await this.prisma.chatbotVersion.findUnique({ where: { id: versionId } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async detail(chatbotId: string, versionId: string): Promise<ChatbotVersionDetail> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, versionId);

    let payloadStatus: 'OK' | 'CORRUPT' | 'SCHEMA_UNSUPPORTED' = 'OK';
    try {
      const loaded = await this.payloadReader.loadForContent(versionId);
      payloadStatus = loaded.schemaSupported ? 'OK' : 'SCHEMA_UNSUPPORTED';
    } catch {
      payloadStatus = 'CORRUPT';
    }

    return toVersionDetailDto(row, payloadStatus);
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
