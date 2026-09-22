import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_LIMITS,
  AUDIT_TARGET_LABELS,
  AuditLogDetail,
  AuditLogListQuery,
  AuditLogListResponse,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toAuditLogDetail, toAuditLogListItem } from './audit-log.mapper';
import { AuditRangeTooWideError, InvalidAuditRangeError, resolveAuditRange } from './lib/audit-range';
import { buildCsv } from '../dialogue-common/import/lib/csv-writer';

const NOT_FOUND_MESSAGE = '요청하신 이력을 찾을 수 없습니다.';
const EXPORT_HEADERS = ['시각', '수행자', '역할', '동작', '대상유형', '대상명', '챗봇ID', '요약'];

/** 이력 조회 전용(FR-13-15~19). 쓰기 경로는 존재하지 않는다(append-only, FR-13-14/20). */
@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private maxRangeDays(): number {
    return this.config.get<number>('AUDIT_QUERY_MAX_RANGE_DAYS') ?? 90;
  }

  private buildWhere(query: AuditLogListQuery, from: Date, to: Date): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { createdAt: { gte: from, lte: to } };
    if (query.actorId) where.actorId = query.actorId;
    if (query.action && query.action.length > 0) where.action = { in: query.action };
    if (query.targetType && query.targetType.length > 0) where.targetType = { in: query.targetType };
    if (query.chatbotId) where.chatbotId = query.chatbotId;
    if (query.q) where.targetName = { contains: query.q };
    return where;
  }

  async list(query: AuditLogListQuery): Promise<AuditLogListResponse> {
    const range = this.resolveRangeOrThrow(query.from, query.to);
    const where = this.buildWhere(query, range.from, range.to);

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: rows.map(toAuditLogListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
      appliedFrom: range.from,
      appliedTo: range.to,
      rangeDefaulted: range.defaulted,
    };
  }

  async findOne(id: string): Promise<AuditLogDetail> {
    const row = await this.prisma.auditLog.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return toAuditLogDetail(row);
  }

  /** CSV 내보내기(P2, FR-13-19). 기간 필터가 필수이며 최대 10,000행이다. */
  async export(query: AuditLogListQuery): Promise<{ content: string; filename: string; mimeType: string }> {
    const range = this.resolveRangeOrThrow(query.from, query.to);
    const where = this.buildWhere(query, range.from, range.to);

    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: AUDIT_LIMITS.exportRows,
    });

    const lines = rows.map((row) => {
      const item = toAuditLogListItem(row);
      return [
        item.createdAt.toISOString(),
        item.actorEmail ?? 'system',
        item.actorRole ?? '',
        AUDIT_ACTION_LABELS[item.action],
        AUDIT_TARGET_LABELS[item.targetType],
        item.targetName ?? '',
        item.chatbotId ?? '',
        item.summary ?? '',
      ];
    });

    return { content: buildCsv(EXPORT_HEADERS, lines), filename: 'audit-logs-export.csv', mimeType: 'text/csv; charset=utf-8' };
  }

  private resolveRangeOrThrow(from: Date | undefined, to: Date | undefined) {
    try {
      return resolveAuditRange(from, to, this.maxRangeDays());
    } catch (e) {
      if (e instanceof AuditRangeTooWideError) {
        throw new ApiException('AUDIT_RANGE_TOO_WIDE', 400, e.message);
      }
      if (e instanceof InvalidAuditRangeError) {
        throw new ApiException('INVALID_PERIOD', 400, e.message);
      }
      throw e;
    }
  }
}
