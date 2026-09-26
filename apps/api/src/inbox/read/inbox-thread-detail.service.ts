import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHANNEL_TYPE_LABELS, INBOX_LIMITS, RECORD_CHANNEL_LABELS } from '@chat-bot/shared-types';
import type { InboxSourceFamily, InboxThreadDetail, InboxThreadListItem, TimelineEntryUnit, TimelineUnit } from '@chat-bot/shared-types';
import { ApiException } from '../../common/api.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { assignAliases } from '../../handoff/lib/session-ref';
import { InboxParticipationCache } from '../core/inbox-participation.cache';
import { InboxTextReader } from './inbox-text.reader';
import { effectiveStatus } from './lib/effective-status';
import { buildCustomerCard } from './lib/build-customer-card';
import { assembleTimeline } from './lib/assemble-timeline';

const NOT_FOUND_MESSAGE = '요청하신 스레드를 찾을 수 없습니다.';

/** [신규 No.42] 상세 = 고객 카드 + 타임라인 페이지(§9.2~§9.3). */
@Injectable()
export class InboxThreadDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly participation: InboxParticipationCache,
    private readonly textReader: InboxTextReader,
    private readonly config: ConfigService,
  ) {}

  async detail(threadId: string, cursor: string | undefined): Promise<InboxThreadDetail> {
    const now = new Date();
    const thread = await this.prisma.inboxThread.findUnique({ where: { id: threadId }, include: { customer: true, tags: { include: { tag: true } } } });
    if (!thread || thread.hiddenByMergeId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const participatingIds = await this.participation.participatingChatbotIds();
    const links = await this.prisma.customerLink.findMany({
      where: { customerId: thread.customerId, chatbotId: { in: participatingIds } },
      orderBy: { linkedAt: 'desc' },
      take: INBOX_LIMITS.cardSessionsMax,
    });

    const aliasOf = assignAliases([thread.customer.ref, ...links.map((l) => l.sessionRef)]);

    const activeHandoffs = await this.buildActiveHandoffs(links);
    const threadItem = await this.toListItem(thread, aliasOf, now, activeHandoffs.length);
    const card = await this.buildCard(links, thread.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })));
    const timeline = await this.buildTimelinePage(thread.id, links, aliasOf, cursor);
    // [계약 보강] 콘솔이 되돌리기 버튼을 사전 판정(서버 재조회 0)할 수 있게 설정값을 그대로 내려준다(ui-spec §3.6b).
    const mergeRevertHours = this.config.get<number>('OMNI_MERGE_REVERT_HOURS') ?? 24;

    return { thread: threadItem, card, timeline, activeHandoffs, mergeRevertHours };
  }

  private async toListItem(
    thread: { id: string; version: number; status: string; snoozeUntil: Date | null; assigneeUserId: string | null; assigneeUserName: string | null; lastActivityAt: Date; lastActivityKind: string; lastChannelFamily: string | null; lastChannelType: string | null; lastChatbotId: string | null; lastEntryId: string | null; customer: { id: string; ref: string; kind: string; displayName: string | null; identityPurgedAt: Date | null }; tags: Array<{ tag: { id: string; name: string; color: string } }> },
    aliasOf: Map<string, string>,
    now: Date,
    activeHandoffCount: number,
  ): Promise<InboxThreadListItem> {
    const eff = effectiveStatus({ status: thread.status as never, snoozeUntil: thread.snoozeUntil }, now);
    const assigneeActive = thread.assigneeUserId ? (await this.prisma.user.findUnique({ where: { id: thread.assigneeUserId }, select: { status: true } }))?.status === 'ACTIVE' : false;
    const lastChatbot = thread.lastChatbotId ? await this.prisma.chatbot.findUnique({ where: { id: thread.lastChatbotId }, select: { name: true } }) : null;
    const lastEntry = thread.lastEntryId ? await this.prisma.inboxEntry.findUnique({ where: { id: thread.lastEntryId }, select: { id: true, text: true, textPurgedAt: true } }) : null;
    const linkedCount = await this.prisma.customerLink.count({ where: { customerId: thread.customer.id } });

    return {
      threadId: thread.id,
      version: thread.version,
      customer: {
        id: thread.customer.id,
        alias: aliasOf.get(thread.customer.ref) ?? thread.customer.ref.slice(0, 6),
        displayName: thread.customer.displayName ? (this.textReader.openDisplayName(thread.customer.id, thread.customer.displayName) ?? undefined) : undefined,
        kind: thread.customer.kind as never,
        ...(thread.customer.identityPurgedAt ? { identityPurged: true as const } : {}),
      },
      status: eff.status,
      ...(thread.snoozeUntil ? { snoozeUntil: thread.snoozeUntil } : {}),
      ...(eff.snoozeExpired ? { snoozeExpired: true as const } : {}),
      ...(thread.assigneeUserId ? { assignee: { id: thread.assigneeUserId, name: thread.assigneeUserName ?? '', active: assigneeActive } } : {}),
      tags: thread.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
      ...(thread.lastChannelType
        ? {
            lastChannel: {
              family: (thread.lastChannelFamily as InboxSourceFamily | null) ?? 'DEPLOY',
              type: thread.lastChannelType,
              label: RECORD_CHANNEL_LABELS[thread.lastChannelType as keyof typeof RECORD_CHANNEL_LABELS] ?? CHANNEL_TYPE_LABELS[thread.lastChannelType as keyof typeof CHANNEL_TYPE_LABELS] ?? thread.lastChannelType,
            },
          }
        : {}),
      ...(thread.lastChatbotId ? { lastChatbot: { id: thread.lastChatbotId, name: lastChatbot?.name ?? '(삭제됨)' } } : {}),
      linkedConversationCount: linkedCount,
      // [코드리뷰 R2 반영 M-4] 하드코딩 0 제거 — 페이지 연결 세션 기준 진행 중 상담 수(§9.2 item 3 재사용).
      activeHandoffCount,
      lastActivityAt: thread.lastActivityAt,
      lastActivityKind: thread.lastActivityKind,
      ...(lastEntry ? (lastEntry.textPurgedAt ? { lastEntryPurged: true as const } : { lastEntryPreview: this.textReader.openEntryText(lastEntry.id, lastEntry.text).slice(0, 60) }) : {}),
    };
  }

  private async buildCard(links: Array<{ chatbotId: string; sessionId: string }>, tags: Array<{ id: string; name: string; color: string }>) {
    if (links.length === 0) {
      return buildCustomerCard({
        conversationsTotal: 0,
        byChannel: [],
        byChatbot: [],
        firstActivityAt: null,
        lastActivityAt: null,
        topMatches: [],
        unansweredTurns: 0,
        handoffCount: 0,
        surveysCompleted: 0,
        negativeFeedbacks: 0,
        tags,
      });
    }
    const orConditions = links.map((l) => ({ chatbotId: l.chatbotId, sessionId: l.sessionId }));
    const logs = await this.prisma.conversationLog.findMany({ where: { OR: orConditions }, select: { chatbotId: true, channelType: true, isAnswered: true, matchedIntentId: true, matchedFaqId: true, createdAt: true, id: true } });
    const byChatbotMap = new Map<string, number>();
    const byChannelMap = new Map<string, number>();
    const intentCounts = new Map<string, number>();
    const faqCounts = new Map<string, number>();
    let unansweredTurns = 0;
    let firstActivityAt: Date | null = null;
    let lastActivityAt: Date | null = null;
    for (const log of logs) {
      byChatbotMap.set(log.chatbotId, (byChatbotMap.get(log.chatbotId) ?? 0) + 1);
      byChannelMap.set(log.channelType, (byChannelMap.get(log.channelType) ?? 0) + 1);
      if (!log.isAnswered) unansweredTurns += 1;
      if (log.matchedIntentId) intentCounts.set(log.matchedIntentId, (intentCounts.get(log.matchedIntentId) ?? 0) + 1);
      if (log.matchedFaqId) faqCounts.set(log.matchedFaqId, (faqCounts.get(log.matchedFaqId) ?? 0) + 1);
      if (!firstActivityAt || log.createdAt < firstActivityAt) firstActivityAt = log.createdAt;
      if (!lastActivityAt || log.createdAt > lastActivityAt) lastActivityAt = log.createdAt;
    }
    const chatbots = byChatbotMap.size > 0 ? await this.prisma.chatbot.findMany({ where: { id: { in: [...byChatbotMap.keys()] } }, select: { id: true, name: true } }) : [];
    const chatbotNameById = new Map(chatbots.map((c) => [c.id, c.name]));

    const intentIds = [...intentCounts.keys()];
    const faqIds = [...faqCounts.keys()];
    const intents = intentIds.length > 0 ? await this.prisma.intent.findMany({ where: { id: { in: intentIds } }, select: { id: true, name: true } }) : [];
    const faqs = faqIds.length > 0 ? await this.prisma.faqEntry.findMany({ where: { id: { in: faqIds } }, select: { id: true, question: true } }) : [];
    const topMatches = [
      ...intents.map((i) => ({ kind: 'INTENT' as const, id: i.id, name: i.name, count: intentCounts.get(i.id) ?? 0 })),
      ...faqs.map((f) => ({ kind: 'FAQ' as const, id: f.id, name: f.question, count: faqCounts.get(f.id) ?? 0 })),
    ]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const handoffs = await this.prisma.handoffSession.findMany({ where: { OR: orConditions }, orderBy: { startedAt: 'desc' } });
    const lastHandoff = handoffs[0];

    const logIds = logs.map((l) => l.id);
    const negativeFeedbacks = logIds.length > 0 ? await this.prisma.messageFeedback.count({ where: { conversationLogId: { in: logIds }, rating: 'DOWN' } }) : 0;
    const surveysCompleted = await this.prisma.surveyResponse.count({ where: { status: 'COMPLETED', OR: orConditions } });

    return buildCustomerCard({
      conversationsTotal: logs.length,
      byChannel: [...byChannelMap.entries()].map(([type, count]) => ({ type, label: CHANNEL_TYPE_LABELS[type as keyof typeof CHANNEL_TYPE_LABELS] ?? type, count })),
      byChatbot: [...byChatbotMap.entries()].map(([id, count]) => ({ id, name: chatbotNameById.get(id) ?? '(삭제됨)', count })),
      firstActivityAt,
      lastActivityAt,
      topMatches,
      unansweredTurns,
      handoffCount: handoffs.length,
      lastEndReason: lastHandoff?.endReason ?? undefined,
      lastAgentName: lastHandoff?.assignedUserName ?? undefined,
      lastEndedAt: lastHandoff?.endedAt ?? undefined,
      surveysCompleted,
      negativeFeedbacks,
      tags,
      truncated: links.length >= INBOX_LIMITS.cardSessionsMax,
    });
  }

  private async buildTimelinePage(
    threadId: string,
    links: Array<{ id: string; chatbotId: string; sessionId: string; sessionRef: string; channelType: string; source: string; linkedAt: Date }>,
    aliasOf: Map<string, string>,
    cursor?: string,
  ) {
    // SQLite 드라이버가 `new Date(8640000000000000)`(ECMAScript 최대값)를 직렬화하지 못해 커서
    // 없음은 "상한 없음"으로 다룬다(필터 자체를 생략) — Date.MAX_VALUE 센티넬 대신 조건부 where.
    const before = cursor ? new Date(cursor) : undefined;
    const recentLinks = links.filter((l) => !before || l.linkedAt < before).slice(0, INBOX_LIMITS.timelinePageSize);
    const entries = await this.prisma.inboxEntry.findMany({
      where: { threadId, ...(before ? { occurredAt: { lt: before } } : {}) },
      orderBy: { occurredAt: 'desc' },
      take: INBOX_LIMITS.timelinePageSize,
    });

    // 상담(§9.2 item 3 — H-1 반영): 페이지 안 연결 세션 전체에 대해 1+1 쿼리로 미리 모은다(연결
    // 세션별 추가 쿼리 0). rawText는 선택하지 않는다(O-10) — text는 리더가 HANDOFF_TEXT로 개봉한다.
    const handoffSessions =
      recentLinks.length > 0
        ? await this.prisma.handoffSession.findMany({
            where: { OR: recentLinks.map((l) => ({ chatbotId: l.chatbotId, sessionId: l.sessionId })) },
            orderBy: { startedAt: 'asc' },
          })
        : [];
    const handoffIds = handoffSessions.map((h) => h.id);
    // [불변식 — L-C 회귀시험] seq는 HandoffSession마다 1부터 재시작한다(전역이 아니다) — 이 전제가 깨지면 아래 take(전역 seq 정렬 상한)가 메시지 수가 적은 세션을 밀어내 누락시킬 수 있다.
    // [코드리뷰 R2 반영 M-6] 상담 메시지도 `sessionTurnsMax`와 같은 방식으로 상한을 둔다 — 단일
    // `IN` 쿼리(1+1 예산 불변 · §9.2)라 상담별 정확한 상한은 아니지만(그룹 전체에 대한 총량
    // 상한), 값이 큰(≥ 상한 × 상담 수) 상한이라 실사용에서는 상담별 상한과 사실상 같다.
    const handoffMessages =
      handoffIds.length > 0
        ? await this.prisma.handoffMessage.findMany({
            where: { handoffSessionId: { in: handoffIds } },
            select: { id: true, handoffSessionId: true, seq: true, sender: true, text: true, textPurgedAt: true, createdAt: true },
            orderBy: { seq: 'asc' },
            take: INBOX_LIMITS.handoffMessagesPerSessionMax * handoffIds.length,
          })
        : [];
    const messagesByHandoff = new Map<string, typeof handoffMessages>();
    for (const m of handoffMessages) {
      const list = messagesByHandoff.get(m.handoffSessionId) ?? [];
      list.push(m);
      messagesByHandoff.set(m.handoffSessionId, list);
    }
    const handoffsByLinkKey = new Map<string, typeof handoffSessions>();
    for (const h of handoffSessions) {
      const key = `${h.chatbotId}:${h.sessionId}`;
      const list = handoffsByLinkKey.get(key) ?? [];
      list.push(h);
      handoffsByLinkKey.set(key, list);
    }

    const conversationUnits: TimelineUnit[] = await Promise.all(
      recentLinks.map(async (link) => {
        const logs = await this.prisma.conversationLog.findMany({
          where: { chatbotId: link.chatbotId, sessionId: link.sessionId },
          orderBy: { createdAt: 'asc' },
          take: INBOX_LIMITS.sessionTurnsMax,
        });
        const chatbot = await this.prisma.chatbot.findUnique({ where: { id: link.chatbotId }, select: { name: true } });
        const sessionHandoffs = handoffsByLinkKey.get(`${link.chatbotId}:${link.sessionId}`) ?? [];
        return {
          kind: 'CONVERSATION' as const,
          at: link.linkedAt,
          chatbot: { id: link.chatbotId, name: chatbot?.name ?? '(삭제됨)' },
          channel: { family: 'DEPLOY' as const, type: link.channelType, label: CHANNEL_TYPE_LABELS[link.channelType as keyof typeof CHANNEL_TYPE_LABELS] ?? link.channelType },
          sessionRef: link.sessionRef,
          sessionAlias: aliasOf.get(link.sessionRef) ?? link.sessionRef.slice(0, 6),
          linkId: link.id,
          linkSource: link.source as never,
          startedAt: logs[0]?.createdAt ?? link.linkedAt,
          lastAt: logs[logs.length - 1]?.createdAt ?? link.linkedAt,
          turns: logs.map((l) => ({ at: l.createdAt, user: l.userMessage, bot: l.botResponse, answered: l.isAnswered, handoffTurn: l.handoffTurn, blocked: l.blockedByFilter })),
          handoffs: sessionHandoffs.map((h) => ({
            handoffId: h.id,
            status: h.status,
            startedAt: h.startedAt,
            ...(h.endedAt ? { endedAt: h.endedAt } : {}),
            ...(h.endReason ? { endReason: h.endReason } : {}),
            agentName: h.assignedUserName,
            messages: (messagesByHandoff.get(h.id) ?? []).slice(0, INBOX_LIMITS.handoffMessagesPerSessionMax).map((m) => ({
              at: m.createdAt,
              sender: m.sender as 'USER' | 'AGENT' | 'SYSTEM',
              text: m.textPurgedAt ? '' : this.textReader.openHandoffText(m.id, m.text),
              ...(m.textPurgedAt ? { purged: true as const } : {}),
            })),
            ...((messagesByHandoff.get(h.id)?.length ?? 0) >= INBOX_LIMITS.handoffMessagesPerSessionMax ? { truncated: true as const } : {}),
          })),
          ...(logs.length >= INBOX_LIMITS.sessionTurnsMax ? { truncated: true as const } : {}),
        };
      }),
    );

    const entryUnits: TimelineEntryUnit[] = entries.map((e) => ({
      kind: e.kind as never,
      at: e.occurredAt,
      entryId: e.id,
      text: e.textPurgedAt ? '' : this.textReader.openEntryText(e.id, e.text),
      ...(e.textPurgedAt ? { purged: true as const } : {}),
      ...(e.recordChannel ? { recordChannel: e.recordChannel as never } : {}),
      ...(e.direction ? { direction: e.direction as never } : {}),
      ...(e.outcome ? { outcome: e.outcome as never } : {}),
      ...(e.kind === 'SIM_USER' || e.kind === 'SIM_BOT'
        ? { simulated: { channel: e.simulatedChannel ?? '', channelLabel: CHANNEL_TYPE_LABELS[(e.simulatedChannel ?? '') as keyof typeof CHANNEL_TYPE_LABELS] ?? (e.simulatedChannel ?? ''), chatbot: { id: e.chatbotId ?? '', name: '' } } }
        : {}),
      ...(e.kind === 'SYSTEM' ? { system: this.parseSystemMeta(e.meta) } : {}),
      ...(e.authorUserId ? { author: { id: e.authorUserId, name: e.authorName ?? '' } } : {}),
      ...(e.editedAt ? { editedAt: e.editedAt } : {}),
    }));

    return assembleTimeline([...conversationUnits, ...entryUnits], INBOX_LIMITS.timelinePageSize);
  }

  private parseSystemMeta(meta: string): { event: never; data: Record<string, string | number | boolean | null> } {
    try {
      const parsed = JSON.parse(meta) as { event: string; [key: string]: unknown };
      const { event, ...data } = parsed;
      return { event: event as never, data: data as Record<string, string | number | boolean | null> };
    } catch {
      return { event: 'OPENED' as never, data: {} };
    }
  }

  private async buildActiveHandoffs(links: Array<{ chatbotId: string; sessionId: string; sessionRef: string }>) {
    if (links.length === 0) return [];
    const sessions = await this.prisma.handoffSession.findMany({
      where: { status: { in: ['CONNECTING', 'CONNECTED'] }, OR: links.map((l) => ({ chatbotId: l.chatbotId, sessionId: l.sessionId })) },
    });
    const chatbots = sessions.length > 0 ? await this.prisma.chatbot.findMany({ where: { id: { in: sessions.map((s) => s.chatbotId) } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(chatbots.map((c) => [c.id, c.name]));
    return sessions.map((s) => ({ handoffId: s.id, chatbotId: s.chatbotId, chatbotName: nameById.get(s.chatbotId) ?? '(삭제됨)', sessionRef: s.sessionRef, agentName: s.assignedUserName }));
  }
}
