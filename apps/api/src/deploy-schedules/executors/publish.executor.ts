import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PublishParamsSchema } from '@chat-bot/shared-types';
import type { ChatbotStatus, Permission, PublishParams } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import type { ScheduledInvocation } from '../../audit-logs/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatbotPublicationService } from '../../channels/publication.service';
import { requiredPermissions } from '../lib/required-permissions';
import { hasActivePublish } from '../lib/chain-rules';
import { classifyExecutionError } from '../lib/outcome-classifier';
import { buildPublishSummary } from '../lib/result-summary';
import { judgePublishRecovery } from '../lib/recovery-judge';
import type {
  ActionPreviewResult,
  DeployActionExecutor,
  DerivedFields,
  ExecutionContext,
  ExecutionOutcome,
  InsertContext,
  PreviewContext,
  RecoveryContext,
  RecoveryVerdictOutcome,
} from './deploy-action-executor';

/** [신규 2026-09-23 No.28] `PUBLISH` 실행기 — `ChatbotPublicationService.publish()`만 호출한다(§5.4). */
@Injectable()
export class PublishExecutor implements DeployActionExecutor<'PUBLISH'> {
  readonly action = 'PUBLISH' as const;
  readonly paramsSchema = PublishParamsSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publication: ChatbotPublicationService,
  ) {}

  requiredPermissions(params: PublishParams): Permission[] {
    return requiredPermissions('PUBLISH', params);
  }

  async preview(ctx: PreviewContext<'PUBLISH'>): Promise<ActionPreviewResult> {
    const web = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId: ctx.chatbotId, type: 'WEB' } } });
    const preconditionFailures: ActionPreviewResult['preconditionFailures'] = [];
    if (ctx.chatbotStatus === 'ACTIVE') preconditionFailures.push({ code: 'ALREADY_ACTIVE' });
    if (hasActivePublish(ctx.activeSiblingActions.map((action) => ({ action })))) preconditionFailures.push({ code: 'DUPLICATE_PUBLISH' });

    return {
      preconditionFailures,
      publish: { currentStatus: ctx.chatbotStatus, webChannelConfigured: Boolean(web), webChannelEnabled: web?.enabled ?? false },
    };
  }

  async resolveForInsert(tx: Prisma.TransactionClient, ctx: InsertContext<'PUBLISH'>): Promise<DerivedFields> {
    const chatbot = await tx.chatbot.findUnique({ where: { id: ctx.chatbotId }, select: { status: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    if (chatbot.status !== 'DRAFT') {
      throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '초안 상태의 챗봇만 공개 시작을 예약할 수 있습니다.', [
        { field: 'precondition', message: 'ALREADY_ACTIVE' },
      ]);
    }
    if (hasActivePublish(ctx.activeSiblingActions.map((action) => ({ action })))) {
      throw new ApiException('DEPLOY_SCHEDULE_PRECONDITION_FAILED', 409, '이미 공개 시작 예약이 있습니다.', [
        { field: 'precondition', message: 'DUPLICATE_PUBLISH' },
      ]);
    }
    return {};
  }

  async execute(ctx: ExecutionContext<'PUBLISH'>): Promise<ExecutionOutcome> {
    const invocation: ScheduledInvocation = {
      actor: { id: ctx.actor.id, email: ctx.actor.email, role: ctx.actor.role },
      auditSummaryPrefix: ctx.auditSummaryPrefix,
    };
    try {
      const result = await this.publication.publish(ctx.chatbotId, { enableWebChannel: ctx.params.enableWebChannel }, invocation);
      const summary = buildPublishSummary({
        statusBefore: result.statusBefore,
        statusAfter: result.statusAfter,
        channelBefore: result.channelBefore,
        channelAfter: result.channelAfter,
      });
      return { kind: result.changed ? 'APPLIED' : 'NOOP', summary };
    } catch (e) {
      return classifyExecutionError(e);
    }
  }

  async judgeRecovery(ctx: RecoveryContext<'PUBLISH'>): Promise<RecoveryVerdictOutcome> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: ctx.chatbotId }, select: { status: true } });
    const web = ctx.params.enableWebChannel
      ? await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId: ctx.chatbotId, type: 'WEB' } } })
      : null;
    const statusIsActive = chatbot?.status === 'ACTIVE';
    const channelSatisfied = !ctx.params.enableWebChannel || (web?.enabled ?? false);
    const verdict = judgePublishRecovery(statusIsActive, channelSatisfied);
    if (verdict.kind === 'RECOVERED') {
      return {
        kind: 'RECOVERED',
        summary: buildPublishSummary({
          statusBefore: 'DRAFT',
          statusAfter: (chatbot?.status ?? 'DRAFT') as ChatbotStatus,
          channelBefore: null,
          channelAfter: web?.enabled ?? null,
        }),
      };
    }
    return { kind: 'INTERRUPTED' };
  }
}
