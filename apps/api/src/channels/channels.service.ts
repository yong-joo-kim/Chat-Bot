import { Injectable } from '@nestjs/common';
import { CHANNEL_IMPLEMENTATION, CHANNEL_TYPE_LABELS } from '@chat-bot/shared-types';
import type { ChannelListItem, ChannelType, UpdateChannelDto } from '@chat-bot/shared-types';
import { channelConfigSchemaFor } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { buildChannelCatalog, toChannelListItem } from './lib/channel-catalog';
import { defaultChannelConfig, parseChannelConfig } from './lib/channel-config';

/**
 * 채널 배포 설정(No.11 J-2). 자격증명은 저장하지 않는다(NFR-S7).
 * 활성화(`enabled=true`)는 `IMPLEMENTED` 채널(WEB)에만 허용한다(FR-11-4, ADR-0011).
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(chatbotId: string): Promise<{ items: ChannelListItem[] }> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.channel.findMany({ where: { chatbotId } });
    return { items: buildChannelCatalog(rows) };
  }

  async upsert(chatbotId: string, type: ChannelType, dto: UpdateChannelDto): Promise<ChannelListItem> {
    await this.scope.assertWritable(chatbotId);

    if (dto.enabled === true && CHANNEL_IMPLEMENTATION[type] !== 'IMPLEMENTED') {
      throw new ApiException(
        'CHANNEL_NOT_IMPLEMENTED',
        409,
        '이 채널은 아직 연동을 제공하지 않습니다. 설정만 미리 저장할 수 있습니다.',
      );
    }

    const existing = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId, type } } });

    let configValue = existing ? parseChannelConfig(type, existing.config) : defaultChannelConfig(type);

    if (dto.config !== undefined) {
      const parsed = channelConfigSchemaFor(type).safeParse(dto.config);
      if (!parsed.success) {
        throw new ApiException(
          'VALIDATION_FAILED',
          400,
          '채널 설정 값을 확인해 주세요.',
          parsed.error.issues.map((issue) => ({ field: issue.path.join('.') || '(root)', message: issue.message })),
        );
      }
      configValue = parsed.data;
    }

    const enabled = dto.enabled !== undefined ? dto.enabled : (existing?.enabled ?? false);
    const serializedConfig = JSON.stringify(configValue);

    const row = existing
      ? await this.prisma.channel.update({ where: { id: existing.id }, data: { enabled, config: serializedConfig } })
      : await this.prisma.channel.create({ data: { chatbotId, type, enabled, config: serializedConfig } });

    // 채널은 상태 머신이 아니다 — enabled 변화도 STATUS_CHANGE가 아니라 UPDATE + summary로 표기한다(§9.5).
    await this.auditLogService.record({
      action: existing ? 'UPDATE' : 'CREATE',
      targetType: 'Channel',
      targetId: row.id,
      targetName: CHANNEL_TYPE_LABELS[type],
      chatbotId,
      before: existing ?? undefined,
      after: row,
      ...(existing && existing.enabled !== row.enabled ? { summary: `사용 여부 변경: ${existing.enabled} → ${row.enabled}` } : {}),
    });

    return toChannelListItem(type, row);
  }

  /** 참조 제약이 없다. 삭제 = 설정 초기화이며, 레코드 부재는 이미 초기화된 상태이므로 멱등 204다(FR-11-11). */
  async remove(chatbotId: string, type: ChannelType): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const existing = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId, type } } });
    if (!existing) return;
    await this.prisma.channel.delete({ where: { id: existing.id } });
    await this.auditLogService.record({
      action: 'DELETE',
      targetType: 'Channel',
      targetId: existing.id,
      targetName: CHANNEL_TYPE_LABELS[type],
      chatbotId,
      before: existing,
    });
  }
}
