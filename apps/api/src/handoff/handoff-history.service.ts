import { Injectable } from '@nestjs/common';
import type { HandoffHistoryDetailResponse, HandoffHistoryItem, HandoffHistoryQuery, HandoffSummaryResponse, Paginated, TranscriptEntry } from '@chat-bot/shared-types';
import { HANDOFF_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { openField } from '../common/crypto/field-crypto';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { buildHandoffSummary } from './lib/handoff-summary';
import { computeSessionRef, assignAliases } from './lib/session-ref';

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/** 상담 이력 · 요약(P-15, §13) — 읽기 전용 · 원문 미조회. */
@Injectable()
export class HandoffHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
  ) {}

  async list(chatbotId: string, query: HandoffHistoryQuery): Promise<Paginated<HandoffHistoryItem>> {
    await this.scope.assertReadable(chatbotId);
    this.assertRange(query.from, query.to);

    const where = this.buildWhere(chatbotId, query);
    const [rows, total] = await Promise.all([
      this.prisma.handoffSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.handoffSession.count({ where }),
    ]);

    const refs = rows.map((r) => computeSessionRef(chatbotId, r.sessionId)).sort();
    const aliasOf = assignAliases(refs);

    const items: HandoffHistoryItem[] = rows.map((r) => {
      const ref = computeSessionRef(chatbotId, r.sessionId);
      const firstResponseSec = r.connectedAt && r.firstAgentReplyAt ? Math.max(0, (r.firstAgentReplyAt.getTime() - r.connectedAt.getTime()) / 1000) : null;
      return {
        id: r.id,
        alias: aliasOf.get(ref) ?? ref.slice(0, 6),
        sessionRef: ref,
        startedAt: r.startedAt,
        connectedAt: r.connectedAt,
        endedAt: r.endedAt,
        assignedUserName: r.assignedUserName,
        endReason: r.endReason as never,
        userMessageCount: r.userMessageCount,
        agentMessageCount: r.agentMessageCount,
        firstResponseSec,
        alertLevelAtStart: r.alertLevelAtStart as never,
        clientMode: r.clientMode as never,
      };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async summary(chatbotId: string, query: HandoffHistoryQuery): Promise<HandoffSummaryResponse> {
    await this.scope.assertReadable(chatbotId);
    this.assertRange(query.from, query.to);

    const where = this.buildWhere(chatbotId, query);
    const rows = await this.prisma.handoffSession.findMany({
      where,
      select: { connectedAt: true, firstAgentReplyAt: true, endedAt: true, endReason: true },
    });
    return buildHandoffSummary(rows);
  }

  async detail(chatbotId: string, handoffId: string): Promise<HandoffHistoryDetailResponse> {
    await this.scope.assertReadable(chatbotId);
    const s = await this.prisma.handoffSession.findUnique({ where: { id: handoffId } });
    if (!s || s.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 상담을 찾을 수 없습니다.');

    const ref = computeSessionRef(chatbotId, s.sessionId);
    const alias = assignAliases([ref]).get(ref) ?? ref.slice(0, 6);
    const firstResponseSec = s.connectedAt && s.firstAgentReplyAt ? Math.max(0, (s.firstAgentReplyAt.getTime() - s.connectedAt.getTime()) / 1000) : null;

    const botLogs = await this.prisma.conversationLog.findMany({
      where: { chatbotId, sessionId: s.sessionId, handoffTurn: false, createdAt: { gte: s.startedAt, lte: s.endedAt ?? new Date() } },
      orderBy: { createdAt: 'asc' },
      take: HANDOFF_LIMITS.transcriptPage,
    });
    const messages = await this.prisma.handoffMessage.findMany({
      where: { handoffSessionId: s.id },
      orderBy: { createdAt: 'asc' },
      take: HANDOFF_LIMITS.transcriptPage,
    });

    const entries: TranscriptEntry[] = [
      ...botLogs.map((log) => ({
        kind: 'BOT_TURN' as const,
        logId: log.id,
        at: log.createdAt,
        userText: log.userMessage,
        botText: log.botResponse,
        isAnswered: log.isAnswered,
        blocked: log.blockedByFilter,
      })),
      ...messages
        .filter((m) => m.systemKind !== 'TAKEOVER')
        .map((m) => ({
          kind: 'HANDOFF' as const,
          messageId: m.id,
          handoffId: m.handoffSessionId,
          seq: m.seq,
          at: m.createdAt,
          sender: m.sender as 'USER' | 'AGENT' | 'SYSTEM',
          systemKind: m.systemKind as 'CONNECTED' | 'ENDED' | 'FAILED' | undefined,
          text: openField('HANDOFF_TEXT', m.id, m.text) ?? '',
          senderName: m.senderUserName ?? undefined,
        })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      handoff: {
        id: s.id,
        alias,
        sessionRef: ref,
        startedAt: s.startedAt,
        connectedAt: s.connectedAt,
        endedAt: s.endedAt,
        assignedUserName: s.assignedUserName,
        endReason: s.endReason as never,
        userMessageCount: s.userMessageCount,
        agentMessageCount: s.agentMessageCount,
        firstResponseSec,
        alertLevelAtStart: s.alertLevelAtStart as never,
        clientMode: s.clientMode as never,
      },
      entries,
    };
  }

  private assertRange(from: string, to: string): void {
    if (daysBetween(from, to) > HANDOFF_LIMITS.historyMaxDays) {
      throw new ApiException('STATS_RANGE_TOO_WIDE', 400, `조회 기간은 최대 ${HANDOFF_LIMITS.historyMaxDays}일까지입니다.`);
    }
  }

  private buildWhere(chatbotId: string, query: HandoffHistoryQuery): Record<string, unknown> {
    return {
      chatbotId,
      dayBucket: { gte: query.from, lte: query.to },
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignedUserId ? { assignedUserId: query.assignedUserId } : {}),
      ...(query.endReason ? { endReason: query.endReason } : {}),
    };
  }
}
