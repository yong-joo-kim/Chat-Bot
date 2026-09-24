import type { HandoffSettings } from '@chat-bot/shared-types';

/** Prisma `ChatbotHandoffSetting` 행(또는 null) → DTO. 행이 없으면 스키마 기본값(전부 꺼짐)이다. */
export function toHandoffSettingsDto(chatbotId: string, row: HandoffSettingRow | null): HandoffSettings {
  if (!row) return defaultHandoffSettings(chatbotId);
  return {
    chatbotId: row.chatbotId,
    enabled: row.enabled,
    draining: row.draining,
    cautionThreshold: row.cautionThreshold,
    warningThreshold: row.warningThreshold,
    activeWindowMinutes: row.activeWindowMinutes,
    userIdleMinutes: row.userIdleMinutes,
    agentNoReplyMinutes: row.agentNoReplyMinutes,
    connectNotice: row.connectNotice,
    endNotice: row.endNotice,
    failNotice: row.failNotice,
    endButtonLabel: row.endButtonLabel,
    endButtonNodeId: row.endButtonNodeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface HandoffSettingRow {
  chatbotId: string;
  enabled: boolean;
  draining: boolean;
  cautionThreshold: number;
  warningThreshold: number;
  activeWindowMinutes: number;
  userIdleMinutes: number;
  agentNoReplyMinutes: number;
  connectNotice: string;
  endNotice: string;
  failNotice: string;
  endButtonLabel: string | null;
  endButtonNodeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function defaultHandoffSettings(chatbotId: string): HandoffSettings {
  const now = new Date(0);
  return {
    chatbotId,
    enabled: false,
    draining: false,
    cautionThreshold: 2,
    warningThreshold: 3,
    activeWindowMinutes: 10,
    userIdleMinutes: 10,
    agentNoReplyMinutes: 5,
    connectNotice: '상담원이 연결되었어요. 잠시만 기다려 주세요.',
    endNotice: '상담이 종료되었어요. 이제 챗봇이 도와드릴게요.',
    failNotice: '지금은 상담원 연결이 어려워요. 챗봇이 계속 도와드릴게요.',
    endButtonLabel: null,
    endButtonNodeId: null,
    createdAt: now,
    updatedAt: now,
  };
}
