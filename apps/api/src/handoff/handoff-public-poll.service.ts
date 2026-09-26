import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { HandoffPollMessage, HandoffPollQuery, HandoffPollResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { openField } from '../common/crypto/field-crypto';
import { HandoffThreadService } from './handoff-thread.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { verifyHandoffToken } from './lib/handoff-token';
import { judgeHandoffExpiry } from './lib/handoff-expiry';

const ENDED_TOKEN_GRACE_MS = 5 * 60_000;

/**
 * 공개 상담 폴링(`GET /public/chatbots/:slug/handoff`, `@Public()` 7번째 — §7.2). 원칙적으로
 * DB 읽기 전용이다(예외: 토큰 1회 발급 CAS · 만료 종료 CAS · 미확인 카운트 +1).
 *
 * `PublicAccessService`(`conversation` 모듈)를 import하지 않는다 — `handoff`는 `conversation`을
 * import할 수 없다(모듈 의존 방향, §2.2). 같은 판정(챗봇 존재·공개 상태·WEB 채널 활성)을 이 파일
 * 안에서 재구현한다(그룹 자체가 작아 함수 분리 없이 인라인 — 규약 중복은 이 1곳뿐).
 */
@Injectable()
export class HandoffPublicPollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsCache: HandoffSettingsCacheService,
    private readonly thread: HandoffThreadService,
    private readonly config: ConfigService,
  ) {}

  private async resolveChatbot(slug: string): Promise<{ id: string }> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { slug } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    if (chatbot.status !== 'ACTIVE') throw new ApiException('CHATBOT_NOT_PUBLISHED', 403, '현재 상담을 이용할 수 없습니다.');
    const channel = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId: chatbot.id, type: 'WEB' } } });
    if (!channel || !channel.enabled) throw new ApiException('CHANNEL_DISABLED', 403, '현재 상담을 이용할 수 없습니다.');
    return { id: chatbot.id };
  }

  async poll(slug: string, sessionId: string, tokenHeader: string | undefined, query: HandoffPollQuery): Promise<HandoffPollResponse> {
    const chatbot = await this.resolveChatbot(slug);
    const settings = await this.settingsCache.get(chatbot.id);

    let latest = await this.prisma.handoffSession.findFirst({
      where: { chatbotId: chatbot.id, sessionId },
      orderBy: { startedAt: 'desc' },
    });
    if (!latest) return { status: 'NONE', messages: [], cursor: query.after, pollAfterMs: this.config.get<number>('HANDOFF_WATCH_INTERVAL_MS') ?? 5000 };

    const now = new Date();
    if (latest.status !== 'ENDED') {
      const reason = judgeHandoffExpiry(
        {
          status: latest.status as 'CONNECTING' | 'CONNECTED',
          startedAt: latest.startedAt,
          connectedAt: latest.connectedAt,
          lastUserMessageAt: latest.lastUserMessageAt,
          lastAgentMessageAt: latest.lastAgentMessageAt,
          firstAgentReplyAt: latest.firstAgentReplyAt,
        },
        settings,
        true,
        now,
      );
      if (reason) {
        await this.thread.endHandoff({ handoffSessionId: latest.id, chatbotId: chatbot.id, reason, now, settings });
        latest = { ...latest, status: 'ENDED', endReason: reason, endedAt: now };
      }
    }

    const tokenPresent = tokenHeader !== undefined && tokenHeader.length > 0;

    if (tokenPresent) {
      const matches = latest.tokenHash !== null && verifyHandoffToken(tokenHeader as string, latest.tokenHash);
      const withinGrace = latest.status === 'ENDED' && latest.endedAt !== null && now.getTime() - latest.endedAt.getTime() < ENDED_TOKEN_GRACE_MS;
      if (!matches || (latest.status === 'ENDED' && !withinGrace)) {
        throw new ApiException('HANDOFF_NOT_FOUND', 404, '상담을 찾을 수 없습니다.');
      }
      return this.buildResponse(latest, query, now);
    }

    // 토큰 없음: CONNECTING·미발급이면 관찰 창 폴링이 1회 발급한다(§6.2 — 먼저 온 쪽).
    if (latest.status === 'CONNECTING' && latest.tokenHash === null && latest.clientMode === null) {
      const token = await this.thread.issueModernToken(latest.id, now);
      if (token) {
        const refreshed = { ...latest, status: 'CONNECTED' as const, clientMode: 'MODERN' as const, tokenHash: 'issued', connectedAt: now };
        const response = await this.buildResponse(refreshed, query, now);
        return { ...response, token };
      }
    }

    // 토큰 없는 폴링은 활성 상담의 존재조차 드러내지 않는다(§6.4).
    if (latest.status !== 'ENDED') {
      await this.thread.incrementUnverified(latest.id);
    }
    return { status: 'NONE', messages: [], cursor: query.after, pollAfterMs: this.config.get<number>('HANDOFF_WATCH_INTERVAL_MS') ?? 5000 };
  }

  private async buildResponse(
    latest: { id: string; status: string; lastSeq: number },
    query: HandoffPollQuery,
    now: Date,
  ): Promise<HandoffPollResponse> {
    const rows = await this.prisma.handoffMessage.findMany({
      where: { handoffSessionId: latest.id, seq: { gt: query.after } },
      orderBy: { seq: 'asc' },
      take: 100,
      select: { id: true, seq: true, sender: true, systemKind: true, text: true, createdAt: true, action: true },
    });

    const messages: HandoffPollMessage[] = rows
      .filter((m) => m.sender === 'AGENT' || (m.sender === 'SYSTEM' && m.systemKind !== 'TAKEOVER') || (m.sender === 'USER' && query.restore === true))
      .map((m) => ({
        seq: m.seq,
        sender: m.sender as HandoffPollMessage['sender'],
        text: openField('HANDOFF_TEXT', m.id, m.text) ?? '',
        sentAt: m.createdAt,
        action: m.action ? (JSON.parse(m.action) as HandoffPollMessage['action']) : undefined,
      }));

    const cursor = Math.max(query.after, latest.lastSeq);
    const status = latest.status as 'CONNECTING' | 'CONNECTED' | 'ENDED';
    const pollAfterMs =
      status === 'ENDED' ? null : status === 'CONNECTED' ? (this.config.get<number>('HANDOFF_POLL_INTERVAL_MS') ?? 3000) : (this.config.get<number>('HANDOFF_WATCH_INTERVAL_MS') ?? 5000);

    return {
      status: status === 'CONNECTING' ? 'NONE' : status,
      messages,
      cursor,
      pollAfterMs,
    };
  }
}
