import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuditAction, AuditTargetType } from '@chat-bot/shared-types';
import { KST_OFFSET_MINUTES, toKstDayBucket } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context/request-context.service';
import { governanceRuntime } from '../common/governance/governance-runtime';
import { auditChainSigner } from '../common/crypto/env-key.provider';
import { buildSnapshot, serializeSnapshot } from './lib/audit-snapshot';
import { GENESIS_HASH, buildHmacRowHash, canonicalizeV1, computeSha256RowHash, hmacSignInput } from './chain/audit-chain';
import type { CanonicalRow } from './chain/audit-chain';

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
  /** 인증되지 않은 주체를 기록해야 하는 auth 경로 전용(로그인 실패 등) + 예약 실행기
   * (`deploy-schedules/**`, 요청 컨텍스트가 없는 경로 — scheduled-deploy-설계.md §8.4). */
  actorOverride?: AuditActorOverride;
}

/**
 * [신규 2026-09-23 No.28] 예약 실행기가 `restore()`(§9.2)·`ChatbotPublicationService`(§5.4)에 넘기는
 * 호출 문맥 — 요청 컨텍스트가 없는 경로에서 감사 주체를 예약자로 남기기 위함(ADR-0032 §5).
 */
export interface ScheduledInvocation {
  actor: AuditActorOverride;
  auditSummaryPrefix: string;
  triggerContext?: { deployScheduleId: string };
}

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const CHAIN_RETRY_ATTEMPTS = 5;
const VIEW_LRU_MAX = 10_000;

