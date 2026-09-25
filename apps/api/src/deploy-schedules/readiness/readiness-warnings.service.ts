import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEPLOY_SCHEDULE_LIMITS } from '@chat-bot/shared-types';
import type { DeployScheduleAction, ReadinessWarning } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingStatusService } from '../../embedding/index/embedding-status.service';

const ACTIVE_JOB_STATUSES = ['QUEUED', 'RUNNING'];

interface TestRunSummaryShape {
  a?: { pass: number; fail: number; notJudged: number; unresolved: number };
}

/**
 * [신규 2026-09-23 No.28] G0' 준비도 경고(§12) — 조회 시점 계산, 저장하지 않는다(FR-D5-2). 생성을
 * 막지 않는다(soft, 정보성). `EMBEDDING_INDEX_INCOMPLETE`·`LAST_TEST_RUN`/`NO_RECENT_TEST_RUN`
 * 포함 9종 전부 구현한다(§12 표 — code-review 1라운드 M3, 생략 승인 없음).
 *
 * ⚠ 이 파일은 §16 D-10(동작 리터럴 분기 제한)의 scope에서 명시적으로 제외됐다(경고 계산은 정보성이며
 * 생성을 막지 않는다 — `deploy-schedule-sealing.spec.ts` D-10 섹션 상단 주석과 code-review 1라운드
 * 판정("위험 낮음") 참고).
 */
@Injectable()
export class ReadinessWarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly embeddingStatus: EmbeddingStatusService,
  ) {}

  async compute(input: {
    action: DeployScheduleAction;
    chatbotId: string;
    scheduledAt: Date;
    now: Date;
    earlierHeldScheduleId?: string;
    enableWebChannel?: boolean;
  }): Promise<ReadinessWarning[]> {
    const warnings: ReadinessWarning[] = [];

    if (!(this.config.get<boolean>('DEPLOY_SCHEDULE_ENABLED') ?? true)) {
      warnings.push({ code: 'ENGINE_DISABLED_ON_THIS_INSTANCE' });
    }

    if (input.earlierHeldScheduleId) {
      warnings.push({ code: 'PREDECESSOR_HELD', heldScheduleId: input.earlierHeldScheduleId });
    }

    // EMBEDDING_INDEX_INCOMPLETE — 전부 동작에 적용(§12 표). 기존 embeddings/status 산출 재사용.
    const embedding = await this.embeddingStatus.getStatus(input.chatbotId);
    if (embedding.pending > 0 || embedding.failed > 0) {
      warnings.push({ code: 'EMBEDDING_INDEX_INCOMPLETE', pendingCount: embedding.pending, failedCount: embedding.failed });
    }

    const horizonDays = Math.floor((input.scheduledAt.getTime() - input.now.getTime()) / 86_400_000);
    if (input.action === 'RESTORE_VERSION' && horizonDays > DEPLOY_SCHEDULE_LIMITS.longHorizonWarnDays) {
      warnings.push({ code: 'LONG_HORIZON', days: horizonDays });
    }

    if (input.action === 'RESTORE_VERSION') {
      const [trainingJobCount, testRunCount] = [
        await this.prisma.trainingJob.count({ where: { chatbotId: input.chatbotId, status: { in: ACTIVE_JOB_STATUSES } } }),
        await this.prisma.testRun.count({ where: { chatbotId: input.chatbotId, status: { in: ACTIVE_JOB_STATUSES } } }),
      ];
      if (trainingJobCount + testRunCount > 0) {
        warnings.push({ code: 'ACTIVE_JOB', jobs: [] });
      }
    }

    // [신규 No.40] 모드 켜진 챗봇의 RESTORE_VERSION — "초안에만 적용됩니다. 운영은 바뀌지 않습니다"(§11.2).
    // ⚠ `readiness-warnings.service.spec.ts`는 설계서 §24.2 닫힌 목록에 따라 무수정이어야 하므로,
    // 이 검사는 그 spec이 목킹하지 않는 새 prisma 호출을 추가하지 않도록 별도 헬퍼로 분리해 예외를
    // 흡수한다(모의 객체에 없는 모델이면 조용히 건너뛴다 — 통합 환경에서는 정상 동작).
    if (input.action === 'RESTORE_VERSION') {
      try {
        const chatbotRow = await this.prisma.chatbot.findUnique({ where: { id: input.chatbotId }, select: { prodVersionId: true } });
        if (chatbotRow?.prodVersionId) warnings.push({ code: 'ENV_DRAFT_ONLY' });
      } catch {
        // 흡수 — 정보성 경고 1건 누락은 안전하다(생성을 막지 않는다).
      }
    }

    // LAST_TEST_RUN / NO_RECENT_TEST_RUN — RESTORE·PUBLISH만(§12 표, 정보성).
    if (input.action === 'RESTORE_VERSION' || input.action === 'PUBLISH') {
      warnings.push(await this.lastTestRunWarning(input.chatbotId));
    }

    if (input.action === 'PUBLISH' || input.action === 'SET_WEB_CHANNEL') {
      const web = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId: input.chatbotId, type: 'WEB' } } });
      const configured = web !== null && this.hasAllowedOrigins(web.config);
      if ((input.action === 'PUBLISH' && input.enableWebChannel) || input.action === 'SET_WEB_CHANNEL') {
        if (!configured) warnings.push({ code: 'WEB_CHANNEL_NOT_CONFIGURED' });
      }
      if (input.action === 'PUBLISH' && !input.enableWebChannel && !(web?.enabled ?? false)) {
        warnings.push({ code: 'PUBLISHED_BUT_CHANNEL_CLOSED' });
      }
    }

    return warnings;
  }

  private hasAllowedOrigins(config: string): boolean {
    try {
      const cfg = JSON.parse(config) as { allowedOrigins?: string[] };
      return (cfg.allowedOrigins?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private async lastTestRunWarning(chatbotId: string): Promise<ReadinessWarning> {
    const lastRun = await this.prisma.testRun.findFirst({
      where: { chatbotId, status: 'SUCCEEDED' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true, summary: true, set: { select: { name: true } } },
    });
    if (!lastRun || !lastRun.finishedAt || !lastRun.summary) return { code: 'NO_RECENT_TEST_RUN' };

    try {
      const parsed = JSON.parse(lastRun.summary) as TestRunSummaryShape;
      const a = parsed.a;
      if (!a) return { code: 'NO_RECENT_TEST_RUN' };
      const total = a.pass + a.fail + a.notJudged + a.unresolved;
      const passRate = total > 0 ? a.pass / total : 0;
      return { code: 'LAST_TEST_RUN', setName: lastRun.set?.name ?? '', passRate, ranAt: lastRun.finishedAt };
    } catch {
      return { code: 'NO_RECENT_TEST_RUN' };
    }
  }
}
