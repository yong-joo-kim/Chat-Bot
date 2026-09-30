import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { EnvironmentDisableMode, EnvironmentGateSettings, EnvironmentSwitchMethod } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

type Db = PrismaService | Prisma.TransactionClient;

export interface ActorSnapshot {
  id: string | null;
  email: string;
}

export interface EnableInput {
  chatbotId: string;
  versionId: string;
  versionNo: number;
  versionCreatedAt: Date;
  now: Date;
  actor: ActorSnapshot | null;
  reason?: string;
}

export interface DisableInput {
  chatbotId: string;
  expectedProdVersionId: string;
  mode: EnvironmentDisableMode;
  now: Date;
  actor: ActorSnapshot | null;
  reason?: string;
}

export interface SetStagingInput {
  chatbotId: string;
  expectedStagingVersionId: string | null;
  versionId: string;
  versionNo: number;
  now: Date;
  actor: ActorSnapshot | null;
  reason?: string;
}

export interface SwitchProdInput {
  chatbotId: string;
  expectedProdVersionId: string;
  versionId: string;
  versionNo: number;
  versionCreatedAt: Date;
  method: EnvironmentSwitchMethod;
  deployScheduleId?: string;
  now: Date;
  actor: ActorSnapshot | null;
  reason?: string;
  /** [신규 No.36] 2인 승인으로 실행된 전환의 요청 id(이력에 남긴다 — FK 없음). */
  approvalRequestId?: string;
  /** [신규 No.36] `APPROVED`(2인 승인 전환) | `SOLO_ROLLBACK`(직전 버전 단독 롤백) — 정책이 꺼져 있으면 생략(null). */
  approvalMode?: 'APPROVED' | 'SOLO_ROLLBACK';
}

/**
 * [신규 No.40] ★ `Chatbot.prodVersionId` · `ChatbotEnvironment` · `EnvironmentSwitchLog` 쓰기 유일
 * 파일(정적 검사 E-1). 모든 포인터 갱신은 기대값 조건부(CAS)다 — 영향 행 0은 호출자가 409로 변환한다.
 * `EnvironmentCoreModule`은 이 클래스를 export하지 않는다(주입 불가 — §2.2).
 */
@Injectable()
export class EnvironmentPointerWriter {
  constructor(private readonly prisma: PrismaService) {}

  /** 켜기(§5.3) — 두 포인터를 같은 버전으로 초기화 + 이력 2행. 0 = 이미 켜짐(동시 켜기 경합). */
  async enable(db: Db, input: EnableInput): Promise<number> {
    const { count } = await db.chatbot.updateMany({
      where: { id: input.chatbotId, prodVersionId: null },
      data: { prodVersionId: input.versionId },
    });
    if (count === 0) return count;

    await db.chatbotEnvironment.upsert({
      where: { chatbotId: input.chatbotId },
      create: {
        chatbotId: input.chatbotId,
        stagingVersionId: input.versionId,
        enabledAt: input.now,
        enabledById: input.actor?.id ?? null,
        enabledByEmail: input.actor?.email ?? null,
      },
      update: {
        stagingVersionId: input.versionId,
        enabledAt: input.now,
        enabledById: input.actor?.id ?? null,
        enabledByEmail: input.actor?.email ?? null,
      },
    });

    const historyBase = {
      chatbotId: input.chatbotId,
      method: 'INIT' as const,
      toVersionId: input.versionId,
      toVersionNo: input.versionNo,
      toVersionCapturedAt: input.versionCreatedAt,
      actorId: input.actor?.id ?? null,
      actorEmail: input.actor?.email ?? null,
      reason: input.reason ?? null,
    };
    await db.environmentSwitchLog.create({ data: { ...historyBase, environment: 'PROD' } });
    await db.environmentSwitchLog.create({ data: { ...historyBase, environment: 'STAGING' } });
    return count;
  }

