import { Injectable } from '@nestjs/common';
import type { RetentionRunItem, RetentionRunKind, RetentionRunListQuery, RetentionRunListResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/** 파기·재암호화·체인 검증 실행 이력 조회 전용(No.45 §9.4 — 읽기 전용, 쓰기는 writer만). */
@Injectable()
export class RetentionRunQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: RetentionRunListQuery): Promise<RetentionRunListResponse> {
    const where: Record<string, unknown> = {};
    if (query.kind && query.kind.length > 0) where.kind = { in: query.kind };
    if (query.chatbotId) where.chatbotId = query.chatbotId;
    if (query.from || query.to) {
      where.startedAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    }

    const [rows, total] = await Promise.all([
      this.prisma.retentionRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.retentionRun.count({ where }),
    ]);

    const items: RetentionRunItem[] = rows.map((r) => ({
      id: r.id,
      runId: r.runId,
      kind: r.kind as RetentionRunKind,
      target: r.target,
      chatbotId: r.chatbotId,
      days: r.days,
      cutoff: r.cutoff,
      affectedCount: r.affectedCount,
      status: r.status as RetentionRunItem['status'],
      resultCode: r.resultCode,
      headSeq: r.headSeq,
      headHash: r.headHash,
      anchorSeq: r.anchorSeq,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    }));

    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
