import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { maskPii } from '@chat-bot/pii-mask';
import type { HandoffEndReason } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { sealField } from '../common/crypto/field-crypto';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { generateHandoffToken, hashHandoffToken } from './lib/handoff-token';
import { resolveEndSystemMessage } from './lib/handoff-notices';
import { enableSecureDelete } from './handoff-secure-delete.query';
import { WORKFLOW_EVENT_SINK } from '../common/workflow/workflow-event.port';
import type { WorkflowEventSink } from '../common/workflow/workflow-event.port';
import { INBOX_SIGNAL_SINK } from '../common/inbox/inbox-signal.port';
import type { InboxSignalSink } from '../common/inbox/inbox-signal.port';

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/** Prisma 예외는 **코드만** 로그에 남긴다(message 금지 — 검증 오류 메시지가 호출 인자를 포함할 수 있다, §8.1). */
function prismaErrorCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e && typeof (e as { code?: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return e instanceof Error ? e.constructor.name : 'unknown';
}

export interface CreateHandoffInput {
  chatbotId: string;
  groupId: string;
  sessionId: string;
  sessionRef: string;
  channelType: string;
  assignedUserId: string;
  assignedUserName: string;
  startedById: string;
  startedByName: string;
  alertLevelAtStart: string;
  consecutiveUnansweredAtStart: number;
  connectNotice: string;
  now: Date;
  dayBucket: string;
}

export interface HandoffEndSettings {
  endNotice: string;
  failNotice: string;
  endButtonLabel: string | null;
  endButtonNodeId: string | null;
}

export interface EndHandoffInput {
  handoffSessionId: string;
  chatbotId: string;
  reason: HandoffEndReason;
  now: Date;
  endedBy?: { id: string; name: string };
  settings: HandoffEndSettings;
}

export interface AppendAgentMessageInput {
  handoffSessionId: string;
  userId: string;
  userName: string;
  text: string;
  now: Date;
}

export interface AppendUserMessageInput {
  handoffSessionId: string;
  chatbotId: string;
  rawInput: string;
  conversationLogId: string | null;
  now: Date;
  rawTextMaxAgeMs: number;
}

/**
 * `HandoffSession`/`HandoffMessage` 쓰기 유일 파일(§18 H-2). 게이트·폴링·관리자 서비스·정리 루프가
 * **전부 이 파일을 통해서만** 쓴다. 삭제 코드 0건(§18 H-1) — 상담 기록은 지우지 않는다.
 * 메시지 행의 유일한 갱신은 원문 소거뿐이다(§18 H-3).
 */
@Injectable()
export class HandoffThreadService {
  private readonly logger = new Logger('HandoffThreadService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bannedWordFilter: BannedWordFilterService,
    @Optional() @Inject(WORKFLOW_EVENT_SINK) private readonly workflowEvents?: WorkflowEventSink,
    // [신규 No.42 — 4번째 인자, 선택] `HANDOFF_OPENED` 신호(§8.1). No.41 emit 다음 줄.
    @Optional() @Inject(INBOX_SIGNAL_SINK) private readonly inboxSignals?: InboxSignalSink,
  ) {}

  /** 개입 생성(관리자 ④) — 부분 유니크 위반 시 현재 담당자 이름을 담아 409로 변환한다(P-8). */
  async createHandoff(input: CreateHandoffInput): Promise<{ id: string }> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const session = await tx.handoffSession.create({
          data: {
            chatbotId: input.chatbotId,
            groupId: input.groupId,
            sessionId: input.sessionId,
            sessionRef: input.sessionRef,
            channelType: input.channelType,
            status: 'CONNECTING',
            assignedUserId: input.assignedUserId,
            assignedUserName: input.assignedUserName,
            startedById: input.startedById,
            startedByName: input.startedByName,
            alertLevelAtStart: input.alertLevelAtStart,
            consecutiveUnansweredAtStart: input.consecutiveUnansweredAtStart,
            startedAt: input.now,
            dayBucket: input.dayBucket,
          },
          select: { id: true },
        });
        const connectMessageId = randomUUID();
        await tx.handoffMessage.create({
          data: {
            id: connectMessageId,
            handoffSessionId: session.id,
            chatbotId: input.chatbotId,
            seq: 1,
            sender: 'SYSTEM',
            systemKind: 'CONNECTED',
            text: sealField('HANDOFF_TEXT', connectMessageId, input.connectNotice),
            createdAt: input.now,
          },
        });
        await tx.handoffSession.update({ where: { id: session.id }, data: { lastSeq: 1 } });
        return { id: session.id };
      });
      // [신규 No.41] 트랜잭션 성공 뒤에만 발행한다(§6.2 — 부분 유니크 + 트랜잭션 성공 1회가 1회 근거).
      this.workflowEvents?.emit({
        kind: 'HANDOFF_STARTED',
        chatbotId: input.chatbotId,
        handoffId: result.id,
        sessionRef: input.sessionRef,
        channelType: input.channelType,
        alertLevelAtStart: input.alertLevelAtStart,
        consecutiveUnansweredAtStart: input.consecutiveUnansweredAtStart,
        occurredAt: input.now,
      });
      // [신규 No.42] emit 다음 줄(§8.1·§15.3) — await 0 · 트랜잭션 성공 뒤에만.
      this.inboxSignals?.signal({
        signal: 'HANDOFF_OPENED',
        chatbotId: input.chatbotId,
        sessionId: input.sessionId,
        sessionRef: input.sessionRef,
        channelType: input.channelType,
        handoffId: result.id,
        agentUserId: input.assignedUserId,
        agentUserName: input.assignedUserName,
        occurredAt: input.now,
      });
      return result;
    } catch (e) {
      if (isUniqueConstraintViolation(e)) {
        const active = await this.prisma.handoffSession.findFirst({
          where: { chatbotId: input.chatbotId, sessionId: input.sessionId, status: { in: ['CONNECTING', 'CONNECTED'] } },
          select: { assignedUserName: true },
        });
        throw new ApiException(
          'HANDOFF_ALREADY_ASSIGNED',
          409,
          active ? `이미 ${active.assignedUserName}님이 담당 중입니다.` : '이미 다른 담당자가 개입 중입니다.',
        );
      }
      this.logger.warn(`createHandoff 실패: code=${prismaErrorCode(e)}`);
      throw new ApiException('HANDOFF_UNAVAILABLE', 503, '지금은 상담을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  /** 모던 토큰 1회 발급 CAS(§6.2) — 성공하면 토큰 원문(이 응답에만 존재), 실패(경합에서 짐)하면 null. */
  async issueModernToken(handoffSessionId: string, now: Date): Promise<string | null> {
    const token = generateHandoffToken();
    const tokenHash = hashHandoffToken(token);
    try {
      const result = await this.prisma.handoffSession.updateMany({
        where: { id: handoffSessionId, status: 'CONNECTING', tokenHash: null, clientMode: null },
        data: { tokenHash, tokenIssuedAt: now, clientMode: 'MODERN', status: 'CONNECTED', connectedAt: now },
      });
      return result.count === 1 ? token : null;
    } catch (e) {
      this.logger.warn(`issueModernToken 실패: code=${prismaErrorCode(e)}`);
      return null;
    }
  }

  /** 구버전 위젯 편승 격하 CAS(§6.2 형식) — 토큰 없이 `clientMode=LEGACY`로 확정한다. */
  async markLegacy(handoffSessionId: string, now: Date): Promise<boolean> {
    const result = await this.prisma.handoffSession.updateMany({
      where: { id: handoffSessionId, status: 'CONNECTING', tokenHash: null, clientMode: null },
      data: { clientMode: 'LEGACY', status: 'CONNECTED', connectedAt: now },
    });
    return result.count === 1;
  }

  /** 사용자 메시지 적재(전달 보장 — await, §8.3). 실패는 재시도 가능한 503으로 알린다(FR-CS4-4). */
  async appendUserMessage(input: AppendUserMessageInput): Promise<{ seq: number; maskedText: string }> {
    try {
      const masked = maskPii(await this.bannedWordFilter.maskPlainText(input.rawInput)).maskedText;
      const rawText = masked !== input.rawInput ? input.rawInput : null;
      const rawExpiresAt = rawText ? new Date(input.now.getTime() + input.rawTextMaxAgeMs) : null;

      return await this.prisma.$transaction(async (tx) => {
        const seq = await this.nextSeq(tx, input.handoffSessionId);
        const messageId = randomUUID();
        await tx.handoffMessage.create({
          data: {
            id: messageId,
            handoffSessionId: input.handoffSessionId,
            chatbotId: input.chatbotId,
            seq,
            sender: 'USER',
            text: sealField('HANDOFF_TEXT', messageId, masked),
            rawText: rawText === null ? null : sealField('HANDOFF_RAW_TEXT', messageId, rawText),
            rawExpiresAt,
            conversationLogId: input.conversationLogId,
            createdAt: input.now,
          },
        });
        await tx.handoffSession.update({
          where: { id: input.handoffSessionId },
          data: { lastUserMessageAt: input.now, userMessageCount: { increment: 1 } },
        });
        return { seq, maskedText: masked };
      });
    } catch (e) {
      this.logger.warn(`appendUserMessage 실패: code=${prismaErrorCode(e)}`);
      throw new ApiException('HANDOFF_UNAVAILABLE', 503, '메시지를 전달하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  /** 상담원 메시지 전송(관리자 ⑤) — 담당자 본인만, 출구 마스킹 후 저장(§9.5). */
  async appendAgentMessage(input: AppendAgentMessageInput): Promise<{ seq: number; maskedText: string }> {
    const session = await this.prisma.handoffSession.findUnique({
      where: { id: input.handoffSessionId },
      select: { status: true, assignedUserId: true, chatbotId: true },
    });
    if (!session || !['CONNECTING', 'CONNECTED'].includes(session.status)) {
      throw new ApiException('HANDOFF_NOT_ACTIVE', 409, '이미 종료된 상담입니다.');
    }
    if (session.assignedUserId !== input.userId) {
      throw new ApiException('HANDOFF_NOT_ASSIGNEE', 403, '이 상담의 담당자만 메시지를 보낼 수 있습니다.');
    }

    try {
      const masked = maskPii(await this.bannedWordFilter.maskPlainText(input.text)).maskedText;
      return await this.prisma.$transaction(async (tx) => {
        // 담당자 재확인(경합 — 강제 인수가 그 사이 끼어들 수 있다).
        const guard = await tx.handoffSession.updateMany({
          where: { id: input.handoffSessionId, assignedUserId: input.userId, status: { in: ['CONNECTING', 'CONNECTED'] } },
          data: { lastAgentMessageAt: input.now, agentMessageCount: { increment: 1 } },
        });
        if (guard.count === 0) {
          throw new ApiException('HANDOFF_NOT_ASSIGNEE', 403, '이 상담의 담당자만 메시지를 보낼 수 있습니다.');
        }
        const seq = await this.nextSeq(tx, input.handoffSessionId);
        const messageId = randomUUID();
        await tx.handoffMessage.create({
          data: {
            id: messageId,
            handoffSessionId: input.handoffSessionId,
            chatbotId: session.chatbotId,
            seq,
            sender: 'AGENT',
            senderUserId: input.userId,
            senderUserName: input.userName,
            text: sealField('HANDOFF_TEXT', messageId, masked),
            createdAt: input.now,
          },
        });
        await tx.handoffSession.updateMany({
          where: { id: input.handoffSessionId, firstAgentReplyAt: null },
          data: { firstAgentReplyAt: input.now },
        });
        return { seq, maskedText: masked };
      });
    } catch (e) {
      if (e instanceof ApiException) throw e;
      this.logger.warn(`appendAgentMessage 실패: code=${prismaErrorCode(e)}`);
      throw new ApiException('HANDOFF_UNAVAILABLE', 503, '메시지를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  /**
   * 종료(상담원·관리자·시간 종료·채널 닫힘 공용) — 상태 CAS·종료 SYSTEM 메시지·원문 소거를
   * **한 트랜잭션**으로 처리한다(§8.1). 이미 종료된 상담이면 멱등(count 0)으로 조용히 끝난다.
   */
  async endHandoff(input: EndHandoffInput): Promise<{ ended: boolean }> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await enableSecureDelete(tx);

        const updated = await tx.handoffSession.updateMany({
          where: { id: input.handoffSessionId, status: { in: ['CONNECTING', 'CONNECTED'] } },
          data: {
            status: 'ENDED',
            endReason: input.reason,
            endedAt: input.now,
            endedById: input.endedBy?.id ?? null,
            endedByName: input.endedBy?.name ?? null,
          },
        });

        if (updated.count === 1) {
          const { systemKind, text } = resolveEndSystemMessage(input.reason, input.settings);
          const action = await this.resolveEndButtonAction(tx, input.chatbotId, input.settings);
          const seq = await this.nextSeq(tx, input.handoffSessionId);
          const messageId = randomUUID();
          await tx.handoffMessage.create({
            data: {
              id: messageId,
              handoffSessionId: input.handoffSessionId,
              chatbotId: input.chatbotId,
              seq,
              sender: 'SYSTEM',
              systemKind,
              text: sealField('HANDOFF_TEXT', messageId, text),
              action: action ? JSON.stringify(action) : null,
              createdAt: input.now,
            },
          });
        }

        // 방어선(§8.2) — 이 상담의 남은 원문을 전부 소거한다(멱등 상태에서도 실행 — 잔존 방지).
        await tx.handoffMessage.updateMany({
          where: { handoffSessionId: input.handoffSessionId, rawText: { not: null } },
          data: { rawText: null, rawExpiresAt: null },
        });

        return { ended: updated.count === 1 };
      });
      // [신규 No.41] `ended===true`일 때만 발행한다(§6.2 — 상태 CAS가 1회 근거).
      if (result.ended) {
        this.workflowEvents?.emit({
          kind: 'HANDOFF_ENDED',
          chatbotId: input.chatbotId,
          handoffId: input.handoffSessionId,
          reason: input.reason,
          occurredAt: input.now,
        });
      }
      return result;
    } catch (e) {
      this.logger.warn(`endHandoff 실패: code=${prismaErrorCode(e)}`);
      throw new ApiException('HANDOFF_UNAVAILABLE', 503, '상담 종료 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  /** 강제 인수(관리자 ⑦, ADMIN만 — 서비스 재검증은 호출부). */
  async takeover(handoffSessionId: string, admin: { id: string; name: string }, reason: string, now: Date): Promise<{ ok: boolean }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const session = await tx.handoffSession.findUnique({ where: { id: handoffSessionId }, select: { status: true, chatbotId: true } });
        if (!session || !['CONNECTING', 'CONNECTED'].includes(session.status)) {
          throw new ApiException('HANDOFF_NOT_ACTIVE', 409, '이미 종료된 상담입니다.');
        }
        await tx.handoffSession.update({
          where: { id: handoffSessionId },
          data: { assignedUserId: admin.id, assignedUserName: admin.name },
        });
        const seq = await this.nextSeq(tx, handoffSessionId);
        const messageId = randomUUID();
        await tx.handoffMessage.create({
          data: {
            id: messageId,
            handoffSessionId,
            chatbotId: session.chatbotId,
            seq,
            sender: 'SYSTEM',
            systemKind: 'TAKEOVER',
            senderUserId: admin.id,
            senderUserName: admin.name,
            text: sealField('HANDOFF_TEXT', messageId, `강제 인수: ${reason}`),
            createdAt: now,
          },
        });
        return { ok: true };
      });
    } catch (e) {
      if (e instanceof ApiException) throw e;
      this.logger.warn(`takeover 실패: code=${prismaErrorCode(e)}`);
      throw new ApiException('HANDOFF_UNAVAILABLE', 503, '인수 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }

  /** 미확인 시도 카운트(선점 탐지, §6.4) — CAS 불필요(원자 증가만). */
  async incrementUnverified(handoffSessionId: string): Promise<void> {
    await this.prisma.handoffSession.updateMany({
      where: { id: handoffSessionId },
      data: { unverifiedAttemptCount: { increment: 1 } },
    });
  }

  /** 구버전 편승 전달 커서 전진(역행 방지 CAS). */
  async advanceLegacyCursor(handoffSessionId: string, seq: number): Promise<void> {
    await this.prisma.handoffSession.updateMany({
      where: { id: handoffSessionId, legacyDeliveredSeq: { lt: seq } },
      data: { legacyDeliveredSeq: seq },
    });
  }

  /** 정리 루프 전용 — 만료·종료된 상담의 남은 원문을 소거한다(§8.6 · §9.2 ②). */
  async purgeExpiredRaw(now: Date): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await enableSecureDelete(tx);
        await tx.handoffMessage.updateMany({
          where: { rawExpiresAt: { lte: now }, rawText: { not: null } },
          data: { rawText: null, rawExpiresAt: null },
        });
        const endedWithRaw = await tx.handoffMessage.findMany({
          where: { rawText: { not: null }, handoffSession: { status: 'ENDED' } },
          select: { handoffSessionId: true },
          distinct: ['handoffSessionId'],
        });
        if (endedWithRaw.length > 0) {
          await tx.handoffMessage.updateMany({
            where: { handoffSessionId: { in: endedWithRaw.map((r) => r.handoffSessionId) }, rawText: { not: null } },
            data: { rawText: null, rawExpiresAt: null },
          });
        }
      });
    } catch (e) {
      // PollingLoop가 e.message를 로그에 쓰므로, 코드만 담은 새 Error를 던진다(지시사항).
      this.logger.warn(`purgeExpiredRaw 실패: code=${prismaErrorCode(e)}`);
      throw new Error(prismaErrorCode(e));
    }
  }

  private async nextSeq(tx: Prisma.TransactionClient, handoffSessionId: string): Promise<number> {
    const updated = await tx.handoffSession.update({
      where: { id: handoffSessionId },
      data: { lastSeq: { increment: 1 } },
      select: { lastSeq: true },
    });
    return updated.lastSeq;
  }

  private async resolveEndButtonAction(
    tx: Prisma.TransactionClient,
    chatbotId: string,
    settings: HandoffEndSettings,
  ): Promise<{ kind: 'NODE'; nodeId: string; label: string } | null> {
    if (!settings.endButtonNodeId || !settings.endButtonLabel) return null;
    const node = await tx.dialogNode.findFirst({
      where: { id: settings.endButtonNodeId, chatbotId, enabled: true },
      select: { id: true },
    });
    if (!node) return null;
    return { kind: 'NODE', nodeId: node.id, label: settings.endButtonLabel };
  }
}