  /** 끄기(§5.4) — 포인터 제거 + 스테이징·enabledAt null(게이트 보존) + 이력 1행. */
  async disable(db: Db, input: DisableInput): Promise<number> {
    const { count } = await db.chatbot.updateMany({
      where: { id: input.chatbotId, prodVersionId: input.expectedProdVersionId },
      data: { prodVersionId: null },
    });
    if (count === 0) return count;

    await db.chatbotEnvironment.update({
      where: { chatbotId: input.chatbotId },
      data: { stagingVersionId: null, enabledAt: null, enabledById: null, enabledByEmail: null },
    });

    await db.environmentSwitchLog.create({
      data: {
        chatbotId: input.chatbotId,
        environment: 'PROD',
        method: 'DISABLE',
        fromVersionId: input.expectedProdVersionId,
        disableMode: input.mode,
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        reason: input.reason ?? null,
      },
    });
    return count;
  }

  /** 스테이징 승격(§9.2) — 0 = 다른 요청이 먼저 승격(경합). */
  async setStaging(db: Db, input: SetStagingInput): Promise<number> {
    const { count } = await db.chatbotEnvironment.updateMany({
      where: { chatbotId: input.chatbotId, stagingVersionId: input.expectedStagingVersionId },
      data: { stagingVersionId: input.versionId },
    });
    if (count === 0) return count;

    await db.environmentSwitchLog.create({
      data: {
        chatbotId: input.chatbotId,
        environment: 'STAGING',
        method: 'PROMOTE',
        fromVersionId: input.expectedStagingVersionId,
        toVersionId: input.versionId,
        toVersionNo: input.versionNo,
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        reason: input.reason ?? null,
      },
    });
    return count;
  }

  /** 운영 전환·롤백·예약 실행(§9.1) — 0 = 포인터가 이미 바뀜(CAS 실패 → 409 ENV_POINTER_STALE). */
  async switchProd(db: Db, input: SwitchProdInput): Promise<number> {
    const { count } = await db.chatbot.updateMany({
      where: { id: input.chatbotId, prodVersionId: input.expectedProdVersionId },
      data: { prodVersionId: input.versionId },
    });
    if (count === 0) return count;

    await db.environmentSwitchLog.create({
      data: {
        chatbotId: input.chatbotId,
        environment: 'PROD',
        method: input.method,
        fromVersionId: input.expectedProdVersionId,
        toVersionId: input.versionId,
        toVersionNo: input.versionNo,
        toVersionCapturedAt: input.versionCreatedAt,
        deployScheduleId: input.deployScheduleId ?? null,
        actorId: input.actor?.id ?? null,
        actorEmail: input.actor?.email ?? null,
        reason: input.reason ?? null,
        // [신규 No.36] 값이 있을 때만 키를 둔다(정책 꺼짐 = 현행 이력 행과 같은 모양).
        ...(input.approvalMode ? { approvalMode: input.approvalMode, approvalRequestId: input.approvalRequestId ?? null } : {}),
      },
    });
    return count;
  }

  /**
   * [신규 No.36] 운영 전환 2인 승인 정책(ai-guardrails-설계.md §10.2) — 모드 켜짐 여부와 무관하게 upsert(게이트 선례).
   * 켜기 조건(모드 켜짐 · 승인 가능자 ≥ 2)과 끄기 잠금은 호출 서비스가 검사한다.
   */
  async updateApprovalPolicy(db: Db, chatbotId: string, policy: { required: boolean; ttlHours: number }): Promise<void> {
    await db.chatbotEnvironment.upsert({
      where: { chatbotId },
      create: { chatbotId, approvalRequired: policy.required, approvalTtlHours: policy.ttlHours },
      update: { approvalRequired: policy.required, approvalTtlHours: policy.ttlHours },
    });
  }

  /** 게이트 설정(§10) — 모드 꺼진 챗봇도 저장 가능(켜면 적용). */
  async updateGate(chatbotId: string, gate: EnvironmentGateSettings): Promise<void> {
    await this.prisma.chatbotEnvironment.upsert({
      where: { chatbotId },
      create: {
        chatbotId,
        gateMode: gate.mode,
        gateTestSetId: gate.testSetId,
        gateMinPassRate: gate.minPassRate,
        gateValidHours: gate.validHours,
      },
      update: {
        gateMode: gate.mode,
        gateTestSetId: gate.testSetId,
        gateMinPassRate: gate.minPassRate,
        gateValidHours: gate.validHours,
      },
    });
  }
}
