import { Injectable } from '@nestjs/common';
import type { ProactiveSettingsInput } from '@chat-bot/shared-types';
import { PROACTIVE_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';

export interface ProactiveSettingsView {
  enabled: boolean;
  maxPerSession: number;
  minIntervalSec: number;
  quietAfterUserMessageSec: number;
  updatedAt: Date | null;
}

const DEFAULT_VIEW: ProactiveSettingsView = {
  enabled: false,
  maxPerSession: PROACTIVE_LIMITS.maxPerSessionDefault,
  minIntervalSec: PROACTIVE_LIMITS.minIntervalSecDefault,
  quietAfterUserMessageSec: PROACTIVE_LIMITS.quietAfterUserMessageSecDefault,
  updatedAt: null,
};

type SettingRow = { enabled: boolean; maxPerSession: number; minIntervalSec: number; quietAfterUserMessageSec: number; updatedAt: Date };

function toView(row: SettingRow | null): ProactiveSettingsView {
  if (!row) return DEFAULT_VIEW;
  return {
    enabled: row.enabled,
    maxPerSession: row.maxPerSession,
    minIntervalSec: row.minIntervalSec,
    quietAfterUserMessageSec: row.quietAfterUserMessageSec,
    updatedAt: row.updatedAt,
  };
}

function buildSettingsSummary(before: ProactiveSettingsView, after: ProactiveSettingsView): string {
  const parts: string[] = [];
  if (before.enabled !== after.enabled) parts.push(`사용 ${before.enabled} → ${after.enabled}`);
  if (before.maxPerSession !== after.maxPerSession) parts.push(`세션당 최대 ${before.maxPerSession} → ${after.maxPerSession}`);
  if (before.minIntervalSec !== after.minIntervalSec) parts.push(`최소 간격 ${before.minIntervalSec}초 → ${after.minIntervalSec}초`);
  if (before.quietAfterUserMessageSec !== after.quietAfterUserMessageSec) {
    parts.push(`조용한 시간 ${before.quietAfterUserMessageSec}초 → ${after.quietAfterUserMessageSec}초`);
  }
  return `선제 안내 설정 변경: ${parts.join(' · ')}`;
}

/**
 * [신규 No.35] ★ `ChatbotProactiveSetting` 쓰기 유일 파일(+ `chatbots.service.ts` 영구삭제 동반 삭제만
 * 예외, PA-2). 값이 같으면 감사를 남기지 않는다(§9.1 ②). 스위치 변경은 `UPDATE Chatbot`으로 기록한다
 * (`AUDIT_FIELDS.Chatbot` + `'proactive'`, ADR-0045 §10).
 */
@Injectable()
export class ProactiveSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
  ) {}

  async get(chatbotId: string): Promise<ProactiveSettingsView> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.prisma.chatbotProactiveSetting.findUnique({ where: { chatbotId } });
    return toView(row);
  }

  async update(chatbotId: string, dto: ProactiveSettingsInput, actorId: string | null): Promise<ProactiveSettingsView> {
    const { name } = await this.scope.assertWritable(chatbotId);
    const before = await this.prisma.chatbotProactiveSetting.findUnique({ where: { chatbotId } });
    const beforeView = toView(before);

    const unchanged =
      beforeView.enabled === dto.enabled &&
      beforeView.maxPerSession === dto.maxPerSession &&
      beforeView.minIntervalSec === dto.minIntervalSec &&
      beforeView.quietAfterUserMessageSec === dto.quietAfterUserMessageSec;

    const row = await this.prisma.chatbotProactiveSetting.upsert({
      where: { chatbotId },
      create: {
        chatbotId,
        enabled: dto.enabled,
        maxPerSession: dto.maxPerSession,
        minIntervalSec: dto.minIntervalSec,
        quietAfterUserMessageSec: dto.quietAfterUserMessageSec,
        updatedById: actorId,
      },
      update: {
        enabled: dto.enabled,
        maxPerSession: dto.maxPerSession,
        minIntervalSec: dto.minIntervalSec,
        quietAfterUserMessageSec: dto.quietAfterUserMessageSec,
        updatedById: actorId,
      },
    });
    const afterView = toView(row);

    if (!unchanged) {
      await this.auditLog.record({
        action: 'UPDATE',
        targetType: 'Chatbot',
        targetId: chatbotId,
        targetName: name,
        chatbotId,
        before: { proactive: beforeView },
        after: { proactive: afterView },
        summary: buildSettingsSummary(beforeView, afterView),
      });
    }

    return afterView;
  }
}
