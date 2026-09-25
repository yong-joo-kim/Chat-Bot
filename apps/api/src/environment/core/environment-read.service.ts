import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentGateSettings } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { computeEnvironmentProtectedIds } from '../../versions/lib/environment-protected-versions';

export interface PointerStatus {
  prodVersionId: string | null;
  stagingVersionId: string | null;
  enabledAt: Date | null;
  gate: EnvironmentGateSettings;
}

const ENV_PROD_HISTORY_PROTECTED_DEFAULT = 5;

/**
 * [신규 No.40] 읽기 전용 조회(§2.1) — 상태 조회 · 보호 버전 집합(§13.2) · 게이트 입력 조회.
 * `EnvironmentCoreModule`이 export하는 2개 중 하나.
 */
@Injectable()
export class EnvironmentReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getPointerStatus(chatbotId: string): Promise<PointerStatus> {
    const [chatbot, env] = await Promise.all([
      this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { prodVersionId: true } }),
      this.prisma.chatbotEnvironment.findUnique({ where: { chatbotId } }),
    ]);
    return {
      prodVersionId: chatbot?.prodVersionId ?? null,
      stagingVersionId: env?.stagingVersionId ?? null,
      enabledAt: env?.enabledAt ?? null,
      gate: {
        mode: (env?.gateMode as EnvironmentGateSettings['mode']) ?? 'WARN',
        testSetId: env?.gateTestSetId ?? null,
        minPassRate: env?.gateMinPassRate ?? 95,
        validHours: env?.gateValidHours ?? 24,
      },
    };
  }

  /** PROD 이력을 `createdAt desc`로. */
  async getProdHistoryDesc(chatbotId: string, take = 50): Promise<Array<{ id: string; fromVersionId: string | null; toVersionId: string | null; toVersionCapturedAt: Date | null; createdAt: Date }>> {
    return this.prisma.environmentSwitchLog.findMany({
      where: { chatbotId, environment: 'PROD' },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, fromVersionId: true, toVersionId: true, toVersionCapturedAt: true, createdAt: true },
    });
  }

  /** §13.2 — 보존 정리·삭제 보호 집합(포인터 ∪ 운영 이력 최근 N). */
  async computeProtectedIds(chatbotId: string, historyN?: number): Promise<Set<string>> {
    const n = historyN ?? this.config.get<number>('ENV_PROD_HISTORY_PROTECTED') ?? ENV_PROD_HISTORY_PROTECTED_DEFAULT;
    const [pointer, historyDesc] = await Promise.all([this.getPointerStatus(chatbotId), this.getProdHistoryDesc(chatbotId)]);
    return computeEnvironmentProtectedIds({
      prodVersionId: pointer.prodVersionId,
      stagingVersionId: pointer.stagingVersionId,
      prodHistoryDesc: historyDesc,
      historyN: n,
    });
  }
}
