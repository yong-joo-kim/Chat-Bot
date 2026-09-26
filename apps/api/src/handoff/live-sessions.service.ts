import { Injectable } from '@nestjs/common';
import type { LiveSessionListQuery, LiveSessionListResponse, LiveSessionRow } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { evaluateSessionAlert } from './lib/session-alert';
import type { SessionAlertLogRow } from './lib/session-alert';
import { computeSessionRef, assignAliases } from './lib/session-ref';

interface SessionAgg {
  sessionId: string;
  channelType: string;
  firstAt: Date;
  lastAt: Date;
  turnCount: number;
  lastLogId: string;
  rows: SessionAlertLogRow[];
}

/**
 * 진행 중 목록(FR-CS2-*, §10) — 쿼리 수 3 고정(AC-CS2-8). 챗봇 인덱스(chatbotId, createdAt)를
 * 재사용해 최근 활동 창 안의 로그를 한 번에 읽고, 세션 단위 집계는 메모리에서 한다.
 */
@Injectable()
export class LiveSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly settingsCache: HandoffSettingsCacheService,
  ) {}

  async list(chatbotId: string, viewerId: string, query: LiveSessionListQuery): Promise<LiveSessionListResponse> {
    await this.scope.assertReadable(chatbotId);
    const settings = await this.settingsCache.get(chatbotId);
    const now = new Date();
    const windowStart = new Date(now.getTime() - settings.activeWindowMinutes * 60_000);

    // ① 활성 창 내 로그
    const logs = await this.prisma.conversationLog.findMany({
      where: { chatbotId, createdAt: { gte: windowStart }, sessionId: { not: null } },
      select: { id: true, sessionId: true, createdAt: true, channelType: true, isAnswered: true, blockedByFilter: true, surveyTurn: true, handoffTurn: true, apiNotice: true },
      orderBy: { createdAt: 'desc' },
      take: 20_000,
    });
    const truncated = logs.length >= 20_000;

    // ② 활성 상담(또는 창 안에서 종료된 상담)
    const handoffRows = await this.prisma.handoffSession.findMany({
      where: { chatbotId, OR: [{ status: { in: ['CONNECTING', 'CONNECTED'] } }, { endedAt: { gte: windowStart } }] },
      orderBy: { startedAt: 'desc' },
    });
    const handoffBySession = new Map<string, (typeof handoffRows)[number]>();
    for (const h of handoffRows) {
      if (!handoffBySession.has(h.sessionId)) handoffBySession.set(h.sessionId, h); // 최신(먼저 나온 것)만
    }

    // 세션 단위 집계(오래된 순으로 재정렬해 evaluateSessionAlert에 넘긴다)
    const bySession = new Map<string, SessionAgg>();
    for (const log of [...logs].reverse()) {
      const sessionId = log.sessionId as string;
      let agg = bySession.get(sessionId);
      if (!agg) {
        agg = { sessionId, channelType: log.channelType, firstAt: log.createdAt, lastAt: log.createdAt, turnCount: 0, lastLogId: log.id, rows: [] };
        bySession.set(sessionId, agg);
      }
      agg.turnCount += 1;
      agg.lastAt = log.createdAt;
      agg.lastLogId = log.id;
      agg.rows.push({ isAnswered: log.isAnswered, blockedByFilter: log.blockedByFilter, surveyTurn: log.surveyTurn, handoffTurn: log.handoffTurn, apiNotice: log.apiNotice });
    }

    // ③ 페이지 대상 세션의 마지막 사용자 발화(전체가 아니라 정렬·필터 후 최대 pageSize만 조회하고 싶지만
    // 정렬이 메모리 조립이라 여기서는 세션 전체의 마지막 로그 id 목록으로 1회 조회한다).
    const lastLogIds = Array.from(bySession.values()).map((a) => a.lastLogId);
    const lastLogTexts =
      lastLogIds.length > 0 ? await this.prisma.conversationLog.findMany({ where: { id: { in: lastLogIds } }, select: { id: true, userMessage: true, textPurgedAt: true } }) : [];
    const textByLogId = new Map(lastLogTexts.map((r) => [r.id, r.userMessage]));
    // [신규 No.45] 마지막 발화 원천 행이 보존기간 경과로 소거됐으면 표시(ui-spec §3.7). 추가 쿼리 없음 — 이미 읽는 행에서 판정.
    const purgedByLogId = new Map(lastLogTexts.map((r) => [r.id, r.textPurgedAt != null]));

    const sessionRefs = Array.from(bySession.keys())
      .map((sid) => computeSessionRef(chatbotId, sid))
      .sort();
    const aliasOf = assignAliases(sessionRefs);

    let rows: LiveSessionRow[] = Array.from(bySession.values()).map((agg) => {
      const alert = evaluateSessionAlert(agg.rows, { caution: settings.cautionThreshold, warning: settings.warningThreshold });
      const sessionRef = computeSessionRef(chatbotId, agg.sessionId);
      const handoff = handoffBySession.get(agg.sessionId);
      return {
        sessionRef,
        alias: aliasOf.get(sessionRef) ?? sessionRef.slice(0, 6),
        channelType: agg.channelType,
        firstAt: agg.firstAt,
        lastAt: agg.lastAt,
        turnCount: agg.turnCount,
        consecutiveUnanswered: alert.consecutiveUnanswered,
        windowUnanswered: alert.windowUnanswered,
        blockedCount: alert.blockedCount,
        alertLevel: alert.alertLevel,
        lastUserText: (textByLogId.get(agg.lastLogId) ?? '').slice(0, 100),
        lastUserTextPurged: purgedByLogId.get(agg.lastLogId) ? true : undefined,
        lastUnansweredReason: alert.lastUnansweredReason,
        handoff: handoff
          ? {
              id: handoff.id,
              status: handoff.status as 'CONNECTING' | 'CONNECTED' | 'ENDED',
              assignedUserName: handoff.assignedUserName,
              isMine: handoff.assignedUserId === viewerId,
              clientMode: (handoff.clientMode as 'MODERN' | 'LEGACY' | undefined) ?? undefined,
              unverifiedAttemptCount: handoff.unverifiedAttemptCount,
              idleSeconds: Math.max(0, Math.floor((now.getTime() - agg.lastAt.getTime()) / 1000)),
            }
          : undefined,
        handoffSupported: agg.channelType === 'WEB',
      };
    });

    if (query.alert && query.alert.length > 0) rows = rows.filter((r) => query.alert!.includes(r.alertLevel));
    if (query.channel) rows = rows.filter((r) => r.channelType === query.channel);
    if (query.handoff === 'NONE') rows = rows.filter((r) => !r.handoff);
    if (query.handoff === 'ACTIVE') rows = rows.filter((r) => r.handoff && r.handoff.status !== 'ENDED');
    if (query.handoff === 'ENDED') rows = rows.filter((r) => r.handoff && r.handoff.status === 'ENDED');

    const alertRank: Record<string, number> = { WARNING: 2, CAUTION: 1, NORMAL: 0 };
    rows.sort((a, b) => alertRank[b.alertLevel] - alertRank[a.alertLevel] || b.lastAt.getTime() - a.lastAt.getTime());

    const total = rows.length;
    const page = query.page;
    const pageSize = query.pageSize;
    const pageRows = rows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

    const summary = {
      live: rows.length,
      warning: rows.filter((r) => r.alertLevel === 'WARNING').length,
      caution: rows.filter((r) => r.alertLevel === 'CAUTION').length,
      handoffActive: rows.filter((r) => r.handoff && r.handoff.status !== 'ENDED').length,
    };

    return { items: pageRows, total, page, pageSize, summary, truncated, windowMinutes: settings.activeWindowMinutes, handoffEnabled: settings.enabled, generatedAt: now };
  }
}
