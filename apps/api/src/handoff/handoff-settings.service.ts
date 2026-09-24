import { Injectable } from '@nestjs/common';
import type { HandoffSettings, UpdateHandoffSettingsDto } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { toHandoffSettingsDto } from './handoff.mapper';

/**
 * `ChatbotHandoffSetting` 쓰기 유일 파일(§3.1) — PUT 전체 교체 · draining · 감사 · 캐시 무효화.
 */
@Injectable()
export class HandoffSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly cache: HandoffSettingsCacheService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getSettings(chatbotId: string): Promise<HandoffSettings> {
    await this.scope.assertReadable(chatbotId);
    return this.cache.get(chatbotId);
  }

  async updateSettings(chatbotId: string, dto: UpdateHandoffSettingsDto): Promise<HandoffSettings> {
    await this.scope.assertWritable(chatbotId);

    if (dto.endButtonNodeId) {
      const node = await this.prisma.dialogNode.findFirst({ where: { id: dto.endButtonNodeId, chatbotId }, select: { id: true } });
      if (!node) throw new ApiException('INVALID_REFERENCE', 404, '종료 후 버튼 노드를 찾을 수 없습니다.');
    }

    const before = await this.prisma.chatbotHandoffSetting.findUnique({ where: { chatbotId } });

    // 켠 상태에서 껐는데 활성 상담이 있으면 draining=true로 유지한다(FR-CS1-4) — 활성 0건이 되면
    // 정리 루프가 false로 되돌린다(handoff-sweeper.service.ts).
    let draining = before?.draining ?? false;
    if (before?.enabled && !dto.enabled) {
      const activeCount = await this.prisma.handoffSession.count({ where: { chatbotId, status: { in: ['CONNECTING', 'CONNECTED'] } } });
      draining = activeCount > 0;
    } else if (dto.enabled) {
      draining = false;
    }

    const data = {
      enabled: dto.enabled,
      draining,
      cautionThreshold: dto.cautionThreshold,
      warningThreshold: dto.warningThreshold,
      activeWindowMinutes: dto.activeWindowMinutes,
      userIdleMinutes: dto.userIdleMinutes,
      agentNoReplyMinutes: dto.agentNoReplyMinutes,
      connectNotice: dto.connectNotice,
      endNotice: dto.endNotice,
      failNotice: dto.failNotice,
      endButtonLabel: dto.endButtonLabel ?? null,
      endButtonNodeId: dto.endButtonNodeId ?? null,
    };

    const row = await this.prisma.chatbotHandoffSetting.upsert({
      where: { chatbotId },
      create: { chatbotId, ...data },
      update: data,
    });

    this.cache.invalidate(chatbotId);

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'Chatbot',
      targetId: chatbotId,
      chatbotId,
      before: before ?? undefined,
      after: row,
      summary: '상담 연계 설정 변경',
    });

    return toHandoffSettingsDto(chatbotId, row);
  }

  /** 정리 루프 전용 — draining인데 활성 상담이 0건이 된 챗봇을 되돌린다(§8.6 ⑤). */
  async clearDrainingIfIdle(chatbotId: string): Promise<void> {
    const activeCount = await this.prisma.handoffSession.count({ where: { chatbotId, status: { in: ['CONNECTING', 'CONNECTED'] } } });
    if (activeCount > 0) return;
    const updated = await this.prisma.chatbotHandoffSetting.updateMany({ where: { chatbotId, draining: true }, data: { draining: false } });
    if (updated.count > 0) this.cache.invalidate(chatbotId);
  }
}
