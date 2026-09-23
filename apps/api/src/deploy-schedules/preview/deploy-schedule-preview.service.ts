import { Inject, Injectable } from '@nestjs/common';
import { DEPLOY_SCHEDULE_ACTIVE_STATUSES, checkScheduleTimeRules } from '@chat-bot/shared-types';
import type { DeploySchedulePreviewResponse, PreviewDeployScheduleDto } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { CLOCK } from '../../common/polling/clock';
import type { Clock } from '../../common/polling/clock';
import { ExecutorRegistry } from '../executors/executor.registry';
import { ReadinessWarningsService } from '../readiness/readiness-warnings.service';

const ACTIVE = [...DEPLOY_SCHEDULE_ACTIVE_STATUSES];

/**
 * [신규 2026-09-23 No.28] `POST …/deploy-schedules/preview`(§6.1) — 쓰기 0. 체인 기준 결정을
 * 서버가 소유한다(FR-D2-2). 생성 서비스(`deploy-schedule.service.ts`)의 사전 검증도 이 서비스를 재사용한다.
 */
@Injectable()
export class DeploySchedulePreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ExecutorRegistry,
    private readonly readiness: ReadinessWarningsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async preview(chatbotId: string, dto: PreviewDeployScheduleDto): Promise<DeploySchedulePreviewResponse> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');

    // 재개(HELD→PENDING) 미리보기 자기충돌 방지(code-review 2라운드 H-1) — excludeScheduleId가
    // 이 챗봇 소속이 아니면(교차 챗봇·오탈자·이미 삭제 등) 404로 거부한다(존재 노출 금지 규약과 동일).
    if (dto.excludeScheduleId) {
      const excluded = await this.prisma.deploySchedule.findUnique({ where: { id: dto.excludeScheduleId }, select: { chatbotId: true } });
      if (!excluded || excluded.chatbotId !== chatbotId) {
        throw new ApiException('NOT_FOUND', 404, '재개 대상 예약을 찾을 수 없습니다.');
      }
    }

    const now = this.clock.now();
    const activeRows = await this.prisma.deploySchedule.findMany({
      where: {
        chatbotId,
        status: { in: ACTIVE },
        ...(dto.excludeScheduleId ? { id: { not: dto.excludeScheduleId } } : {}),
      },
      select: { id: true, action: true, status: true, scheduledAt: true, targetContentHash: true },
    });

    const timeViolations = checkScheduleTimeRules({
      scheduledAt: dto.scheduledAt,
      now,
      otherActiveTimes: activeRows.map((r) => r.scheduledAt),
    }).map((v) => ({ rule: v.rule }));

    const earliestHeld = activeRows.filter((r) => r.status === 'HELD').sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];

    // dto(판별 유니온)는 동작별 필요 필드를 이미 포함한 상위집합이다 — paramsSchema.parse가 나머지를
    // strip한다. `dto.action`으로 분기하지 않는다(§16 D-10 — 분기는 레지스트리 1곳뿐).
    const executor = this.registry.get(dto.action);
    const params = executor.paramsSchema.parse(dto);

    const actionPreview = await executor.preview({
      chatbotId,
      chatbotStatus: chatbot.status as never,
      scheduledAt: dto.scheduledAt,
      params: params as never,
      now,
      activeRestoreSiblings: activeRows.filter((r) => r.action === 'RESTORE_VERSION').map((r) => ({ id: r.id, scheduledAt: r.scheduledAt, targetContentHash: r.targetContentHash })),
      earlierActivePublishExists: activeRows.some((r) => r.action === 'PUBLISH' && r.scheduledAt.getTime() < dto.scheduledAt.getTime()),
      activeSiblingActions: activeRows.map((r) => r.action as never),
    });

    const readinessWarnings = await this.readiness.compute({
      action: dto.action,
      chatbotId,
      scheduledAt: dto.scheduledAt,
      now,
      earlierHeldScheduleId: earliestHeld?.id,
      enableWebChannel: 'enableWebChannel' in dto ? dto.enableWebChannel : undefined,
    });

    const blockersEmpty = !actionPreview.restore || actionPreview.restore.blockers.length === 0;
    const creatable = actionPreview.preconditionFailures.length === 0 && timeViolations.length === 0 && blockersEmpty;

    return {
      creatable,
      preconditionFailures: actionPreview.preconditionFailures,
      timeViolations,
      readinessWarnings,
      restore: actionPreview.restore,
      publish: actionPreview.publish,
      setWebChannel: actionPreview.setWebChannel,
    };
  }
}
