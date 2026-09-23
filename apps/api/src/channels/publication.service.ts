import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CHANNEL_TYPE_LABELS } from '@chat-bot/shared-types';
import type { ChatbotStatus } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import type { ScheduledInvocation } from '../audit-logs/audit-log.service';
import { evaluateStatusTransition } from '../chatbots/lib/status-transition';
import { assertChannelEnableAllowed } from './lib/channel-enable-rule';
import { defaultChannelConfig } from './lib/channel-config';

export interface PublishResult {
  changed: boolean;
  statusBefore: ChatbotStatus;
  statusAfter: ChatbotStatus;
  channelBefore: boolean | null;
  channelAfter: boolean | null;
}

export interface SetWebChannelResult {
  changed: boolean;
  channelBefore: boolean | null;
  channelAfter: boolean;
}

/**
 * [신규 2026-09-23 No.28] `ChatbotPublicationService` — 공개 전환 원자 경로(scheduled-deploy-설계.md §5.4).
 * ADR-0011의 정의("공개 = 상태 ACTIVE AND WEB 채널 enabled")를 소유한다. `ChatbotsService.updateStatus()`·
 * `ChannelsService.upsert()`는 **호출하지 않는다**(둘 다 쓰기 직후 감사를 기록해 tx 인자를 못 받는다,
 * §5.4 판단 — 대신 두 서비스가 이미 쓰는 순수 함수를 호출만 해서 판정을 복제하지 않는다).
 * 운영 예약 배포 실행기(`PUBLISH`·`SET_WEB_CHANNEL`)와 (향후) 관리자 콘솔 "공개 시작" 원샷 액션이 쓴다.
 */
@Injectable()
export class ChatbotPublicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  private async assertNotArchived(tx: Prisma.TransactionClient, chatbotId: string) {
    const chatbot = await tx.chatbot.findUnique({ where: { id: chatbotId }, select: { status: true, name: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    if (chatbot.status === 'ARCHIVED') throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 공개 상태를 바꿀 수 없습니다.');
    return chatbot;
  }

  async publish(chatbotId: string, dto: { enableWebChannel: boolean }, invocation?: ScheduledInvocation): Promise<PublishResult> {
    const prefix = invocation?.auditSummaryPrefix ?? '';
    let statusBefore!: ChatbotStatus;
    let statusAfter!: ChatbotStatus;
    let channelBefore: boolean | null = null;
    let channelAfter: boolean | null = null;
    let statusChanged = false;
    let channelChanged = false;
    let channelWasCreated = false;
    let channelRowId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      const chatbot = await this.assertNotArchived(tx, chatbotId);
      statusBefore = chatbot.status as ChatbotStatus;
      statusAfter = statusBefore;

      const evaluation = evaluateStatusTransition(statusBefore, 'ACTIVE');
      if (evaluation.kind === 'denied') {
        throw new ApiException('INVALID_STATUS_TRANSITION', 400, `${statusBefore} 상태에서 ACTIVE 상태로 바꿀 수 없습니다.`);
      }

      const web = dto.enableWebChannel ? await tx.channel.findUnique({ where: { chatbotId_type: { chatbotId, type: 'WEB' } } }) : null;
      channelBefore = dto.enableWebChannel ? (web?.enabled ?? false) : null;
      const needChannel = dto.enableWebChannel === true && !(web?.enabled ?? false);

      if (evaluation.kind === 'noop' && !needChannel) return; // NOOP — 쓰기 0, 감사 0

      if (evaluation.kind === 'allowed') {
        await tx.chatbot.update({ where: { id: chatbotId }, data: { status: 'ACTIVE' } });
        statusAfter = 'ACTIVE';
        statusChanged = true;
      }

      if (needChannel) {
        assertChannelEnableAllowed('WEB', true);
        if (web) {
          await tx.channel.update({ where: { id: web.id }, data: { enabled: true } });
          channelRowId = web.id;
        } else {
          const created = await tx.channel.create({ data: { chatbotId, type: 'WEB', enabled: true, config: JSON.stringify(defaultChannelConfig('WEB')) } });
          channelRowId = created.id;
          channelWasCreated = true;
        }
        channelAfter = true;
        channelChanged = true;
      } else if (dto.enableWebChannel) {
        channelAfter = channelBefore;
      }
    });

    if (statusChanged) {
      await this.auditLogService.record({
        action: 'STATUS_CHANGE',
        targetType: 'Chatbot',
        targetId: chatbotId,
        chatbotId,
        before: { status: statusBefore },
        after: { status: statusAfter },
        summary: `${prefix}상태 변경: ${statusBefore} → ${statusAfter}`,
        ...(invocation ? { actorOverride: invocation.actor } : {}),
      });
    }
    if (channelChanged && channelRowId) {
      await this.auditLogService.record({
        action: channelWasCreated ? 'CREATE' : 'UPDATE',
        targetType: 'Channel',
        targetId: channelRowId,
        targetName: CHANNEL_TYPE_LABELS.WEB,
        chatbotId,
        before: { enabled: channelBefore ?? false },
        after: { enabled: true },
        summary: `${prefix}사용 여부 변경: ${channelBefore ?? false} → true`,
        ...(invocation ? { actorOverride: invocation.actor } : {}),
      });
    }

    return { changed: statusChanged || channelChanged, statusBefore, statusAfter, channelBefore, channelAfter };
  }

  async setWebChannel(chatbotId: string, enabled: boolean, invocation?: ScheduledInvocation): Promise<SetWebChannelResult> {
    const prefix = invocation?.auditSummaryPrefix ?? '';
    let channelBefore: boolean | null = null;
    let channelChanged = false;
    let channelWasCreated = false;
    let channelRowId: string | null = null;

    await this.prisma.$transaction(async (tx) => {
      await this.assertNotArchived(tx, chatbotId);
      const web = await tx.channel.findUnique({ where: { chatbotId_type: { chatbotId, type: 'WEB' } } });
      channelBefore = web?.enabled ?? false;

      if (channelBefore === enabled) return; // NOOP(행 없음 + false도 NOOP)

      assertChannelEnableAllowed('WEB', enabled);
      if (web) {
        await tx.channel.update({ where: { id: web.id }, data: { enabled } });
        channelRowId = web.id;
      } else {
        const created = await tx.channel.create({ data: { chatbotId, type: 'WEB', enabled, config: JSON.stringify(defaultChannelConfig('WEB')) } });
        channelRowId = created.id;
        channelWasCreated = true;
      }
      channelChanged = true;
    });

    if (channelChanged && channelRowId) {
      await this.auditLogService.record({
        action: channelWasCreated ? 'CREATE' : 'UPDATE',
        targetType: 'Channel',
        targetId: channelRowId,
        targetName: CHANNEL_TYPE_LABELS.WEB,
        chatbotId,
        before: { enabled: channelBefore ?? false },
        after: { enabled },
        summary: `${prefix}사용 여부 변경: ${channelBefore ?? false} → ${enabled}`,
        ...(invocation ? { actorOverride: invocation.actor } : {}),
      });
    }

    return { changed: channelChanged, channelBefore, channelAfter: enabled };
  }
}
