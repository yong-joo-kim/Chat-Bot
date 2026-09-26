import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditChainVerifyResponse } from '@chat-bot/shared-types';
import { AUDIT_CHAIN_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { auditChainSigner } from '../../common/crypto/env-key.provider';
import { AuditRangeTooWideError, InvalidAuditRangeError, resolveAuditRange } from '../lib/audit-range';
import { verifySegment } from './lib/verify-segment';
import type { ChainRowForVerify } from './lib/verify-segment';

export { AuditRangeTooWideError, InvalidAuditRangeError };

const GENESIS_ANCHOR_ID = 'GENESIS';

/**
 * ★ 감사 해시 체인 검증기(No.45, §10.6) — 읽기 전용. `POST /audit-logs/verify`(기간 상한)와 주간
 * 자동 검증(파기 잡)이 공용으로 쓴다. `governance` 모듈은 이 서비스를 `audit-logs`에서 가져다 쓴다
 * (소유는 `audit-logs`, 순환 의존 없음 — §2.2).
 */
@Injectable()
export class AuditChainVerifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private maxRangeDays(): number {
    return this.config.get<number>('AUDIT_QUERY_MAX_RANGE_DAYS') ?? 90;
  }

  async verify(from: Date | undefined, to: Date | undefined, now: Date = new Date()): Promise<AuditChainVerifyResponse> {
    const range = resolveAuditRange(from, to, this.maxRangeDays(), now);
    const toIsNow = to === undefined;

    const head = await this.prisma.auditChainHead.findUnique({ where: { id: 'HEAD' } });
    const headView = head ? { seq: head.headSeq, hash: head.headHash } : null;

    const [chainAgg, preChainCount, outOfChainCount] = await Promise.all([
      this.prisma.auditLog.aggregate({
        where: { createdAt: { gte: range.from, lte: range.to }, seq: { not: null } },
        _min: { seq: true },
        _max: { seq: true },
      }),
      this.countPreChainRows(range.from, range.to),
      this.countOutOfChainRows(range.from, range.to),
    ]);

    const minSeq = chainAgg._min.seq;
    const maxSeq = chainAgg._max.seq;

    if (minSeq === null || maxSeq === null) {
      return {
        status: 'EMPTY',
        range: null,
        checkedRows: 0,
        preChainRows: preChainCount,
        outOfChainRows: outOfChainCount,
        head: headView,
        methods: { sha256: 0, hmac: 0 },
        verifiedAt: now,
      };
    }

    const rowCount = maxSeq - minSeq + 1;
    if (rowCount > AUDIT_CHAIN_LIMITS.verifyMaxRows) {
      throw new AuditRangeTooWideError(`검증 대상 행 수가 상한(${AUDIT_CHAIN_LIMITS.verifyMaxRows.toLocaleString()}행)을 초과합니다.`);
    }

    const startHash = await this.resolveStartHash(minSeq);
    if (startHash === null) {
      return {
        status: 'ANCHOR_MISSING',
        range: { fromSeq: minSeq, toSeq: maxSeq },
        checkedRows: 0,
        preChainRows: preChainCount,
        outOfChainRows: outOfChainCount,
        head: headView,
        methods: { sha256: 0, hmac: 0 },
        verifiedAt: now,
      };
    }

    const rows = await this.fetchRowsBatched(minSeq, maxSeq);
    const signer = auditChainSigner();
    const result = verifySegment(rows, startHash, (keyId, input) => signer.verify(keyId, input));

    let status: AuditChainVerifyResponse['status'] = result.status;
    if (status === 'OK' && toIsNow && head && result.lastSeq !== head.headSeq) {
      status = 'TAIL_MISSING';
    }

    return {
      status,
      firstBadSeq: result.firstBadSeq,
      gap: result.gap,
      range: { fromSeq: minSeq, toSeq: maxSeq },
      checkedRows: result.checkedRows,
      preChainRows: preChainCount,
      outOfChainRows: outOfChainCount,
      head: headView,
      methods: result.methods,
      verifiedAt: now,
    };
  }

  private async resolveStartHash(minSeq: number): Promise<string | null> {
    if (minSeq === 1) {
      const genesis = await this.prisma.auditChainAnchor.findUnique({ where: { id: GENESIS_ANCHOR_ID } });
      return genesis?.hash ?? null;
    }
    const prevRow = await this.prisma.auditLog.findUnique({ where: { seq: minSeq - 1 }, select: { rowHash: true } });
    if (prevRow?.rowHash) return prevRow.rowHash;
    const anchor = await this.prisma.auditChainAnchor.findFirst({ where: { seq: minSeq - 1 }, orderBy: { updatedAt: 'desc' } });
    return anchor?.hash ?? null;
  }

  private async fetchRowsBatched(minSeq: number, maxSeq: number): Promise<ChainRowForVerify[]> {
    const rows: ChainRowForVerify[] = [];
    let cursor = minSeq;
    while (cursor <= maxSeq) {
      const batch = await this.prisma.auditLog.findMany({
        where: { seq: { gte: cursor, lte: maxSeq } },
        orderBy: { seq: 'asc' },
        take: AUDIT_CHAIN_LIMITS.verifyBatch,
      });
      if (batch.length === 0) break;
      for (const r of batch) {
        rows.push({
          id: r.id,
          seq: r.seq as number,
          createdAt: r.createdAt,
          actorId: r.actorId,
          actorEmail: r.actorEmail,
          actorRole: r.actorRole,
          action: r.action,
          targetType: r.targetType,
          targetId: r.targetId,
          targetName: r.targetName,
          chatbotId: r.chatbotId,
          beforeValue: r.beforeValue,
          afterValue: r.afterValue,
          summary: r.summary,
          ip: r.ip,
          userAgent: r.userAgent,
          prevHash: r.prevHash,
          rowHash: r.rowHash,
        });
      }
      cursor = (batch[batch.length - 1].seq as number) + 1;
    }
    return rows;
  }

  private async countPreChainRows(from: Date, to: Date): Promise<number> {
    const genesis = await this.prisma.auditChainAnchor.findUnique({ where: { id: GENESIS_ANCHOR_ID } });
    if (!genesis?.preChainMaxCreatedAt) return 0;
    const upperBound = genesis.preChainMaxCreatedAt < to ? genesis.preChainMaxCreatedAt : to;
    if (upperBound < from) return 0;
    return this.prisma.auditLog.count({ where: { seq: null, createdAt: { gte: from, lte: upperBound } } });
  }

  private async countOutOfChainRows(from: Date, to: Date): Promise<number> {
    const genesis = await this.prisma.auditChainAnchor.findUnique({ where: { id: GENESIS_ANCHOR_ID } });
    if (!genesis?.preChainMaxCreatedAt) {
      return this.prisma.auditLog.count({ where: { seq: null, createdAt: { gte: from, lte: to } } });
    }
    const lowerBound = genesis.preChainMaxCreatedAt > from ? genesis.preChainMaxCreatedAt : from;
    if (lowerBound > to) return 0;
    return this.prisma.auditLog.count({ where: { seq: null, createdAt: { gt: lowerBound, lte: to } } });
  }
}
