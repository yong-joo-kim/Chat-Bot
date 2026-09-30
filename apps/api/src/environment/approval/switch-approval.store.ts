import { Injectable } from '@nestjs/common';
import type { Prisma, ProdSwitchApprovalRequest as RequestRow } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';

type Db = PrismaService | Prisma.TransactionClient;

export interface CreateRequestData {
  chatbotId: string;
  action: string;
  targetVersionId: string;
  targetVersionNo: number;
  baseProdVersionId: string;
  baseProdVersionNo: number;
  deployScheduleId: string | null;
  gateSnapshot: string;
  warningCodes: string;
  diffChangedCount: number;
  reason: string | null;
  requestedById: string;
  requestedByEmail: string;
  expiresAt: Date;
}

export interface CloseData {
  status: 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  outcome?: 'APPLIED' | 'NOOP' | 'FAILED' | 'SCHEDULED';
  failureCode?: string;
  closedReason?: 'REQUESTER' | 'POLICY_OFF' | 'BASE_CHANGED' | 'SCHEDULE_INACTIVE';
  decisionNote?: string | null;
  decidedById?: string | null;
  decidedByEmail?: string | null;
  decidedAt?: Date;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * ★ `ProdSwitchApprovalRequest` 쓰기 유일 파일(AG-4) — 생성 1 · 전이 전부 **`PENDING` CAS**(AG-12: 모든 `update*`의 `where`에
 * `status: 'PENDING'`). 챗봇당 대기 1건은 nullable `@unique pendingLock`(대기일 때 `chatbotId`, 종결 시 null — 원시 부분
 * 인덱스 0). 영구삭제 동반 삭제(`chatbots.service.ts`)만 예외다.
 */
@Injectable()
export class SwitchApprovalStore {
  constructor(private readonly prisma: PrismaService) {}

  /** 생성 — 같은 챗봇에 대기가 이미 있으면(유일 제약) `409 APPROVAL_PENDING_EXISTS`(`details.requestId`). */
  async create(data: CreateRequestData): Promise<RequestRow> {
    try {
      return await this.prisma.prodSwitchApprovalRequest.create({ data: { ...data, status: 'PENDING', pendingLock: data.chatbotId } });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const existing = await this.prisma.prodSwitchApprovalRequest.findFirst({ where: { chatbotId: data.chatbotId, status: 'PENDING' }, select: { id: true } });
        throw new ApiException(
          'APPROVAL_PENDING_EXISTS',
          409,
          '이 챗봇에는 승인을 기다리는 요청이 이미 있습니다. 그 요청을 처리하거나 취소한 뒤 다시 요청해 주세요.',
          existing ? [{ field: 'requestId', message: existing.id }] : undefined,
        );
      }
      throw e;
    }
  }

  /**
   * 전이(반려·취소·만료·기준 변경·예약 비활성·정책 끔·승인 실패·예약 승인) — `PENDING`일 때만 갱신한다. 0 = 이미 처리됨.
   * `db`에 트랜잭션 클라이언트를 넘길 수 있다(정책 끄기가 정책 갱신과 같은 트랜잭션에서 대기 요청을 취소한다).
   */
  async close(id: string, data: CloseData, db: Db = this.prisma): Promise<number> {
    const { count } = await db.prodSwitchApprovalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { ...data, pendingLock: null },
    });
    return count;
  }

  /** 정책 끄기 — 챗봇의 대기 요청을 한 번에 취소한다(자동 실행 0). 취소된 요청 id 목록을 돌려준다. */
  async cancelPendingForChatbot(chatbotId: string, data: CloseData, db: Db): Promise<string[]> {
    const pending = await db.prodSwitchApprovalRequest.findMany({ where: { chatbotId, status: 'PENDING' }, select: { id: true } });
    const cancelled: string[] = [];
    for (const row of pending) {
      const { count } = await db.prodSwitchApprovalRequest.updateMany({ where: { id: row.id, status: 'PENDING' }, data: { ...data, pendingLock: null } });
      if (count > 0) cancelled.push(row.id);
    }
    return cancelled;
  }

  /** 즉시 승인의 선점 — 전환 트랜잭션 안에서 호출된다(0 = 다른 승인·취소·정책 끔이 먼저 → 전환 전체 롤백). */
  async claimApplied(tx: Prisma.TransactionClient, id: string, approver: { id: string; email: string }, now: Date): Promise<number> {
    const { count } = await tx.prodSwitchApprovalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', outcome: 'APPLIED', decidedById: approver.id, decidedByEmail: approver.email, decidedAt: now, pendingLock: null },
    });
    return count;
  }

  /* ── 읽기 ── */

  find(id: string): Promise<RequestRow | null> {
    return this.prisma.prodSwitchApprovalRequest.findUnique({ where: { id } });
  }

  findPending(chatbotId: string): Promise<RequestRow | null> {
    return this.prisma.prodSwitchApprovalRequest.findFirst({ where: { chatbotId, status: 'PENDING' } });
  }

  listRecent(chatbotId: string, take: number): Promise<RequestRow[]> {
    return this.prisma.prodSwitchApprovalRequest.findMany({ where: { chatbotId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take });
  }

  /** 전역 대기 요청 전부(챗봇 수가 적은 관리 데이터 — 지연 종결 판정 입력). */
  listAllPending(): Promise<RequestRow[]> {
    return this.prisma.prodSwitchApprovalRequest.findMany({ where: { status: 'PENDING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  }

  async listPage(status: 'PENDING' | 'ALL', skip: number, take: number): Promise<{ rows: RequestRow[]; total: number }> {
    const where = status === 'PENDING' ? { status: 'PENDING' } : {};
    const [rows, total] = await Promise.all([
      this.prisma.prodSwitchApprovalRequest.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
      this.prisma.prodSwitchApprovalRequest.count({ where }),
    ]);
    return { rows, total };
  }
}