/**
 * 전 도메인 쓰기 동작의 단일 기록 진입점(FR-13-1, DD-38, ADR-0016). 각 서비스가 이 메서드를
 * 명시 호출한다 — 인터셉터·Prisma 미들웨어는 쓰지 않는다. `prisma.auditLog.create`를 이 서비스
 * 밖에서 호출하지 않는다(NFR-M3).
 *
 * - `actor`는 인자가 아니라 `RequestContextService`(ALS)에서 읽는다(§8.4). 예외는 `actorOverride`뿐이다.
 * - 전체가 try/catch로 감싸여 있고 모든 예외를 삼키며 `logger.warn`만 남긴다(FR-13-13, AC-13-13).
 * - 호출 시점은 **본 동작 커밋 직후**여야 한다(DD-41) — 트랜잭션 내부에서 호출하지 않는다.
 *
 * [신규 No.45] `record()` 1곳이 해시 체인(§10.3)도 계산한다 — 헤드 CAS·행 삽입을 한 트랜잭션으로
 * 묶고, 경합(재시도 5회) 초과 시 **체인 없이 기록 + 경고**(감사 행 자체는 잃지 않는다).
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger('AuditLogService');
  /** `recordView()` 중복 억제 — 인스턴스 로컬(삽입 순서 = LRU 근사, §11.3). */
  private readonly viewSeen = new Map<string, true>();
  /** [신규 No.45 §10.3] 인스턴스 로컬 직렬화 큐 — 같은 프로세스 안의 동시 `record()` 호출을 한 줄로
   * 세워 헤드 CAS 경합을 원천적으로 줄인다(다중 인스턴스 간 경합은 여전히 DB CAS+재시도가 처리한다). */
  private chainQueue: Promise<unknown> = Promise.resolve();

  private runSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chainQueue.then(fn, fn);
    this.chainQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
  ) {}

  /**
   * [신규 2026-09-23 No.25] 현재 요청 주체 스냅샷(ADR-0031 §12) — 버전 캡처(`createdById/Email`)가
   * 이 메서드로만 얻는다. `RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳이다
   * (개발명세서 §2.1 규약 불변). 시스템 경로·ALS 부재 시 `null`.
   */
  currentActorSnapshot(): { id: string; email: string; role: string } | null {
    return this.requestContext.get()?.actor ?? null;
  }

  async record(input: AuditRecordInput): Promise<void> {
    try {
      const ctx = this.requestContext.get();
      const actor = input.actorOverride ?? ctx?.actor ?? null;

      // 대량 작업 요약(FR-13-5)은 엔터티 스냅샷이 아니라 이미 안전하게 구성된 요약 객체다 —
      // targetType 화이트리스트로 걸러내면 요약 필드(created/updated/targetIds 등)가 전부 사라진다.
      // [신규 2026-09-23 No.25] `RESTORE`도 요약 액션이다(ADR-0031 §12). [신규 No.45] `EXPORT`도
      // 요약(기간·행 수·필터 열거값)이라 화이트리스트를 거치지 않는다(§11.2).
      const isBulkSummary = input.action === 'BULK_DELETE' || input.action === 'IMPORT' || input.action === 'RESTORE' || input.action === 'EXPORT';
      const beforeSnapshot = isBulkSummary ? ((input.before as Record<string, unknown> | undefined) ?? null) : buildSnapshot(input.targetType, input.before ?? null);
      const afterSnapshot = isBulkSummary ? ((input.after as Record<string, unknown> | undefined) ?? null) : buildSnapshot(input.targetType, input.after ?? null);
      const before = serializeSnapshot(beforeSnapshot);
      const after = serializeSnapshot(afterSnapshot);

      const row = {
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
      };

      await this.runSerialized(() => this.recordWithChain(row));
    } catch (e) {
      // 경고 로그에도 before/after 내용을 넣지 않는다(NFR-S8).
      const message = e instanceof Error ? e.message : 'unknown error';
      this.logger.warn(
        `AuditLog 기록 실패: action=${input.action} targetType=${input.targetType} targetId=${input.targetId} error=${message}`,
      );
    }
  }

  /**
   * ★ [신규 No.45] 헤드 CAS + 행 삽입을 한 트랜잭션으로(§10.3). SQLite는 단일 작성자로 자연
   * 직렬화되고, Postgres에서도 헤드의 조건부 갱신이라 잠금이 필요 없다. 재시도 초과 시 **체인 없이
   * 기록**(감사 행 손실보다 체인 밖 행이 낫다 — 검증이 `outOfChainRows`로 드러낸다).
   */
  private async recordWithChain(row: Omit<CanonicalRow, 'id' | 'seq' | 'createdAt'> & { targetType: string }): Promise<void> {
    const signer = auditChainSigner();

    for (let attempt = 1; attempt <= CHAIN_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await this.prisma.$transaction(async (tx) => {
          let head = await tx.auditChainHead.findUnique({ where: { id: 'HEAD' } });
          if (!head) {
            try {
              head = await tx.auditChainHead.create({ data: { id: 'HEAD', headSeq: 0, headHash: GENESIS_HASH } });
            } catch (e) {
              if (isUniqueConstraintViolation(e)) {
                head = await tx.auditChainHead.findUnique({ where: { id: 'HEAD' } });
              } else {
                throw e;
              }
            }
          }
          if (!head) throw new Error('CHAIN_HEAD_UNAVAILABLE');

          const id = randomUUID();
          const createdAt = new Date();
          const seq = head.headSeq + 1;
          const canonical: CanonicalRow = { ...row, id, seq, createdAt } as CanonicalRow;
          const canonicalJson = canonicalizeV1(canonical);

          const rowHash = signer.keyId
            ? buildHmacRowHash(signer.keyId, signer.sign(hmacSignInput(head.headHash, canonicalJson)))
            : computeSha256RowHash(head.headHash, canonicalJson);

          const cas = await tx.auditChainHead.updateMany({ where: { id: 'HEAD', headSeq: head.headSeq }, data: { headSeq: seq, headHash: rowHash } });
          if (cas.count !== 1) throw new Error('CHAIN_CONTENDED');

          await tx.auditLog.create({ data: { ...row, id, createdAt, seq, prevHash: head.headHash, rowHash } });
        });
        return;
      } catch {
        if (attempt < CHAIN_RETRY_ATTEMPTS) {
          await sleep(5 + Math.floor(Math.random() * 20));
          continue;
        }
        // 재시도 초과 — 체인 없이 기록(감사 행을 잃지 않는다).
        await this.prisma.auditLog.create({ data: { ...row } });
        this.logger.warn(`AuditLog 체인 기록 실패 — 체인 밖 기록: action=${row.action} targetType=${row.targetType} targetId=${row.targetId}`);
        return;
      }
    }
  }

  /**
   * ★ [신규 No.45] 기동 시 1회 보장(부트스트랩이 호출) — 헤드가 없으면 헤드 + GENESIS 앵커를 만든다.
   * 도입 전 행(seq null)의 건수·최대 `createdAt`을 GENESIS 앵커에 남긴다.
   */
  async ensureChainHead(): Promise<void> {
    const existing = await this.prisma.auditChainHead.findUnique({ where: { id: 'HEAD' } });
    if (existing) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        const already = await tx.auditChainHead.findUnique({ where: { id: 'HEAD' } });
        if (already) return;
        const agg = await tx.auditLog.aggregate({ where: { seq: null }, _count: { _all: true }, _max: { createdAt: true } });
        await tx.auditChainHead.create({ data: { id: 'HEAD', headSeq: 0, headHash: GENESIS_HASH } });
        await tx.auditChainAnchor.create({
          data: { id: 'GENESIS', seq: 0, hash: GENESIS_HASH, preChainRows: agg._count._all, preChainMaxCreatedAt: agg._max.createdAt ?? null },
        });
      });
    } catch (e) {
      if (!isUniqueConstraintViolation(e)) throw e;
    }
  }

  /**
   * ★ [신규 No.45] 내보내기 감사(§11.2) — 모드 무관 항상. `after`는 이미 안전한 요약 객체다
   * (기간·행 수·필터 열거값 — 검색어·본문 없음).
   */
  async recordExport(input: {
    targetType: AuditTargetType;
    targetId: string;
    chatbotId?: string | null;
    targetName?: string | null;
    summary: string;
    after: Record<string, unknown>;
  }): Promise<void> {
    await this.record({
      action: 'EXPORT',
      targetType: input.targetType,
      targetId: input.targetId,
      chatbotId: input.chatbotId ?? null,
      targetName: input.targetName ?? null,
      summary: input.summary,
      after: input.after,
    });
  }

  /**
   * ★ [신규 No.45] 열람 감사(§11.3) — 모드 ON에서만. (열람자, targetType, targetId, chatbotId, KST 일)당
   * 1건(폴링·새로고침·페이지 넘김 중복 억제). 모드 OFF는 쿼리 0으로 즉시 반환한다(AC-DG7-3).
   */
  async recordView(input: { targetType: AuditTargetType; targetId: string; chatbotId?: string | null; summary?: string }): Promise<void> {
    if (governanceRuntime().mode !== 'ON') return;
    const ctx = this.requestContext.get();
    const actorId = ctx?.actor?.id;
    if (!actorId) return; // 인증 주체가 없는 경로는 열람 감사 대상이 아니다.

    const kstDay = toKstDayBucket(new Date());
    const dedupeKey = `${actorId}:${input.targetType}:${input.targetId}:${input.chatbotId ?? ''}:${kstDay}`;
    if (this.viewSeen.has(dedupeKey)) return;

    const [y, m, d] = kstDay.split('-').map(Number);
    const kstMidnightUtc = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) - KST_OFFSET_MINUTES * 60_000);

    const existing = await this.prisma.auditLog.findFirst({
      where: { actorId, action: 'VIEW', targetType: input.targetType, targetId: input.targetId, createdAt: { gte: kstMidnightUtc } },
      select: { id: true },
    });
    if (existing) {
      this.touchViewSeen(dedupeKey);
      return;
    }

    await this.record({
      action: 'VIEW',
      targetType: input.targetType,
      targetId: input.targetId,
      chatbotId: input.chatbotId ?? null,
      summary: input.summary ?? '열람',
    });
    this.touchViewSeen(dedupeKey);
  }

  private touchViewSeen(key: string): void {
    this.viewSeen.delete(key);
    this.viewSeen.set(key, true);
    while (this.viewSeen.size > VIEW_LRU_MAX) {
      const oldest = this.viewSeen.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.viewSeen.delete(oldest);
    }
  }
}
