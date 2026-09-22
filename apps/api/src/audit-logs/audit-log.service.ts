import { Injectable, Logger } from '@nestjs/common';
import type { AuditAction, AuditTargetType } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { buildSnapshot, serializeSnapshot } from './lib/audit-snapshot';

export interface AuditActorOverride {
  id: string | null;
  email: string;
  role: string | null;
}

export interface AuditRecordInput {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  targetName?: string | null;
  chatbotId?: string | null;
  /** 도메인 엔터티(변경 전 원본). 화이트리스트 스냅샷으로 변환된 뒤 저장된다(§9.6). */
  before?: unknown;
  after?: unknown;
  summary?: string;
  /** 인증되지 않은 주체를 기록해야 하는 auth 경로 전용(로그인 실패 등). */
  actorOverride?: AuditActorOverride;
}

/**
 * 전 도메인 쓰기 동작의 단일 기록 진입점(FR-13-1, DD-38, ADR-0016). 각 서비스가 이 메서드를
 * 명시 호출한다 — 인터셉터·Prisma 미들웨어는 쓰지 않는다. `prisma.auditLog.create`를 이 서비스
 * 밖에서 호출하지 않는다(NFR-M3).
 *
 * - `actor`는 인자가 아니라 `RequestContextService`(ALS)에서 읽는다(§8.4). 예외는 `actorOverride`뿐이다.
 * - 전체가 try/catch로 감싸여 있고 모든 예외를 삼키며 `logger.warn`만 남긴다(FR-13-13, AC-13-13).
 * - 호출 시점은 **본 동작 커밋 직후**여야 한다(DD-41) — 트랜잭션 내부에서 호출하지 않는다.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('AuditLogService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  async record(input: AuditRecordInput): Promise<void> {
    try {
      const ctx = this.requestContext.get();
      const actor = input.actorOverride ?? ctx?.actor ?? null;

      // 대량 작업 요약(FR-13-5)은 엔터티 스냅샷이 아니라 이미 안전하게 구성된 요약 객체다 —
      // targetType 화이트리스트로 걸러내면 요약 필드(created/updated/targetIds 등)가 전부 사라진다.
      const isBulkSummary = input.action === 'BULK_DELETE' || input.action === 'IMPORT';
      const beforeSnapshot = isBulkSummary ? ((input.before as Record<string, unknown> | undefined) ?? null) : buildSnapshot(input.targetType, input.before ?? null);
      const afterSnapshot = isBulkSummary ? ((input.after as Record<string, unknown> | undefined) ?? null) : buildSnapshot(input.targetType, input.after ?? null);
      const before = serializeSnapshot(beforeSnapshot);
      const after = serializeSnapshot(afterSnapshot);

      await this.prisma.auditLog.create({
        data: {
          actorId: actor?.id ?? null,
          actorEmail: actor?.email ?? 'system',
          actorRole: actor?.role ?? null,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          targetName: input.targetName ?? null,
          chatbotId: input.chatbotId ?? null,
          beforeValue: before.json,
          afterValue: after.json,
          summary: input.summary ?? null,
          ip: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
        },
      });
    } catch (e) {
      // 경고 로그에도 before/after 내용을 넣지 않는다(NFR-S8).
      const message = e instanceof Error ? e.message : 'unknown error';
      this.logger.warn(
        `AuditLog 기록 실패: action=${input.action} targetType=${input.targetType} targetId=${input.targetId} error=${message}`,
      );
    }
  }
}
