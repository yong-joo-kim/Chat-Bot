import { Injectable } from '@nestjs/common';
import { ROLE_PERMISSIONS } from '@chat-bot/shared-types';
import type { TranscriptEntry, TranscriptQuery, TranscriptResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import type { SessionUser } from '../common/auth/session-context';
import { SessionRefResolverService } from './session-ref-resolver.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { canViewRaw } from './lib/raw-visibility';
import { decodeTranscriptCursor, encodeTranscriptCursor } from './lib/transcript-cursor';
import { computeSessionRef, assignAliases } from './lib/session-ref';

const PAGE = 200;

/**
 * 대화 보기(FR-CS3-*, §11) — ★ 원문 노출 유일 출구. 봇 구간(`ConversationLog`, `handoffTurn=false`)과
 * 상담 구간(`HandoffMessage`)을 시각순으로 병합한다.
 */
@Injectable()
export class HandoffTranscriptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly resolver: SessionRefResolverService,
    private readonly auditLog: AuditLogService,
    private readonly settingsCache: HandoffSettingsCacheService,
  ) {}

  async getTranscript(chatbotId: string, sessionRef: string, viewer: SessionUser, query: TranscriptQuery): Promise<TranscriptResponse> {
    await this.scope.assertReadable(chatbotId);
    const sessionId = await this.resolver.resolve(chatbotId, sessionRef);
    const cursor = decodeTranscriptCursor(query.cursor);

    const handoffSessions = await this.prisma.handoffSession.findMany({
      where: { chatbotId, sessionId },
      orderBy: { startedAt: 'asc' },
    });
    const activeHandoff = handoffSessions.find((h) => h.status === 'CONNECTED') ?? null;
    // 응답의 `handoff` 필드는 CONNECTED뿐 아니라 CONNECTING(아직 첫 접촉 전)도 "진행 중"으로 보여준다
    // — 원문 가시성(§9.3)은 CONNECTED로 한정하지만, 개입 직후 화면 표시는 그보다 이르게 필요하다.
    const displayHandoff = handoffSessions.find((h) => h.status === 'CONNECTING' || h.status === 'CONNECTED') ?? handoffSessions[handoffSessions.length - 1] ?? null;
    const includeRaw = query.includeRaw === true;
    const viewerForRaw = { id: viewer.id, role: viewer.role, permissions: ROLE_PERMISSIONS[viewer.role] };
    const rawVisible =
      activeHandoff !== null &&
      canViewRaw({ status: activeHandoff.status as 'CONNECTING' | 'CONNECTED' | 'ENDED', assignedUserId: activeHandoff.assignedUserId }, viewerForRaw, includeRaw);

    const botLogsWhere: Record<string, unknown> = { chatbotId, sessionId, handoffTurn: false };
    if (cursor?.l) botLogsWhere.createdAt = { gt: new Date(cursor.l[0]) };
    const botLogs = await this.prisma.conversationLog.findMany({
      where: botLogsWhere as never,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: PAGE,
    });

    const handoffMsgWhere: Record<string, unknown> = { handoffSessionId: { in: handoffSessions.map((h) => h.id) } };
    if (cursor?.m) handoffMsgWhere.createdAt = { gt: new Date(cursor.m[0]) };
    const handoffMessages = handoffSessions.length
      ? await this.prisma.handoffMessage.findMany({
          where: handoffMsgWhere as never,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: PAGE,
        })
      : [];

    const handoffById = new Map(handoffSessions.map((h) => [h.id, h]));

    const botEntries: TranscriptEntry[] = botLogs.map((log) => ({
      kind: 'BOT_TURN',
      logId: log.id,
      at: log.createdAt,
      userText: log.userMessage,
      botText: log.botResponse,
      isAnswered: log.isAnswered,
      blocked: log.blockedByFilter,
    }));

    const handoffEntries: TranscriptEntry[] = handoffMessages
      .filter((m) => m.systemKind !== 'TAKEOVER')
      .map((m) => {
        const owner = handoffById.get(m.handoffSessionId);
        const showRaw = rawVisible && m.sender === 'USER' && owner?.status === 'CONNECTED' && m.rawText !== null && m.rawExpiresAt !== null && m.rawExpiresAt > new Date();
        return {
          kind: 'HANDOFF' as const,
          messageId: m.id,
          handoffId: m.handoffSessionId,
          seq: m.seq,
          at: m.createdAt,
          sender: m.sender as 'USER' | 'AGENT' | 'SYSTEM',
          systemKind: m.systemKind as 'CONNECTED' | 'ENDED' | 'FAILED' | undefined,
          text: m.text,
          rawText: showRaw ? (m.rawText as string) : undefined,
          senderName: m.senderUserName ?? undefined,
        };
      });

    const merged = [...botEntries, ...handoffEntries].sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, PAGE);

    const lastBot = botLogs[botLogs.length - 1];
    const lastHandoff = handoffMessages[handoffMessages.length - 1];
    const nextCursor =
      botLogs.length === PAGE || handoffMessages.length === PAGE
        ? encodeTranscriptCursor({
            l: lastBot ? [lastBot.createdAt.toISOString(), lastBot.id] : cursor?.l,
            m: lastHandoff ? [lastHandoff.createdAt.toISOString(), lastHandoff.id] : cursor?.m,
          })
        : null;

    const anyRawShown = handoffEntries.some((e) => e.kind === 'HANDOFF' && e.rawText !== undefined);
    if (anyRawShown && activeHandoff) {
      await this.recordRawViewAuditOnce(activeHandoff.id, viewer);
    }

    const blockedDuringHandoff = activeHandoff?.connectedAt
      ? await this.prisma.conversationLog.count({ where: { chatbotId, sessionId, blockedByFilter: true, createdAt: { gte: activeHandoff.connectedAt } } })
      : 0;

    const sessionRefResolved = computeSessionRef(chatbotId, sessionId);
    const alias = assignAliases([sessionRefResolved]).get(sessionRefResolved) ?? sessionRefResolved.slice(0, 6);

    // [코드리뷰 2회차 M-2] endButtonLabel — 설정 전용 캐시(TTL 30초)를 재사용해 추가 DB 조회를
    // 늘리지 않는다(chatbotHandoffSetting을 직접 조회하지 않는다).
    const endButtonLabel = displayHandoff ? (await this.settingsCache.get(chatbotId)).endButtonLabel : null;

    return {
      entries: merged,
      nextCursor,
      handoff: displayHandoff
        ? {
            id: displayHandoff.id,
            alias,
            status: displayHandoff.status as 'CONNECTING' | 'CONNECTED' | 'ENDED',
            endReason: displayHandoff.endReason as never,
            clientMode: displayHandoff.clientMode as never,
            assignedUserName: displayHandoff.assignedUserName,
            isMine: displayHandoff.assignedUserId === viewer.id,
            endButtonLabel,
            startedAt: displayHandoff.startedAt,
            connectedAt: displayHandoff.connectedAt,
            endedAt: displayHandoff.endedAt,
            userMessageCount: displayHandoff.userMessageCount,
            agentMessageCount: displayHandoff.agentMessageCount,
            unverifiedAttemptCount: displayHandoff.unverifiedAttemptCount,
          }
        : null,
      rawVisible,
      blockedDuringHandoff,
    };
  }

  /** (상담, 열람자)당 1건만(§9.4) — 인스턴스 로컬 메모는 두지 않고 매번 조회한다(단순함 우선, 최대
   * 인스턴스 수만큼 중복 가능 — 설계가 수용하는 트레이드오프). */
  private async recordRawViewAuditOnce(handoffSessionId: string, viewer: SessionUser): Promise<void> {
    const existing = await this.prisma.auditLog.findFirst({
      where: { actorId: viewer.id, action: 'RAW_VIEW', targetType: 'HandoffSession', targetId: handoffSessionId },
      select: { id: true },
    });
    if (existing) return;
    await this.auditLog.record({
      action: 'RAW_VIEW',
      targetType: 'HandoffSession',
      targetId: handoffSessionId,
      summary: `상담 중 원문 열람(${viewer.role === 'ADMIN' ? '관리자' : '담당자'})`,
    });
  }
}
