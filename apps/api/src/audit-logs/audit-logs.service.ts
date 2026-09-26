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
import { AuditLogService } from './audit-log.service';
import { AuditChainVerifier } from './chain/audit-chain-verifier.service';

const NOT_FOUND_MESSAGE = '요청하신 이력을 찾을 수 없습니다.';
// [신규 No.45] 기존 8열 뒤에 seq·rowHash 2열(체인 밖 행은 빈 값) — 열 순서는 기존 그대로.
const EXPORT_HEADERS = ['시각', '수행자', '역할', '동작', '대상유형', '대상명', '챗봇ID', '요약', 'seq', 'rowHash'];

/** 이력 조회 전용(FR-13-15~19). 쓰기 경로는 존재하지 않는다(append-only, FR-13-14/20). */
@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
    private readonly chainVerifier: AuditChainVerifier,
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

  /**
   * CSV 내보내기(P2, FR-13-19). 기간 필터가 필수이며 최대 10,000행이다.
   * [신규 No.45] `EXPORT` 감사 1건(모드 무관 항상) · `seq`·`rowHash` 2열 + 파일 끝 체인 표식 행 2개.
   */
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
        row.seq !== null ? String(row.seq) : '',
        row.rowHash ?? '',
      ];
    });

    // [신규 No.45] 내보낸 행들의 연속 구간(필터와 무관 — [min seq, max seq])을 검증해 표식 행에 싣는다.
    const chainSeqs = rows.map((r) => r.seq).filter((s): s is number => s !== null);
    let verifyStatus = 'EMPTY';
    let checkedRows = 0;
    let firstBadSeq = '';
    let fromSeq = '';
    let toSeq = '';
    if (chainSeqs.length > 0) {
      const min = Math.min(...chainSeqs);
      const max = Math.max(...chainSeqs);
      fromSeq = String(min);
      toSeq = String(max);
      try {
        const minRow = await this.prisma.auditLog.findUnique({ where: { seq: min }, select: { createdAt: true } });
        const maxRow = await this.prisma.auditLog.findUnique({ where: { seq: max }, select: { createdAt: true } });
        if (minRow && maxRow) {
          const result = await this.chainVerifier.verify(minRow.createdAt, maxRow.createdAt);
          verifyStatus = result.status;
          checkedRows = result.checkedRows;
          firstBadSeq = result.firstBadSeq !== undefined ? String(result.firstBadSeq) : '';
        }
      } catch {
        verifyStatus = 'SKIPPED_TOO_MANY';
      }
    }

    const head = await this.prisma.auditChainHead.findUnique({ where: { id: 'HEAD' } });
    const headSeq = head ? String(head.headSeq) : '';
    const headHash = head ? head.headHash : '';
    const generatedAt = new Date().toISOString();

    const markerRows = [
      ['#CHAIN_HEAD', headSeq, headHash, generatedAt, '', '', '', '', '', ''],
      ['#CHAIN_VERIFY', verifyStatus, String(checkedRows), firstBadSeq, fromSeq, toSeq, '', '', '', ''],
    ];

    const content = buildCsv(EXPORT_HEADERS, [...lines, ...markerRows]);

    await this.auditLog.recordExport({
      targetType: 'AuditLog',
      targetId: '*',
      summary: `내보내기 · 감사로그 · ${range.from.toISOString().slice(0, 10)}~${range.to.toISOString().slice(0, 10)} · ${rows.length}행`,
      after: { from: range.from.toISOString(), to: range.to.toISOString(), rows: rows.length, truncated: rows.length >= AUDIT_LIMITS.exportRows, headSeq: head?.headSeq ?? null },
    });

    return { content, filename: 'audit-logs-export.csv', mimeType: 'text/csv; charset=utf-8' };
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
