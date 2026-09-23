import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { SetWebChannelParamsSchema } from '@chat-bot/shared-types';
import type { Permission, SetWebChannelParams } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import type { ScheduledInvocation } from '../../audit-logs/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatbotPublicationService } from '../../channels/publication.service';
import { requiredPermissions } from '../lib/required-permissions';
import { classifyExecutionError } from '../lib/outcome-classifier';
import { buildSetWebChannelSummary } from '../lib/result-summary';
import { judgeSetWebChannelRecovery } from '../lib/recovery-judge';
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

/** [신규 2026-09-23 No.28] `SET_WEB_CHANNEL` 실행기 — `ChatbotPublicationService.setWebChannel()`만 호출한다(§5.5). */
@Injectable()
export class SetWebChannelExecutor implements DeployActionExecutor<'SET_WEB_CHANNEL'> {
  readonly action = 'SET_WEB_CHANNEL' as const;
  readonly paramsSchema = SetWebChannelParamsSchema;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publication: ChatbotPublicationService,
  ) {}

  requiredPermissions(params: SetWebChannelParams): Permission[] {
    return requiredPermissions('SET_WEB_CHANNEL', params);
  }

  async preview(ctx: PreviewContext<'SET_WEB_CHANNEL'>): Promise<ActionPreviewResult> {
    const web = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId: ctx.chatbotId, type: 'WEB' } } });
    return { preconditionFailures: [], setWebChannel: { currentEnabled: web?.enabled ?? false } };
  }

  async resolveForInsert(tx: Prisma.TransactionClient, ctx: InsertContext<'SET_WEB_CHANNEL'>): Promise<DerivedFields> {
    const chatbot = await tx.chatbot.findUnique({ where: { id: ctx.chatbotId }, select: { status: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    if (chatbot.status === 'ARCHIVED') {
      throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 채널 예약을 만들 수 없습니다.');
    }
    return {};
  }

  async execute(ctx: ExecutionContext<'SET_WEB_CHANNEL'>): Promise<ExecutionOutcome> {
    const invocation: ScheduledInvocation = {
      actor: { id: ctx.actor.id, email: ctx.actor.email, role: ctx.actor.role },
      auditSummaryPrefix: ctx.auditSummaryPrefix,
    };
    try {
      const result = await this.publication.setWebChannel(ctx.chatbotId, ctx.params.enabled, invocation);
      return { kind: result.changed ? 'APPLIED' : 'NOOP', summary: buildSetWebChannelSummary(result.channelBefore, result.channelAfter) };
    } catch (e) {
      return classifyExecutionError(e);
    }
  }

  async judgeRecovery(ctx: RecoveryContext<'SET_WEB_CHANNEL'>): Promise<RecoveryVerdictOutcome> {
    const web = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId: ctx.chatbotId, type: 'WEB' } } });
    const currentEnabled = web?.enabled ?? false;
    const verdict = judgeSetWebChannelRecovery(currentEnabled, ctx.params.enabled);
    if (verdict.kind === 'RECOVERED') {
      return { kind: 'RECOVERED', summary: buildSetWebChannelSummary(currentEnabled, ctx.params.enabled) };
    }
    return { kind: 'INTERRUPTED' };
  }
}
