import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toKstDayBucket } from '@chat-bot/shared-types';
import type { HandoffDetail, InterveneHandoffResponse, MaskPreviewResponse, SendAgentMessageResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import type { SessionUser } from '../common/auth/session-context';
import { maskPii } from '@chat-bot/pii-mask';
import { HandoffThreadService } from './handoff-thread.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { SessionRefResolverService } from './session-ref-resolver.service';
import { evaluateSessionAlert } from './lib/session-alert';
import { computeSessionRef, assignAliases } from './lib/session-ref';
import { isWatchWindowMissed } from './lib/watch-window';

/** 개입·전송·종료·인수·마스킹 미리보기(§8.2·§8.5·§17.1 ④~⑧) — 콘솔 전용 쓰기 오케스트레이션.
 * 실제 모델 쓰기는 전부 `HandoffThreadService`(§18 H-2)를 통한다. */
@Injectable()
export class HandoffActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly thread: HandoffThreadService,
    private readonly settingsCache: HandoffSettingsCacheService,
    private readonly resolver: SessionRefResolverService,
    private readonly auditLog: AuditLogService,
    private readonly bannedWordFilter: BannedWordFilterService,
    private readonly config: ConfigService,
  ) {}

  async intervene(chatbotId: string, sessionRef: string, actor: SessionUser): Promise<InterveneHandoffResponse> {
    await this.scope.assertReadable(chatbotId);
    const settings = await this.settingsCache.get(chatbotId);
    if (!settings.enabled) throw new ApiException('HANDOFF_DISABLED', 409, '상담 연계가 꺼져 있습니다.');

    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true, status: true, groupId: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    const channel = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId, type: 'WEB' } }, select: { enabled: true } });
    if (chatbot.status !== 'ACTIVE' || !channel?.enabled) {
      throw new ApiException('HANDOFF_SESSION_NOT_LIVE', 409, '지금은 이 세션에 개입할 수 없습니다.');
    }

    const sessionId = await this.resolver.resolve(chatbotId, sessionRef);
    const windowStart = new Date(Date.now() - settings.activeWindowMinutes * 60_000);
    const lastLog = await this.prisma.conversationLog.findFirst({ where: { chatbotId, sessionId }, orderBy: { createdAt: 'desc' } });
    if (!lastLog || lastLog.createdAt < windowStart) {
      throw new ApiException('HANDOFF_SESSION_NOT_LIVE', 409, '활성 창을 벗어난 세션입니다.');
    }

    const windowLogs = await this.prisma.conversationLog.findMany({
      where: { chatbotId, sessionId, createdAt: { gte: windowStart } },
      orderBy: { createdAt: 'asc' },
      select: { isAnswered: true, blockedByFilter: true, surveyTurn: true, handoffTurn: true, apiNotice: true },
    });
    const alert = evaluateSessionAlert(windowLogs, { caution: settings.cautionThreshold, warning: settings.warningThreshold });

    // [코드리뷰 1회차 반영] EX-CS-3 — 관찰 창 밖에서 개입하면 전달이 다음 사용자 발화까지 보류된다.
    // "관찰 창을 여는 조건"은 §5.5와 동일하게 판정한다(미응답 ∧ 차단 아님 ∧ 설문/상담 구간 아님).
    const lastTurnUnanswered = !lastLog.blockedByFilter && !lastLog.isAnswered && !lastLog.surveyTurn && !lastLog.handoffTurn;
    const now = new Date();
    const watchWindowMissed = isWatchWindowMissed({
      lastTurnAt: lastLog.createdAt,
      lastTurnUnanswered,
      now,
      watchWindowMs: this.config.get<number>('HANDOFF_WATCH_WINDOW_MS') ?? 180_000,
    });
    const created = await this.thread.createHandoff({
      chatbotId,
      groupId: chatbot.groupId,
      sessionId,
      sessionRef: computeSessionRef(chatbotId, sessionId),
      channelType: 'WEB',
      assignedUserId: actor.id,
      assignedUserName: actor.name,
      startedById: actor.id,
      startedByName: actor.name,
      alertLevelAtStart: alert.alertLevel,
      consecutiveUnansweredAtStart: alert.consecutiveUnanswered,
      connectNotice: settings.connectNotice,
      now,
      dayBucket: toKstDayBucket(now),
    });

    await this.auditLog.record({
      action: 'CREATE',
      targetType: 'HandoffSession',
      targetId: created.id,
      chatbotId,
      after: { status: 'CONNECTING', endReason: null, assignedUserName: actor.name, alertLevelAtStart: alert.alertLevel, alias: computeSessionRef(chatbotId, sessionId).slice(0, 6) },
      summary: `상담 개입 (경고 단계: ${alert.alertLevel})`,
    });

    const detail = await this.toDetail(created.id, actor.id);
    return { ...detail, watchWindowMissed };
  }

  async sendMessage(chatbotId: string, handoffId: string, actor: SessionUser, text: string): Promise<SendAgentMessageResponse> {
    await this.assertBelongsToChatbot(chatbotId, handoffId);
    const result = await this.thread.appendAgentMessage({ handoffSessionId: handoffId, userId: actor.id, userName: actor.name, text, now: new Date() });
    return { seq: result.seq, text: result.maskedText, masked: result.maskedText !== text };
  }

  async end(chatbotId: string, handoffId: string, actor: SessionUser): Promise<HandoffDetail> {
    const session = await this.assertBelongsToChatbot(chatbotId, handoffId);
    if (session.assignedUserId !== actor.id && actor.role !== 'ADMIN') {
      throw new ApiException('HANDOFF_NOT_ASSIGNEE', 403, '담당자 또는 관리자만 종료할 수 있습니다.');
    }
    const settings = await this.settingsCache.get(chatbotId);
    const result = await this.thread.endHandoff({ handoffSessionId: handoffId, chatbotId, reason: 'AGENT_ENDED', now: new Date(), endedBy: { id: actor.id, name: actor.name }, settings });
    if (!result.ended) throw new ApiException('HANDOFF_NOT_ACTIVE', 409, '이미 종료된 상담입니다.');

    await this.auditLog.record({
      action: 'STATUS_CHANGE',
      targetType: 'HandoffSession',
      targetId: handoffId,
      chatbotId,
      before: { status: session.status },
      after: { status: 'ENDED', endReason: 'AGENT_ENDED' },
      summary: `상담 종료(${actor.role === 'ADMIN' && session.assignedUserId !== actor.id ? '관리자' : '상담원'})`,
    });

    return this.toDetail(handoffId, actor.id);
  }

  async takeover(chatbotId: string, handoffId: string, actor: SessionUser, reason: string): Promise<HandoffDetail> {
    if (actor.role !== 'ADMIN') throw new ApiException('HANDOFF_NOT_ASSIGNEE', 403, '강제 인수는 관리자만 할 수 있습니다.');
    const session = await this.assertBelongsToChatbot(chatbotId, handoffId);
    await this.thread.takeover(handoffId, { id: actor.id, name: actor.name }, reason, new Date());

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'HandoffSession',
      targetId: handoffId,
      chatbotId,
      before: { assignedUserName: session.assignedUserName },
      after: { assignedUserName: actor.name },
      summary: `강제 인수: ${reason}`,
    });

    // 인수 직후 응답의 isMine은 새 담당자(actor) 기준이다 — 인수한 ADMIN 본인의 화면에서 "내 상담"으로 보여야 한다.
    return this.toDetail(handoffId, actor.id);
  }

  async maskPreview(text: string): Promise<MaskPreviewResponse> {
    const masked = maskPii(await this.bannedWordFilter.maskPlainText(text)).maskedText;
    return { maskedText: masked, changed: masked !== text };
  }

  private async assertBelongsToChatbot(chatbotId: string, handoffId: string) {
    const session = await this.prisma.handoffSession.findUnique({ where: { id: handoffId } });
    if (!session || session.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 상담을 찾을 수 없습니다.');
    return session;
  }

  private async toDetail(handoffId: string, viewerId: string): Promise<HandoffDetail> {
    const s = await this.prisma.handoffSession.findUniqueOrThrow({ where: { id: handoffId } });
    // [코드리뷰 2회차 M-2] 설정 전용 캐시(TTL 30초)를 재사용한다 — chatbotHandoffSetting을
    // 직접 조회하지 않아 추가 쿼리가 늘지 않는다(이 서비스가 이미 다른 메서드에서 같은 캐시를 쓴다).
    const settings = await this.settingsCache.get(s.chatbotId);
    const sessionRef = computeSessionRef(s.chatbotId, s.sessionId);
    const alias = assignAliases([sessionRef]).get(sessionRef) ?? sessionRef.slice(0, 6);
    return {
      id: s.id,
      alias,
      status: s.status as 'CONNECTING' | 'CONNECTED' | 'ENDED',
      endReason: s.endReason as never,
      clientMode: s.clientMode as never,
      assignedUserName: s.assignedUserName,
      isMine: s.assignedUserId === viewerId,
      endButtonLabel: settings.endButtonLabel,
      startedAt: s.startedAt,
      connectedAt: s.connectedAt,
      endedAt: s.endedAt,
      userMessageCount: s.userMessageCount,
      agentMessageCount: s.agentMessageCount,
      unverifiedAttemptCount: s.unverifiedAttemptCount,
      channelType: s.channelType,
      startedByName: s.startedByName,
      alertLevelAtStart: s.alertLevelAtStart as never,
      consecutiveUnansweredAtStart: s.consecutiveUnansweredAtStart,
      firstAgentReplyAt: s.firstAgentReplyAt,
    };
  }
}
