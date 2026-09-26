import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { CustomerLinkSource, CustomerMergeKind, InboxOpenReason, InboxSystemEvent, InboxThreadStatus } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { sealField } from '../../common/crypto/field-crypto';
import { generateCustomerRef } from './lib/customer-ref';
import { assertMergeAllowed } from './lib/merge-rule';
import { computeThreadStatePatch } from './lib/thread-state';
import { shouldReopen } from './lib/open-rule';
import type { MaskedText } from './lib/masked-text';

function isP2002(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

export interface LinkIdentityInput {
  chatbotId: string;
  sessionId: string;
  sessionRef: string;
  channelType: string;
  spaceRef: string;
  customerKey: string;
  fingerprint: string;
  displayName?: MaskedText;
  name?: string;
  now: Date;
}

export type LinkIdentityResult = 'LINKED' | 'ALREADY' | 'PROMOTED' | 'CONFLICT' | 'BLOCKED';

export interface MergeResultInternal {
  mergeId: string;
  movedLinks: number;
  movedEntries: number;
  movedThread: boolean;
  droppedTags: number;
  /** [코드리뷰 R1 반영 B-3] 병합 후 대상 고객의 스레드 id(없으면 null). */
  targetThreadId: string | null;
}

/**
 * ★ [신규 No.42] `customer|customerLink|inboxThread|inboxEntry|inboxTag|inboxThreadTag|customerMerge`
 * 쓰기 유일 파일(O-2) — `sealField('INBOX_ENTRY_TEXT'|'CUSTOMER_DISPLAY_NAME')` 유일 파일(O-4).
 * 텍스트 인자는 `MaskedText` 브랜드만 받는다(마스킹 누락 = 컴파일 오류). 전 쓰기는 `$transaction` +
 * 조건부 갱신(CAS)이다.
 */
@Injectable()
export class InboxStore {
  private readonly logger = new Logger('InboxStore');

  constructor(private readonly prisma: PrismaService) {}

  // ── 고객 생성 ──

  async createAnonymousCustomer(input: { displayName?: MaskedText; createdById?: string; createdByName?: string; now: Date; openReason?: InboxOpenReason }): Promise<{ customerId: string; threadId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          ref: generateCustomerRef(),
          kind: 'ANONYMOUS',
          status: 'ACTIVE',
          displayName: input.displayName ? sealField('CUSTOMER_DISPLAY_NAME', randomUUID(), input.displayName) : null,
          firstSeenAt: input.now,
          lastActivityAt: input.now,
          createdById: input.createdById,
          createdByName: input.createdByName,
        },
        select: { id: true },
      });
      const thread = await tx.inboxThread.create({
        data: {
          customerId: customer.id,
          status: 'OPEN',
          openReason: input.openReason ?? 'MANUAL',
          lastActivityAt: input.now,
          lastActivityKind: 'SYSTEM',
          openedAt: input.now,
        },
        select: { id: true },
      });
      return { customerId: customer.id, threadId: thread.id };
    });
  }

  async createTestCustomer(input: { label: MaskedText; createdById?: string; createdByName?: string; now: Date }): Promise<{ customerId: string; threadId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          ref: generateCustomerRef(),
          kind: 'TEST',
          status: 'ACTIVE',
          displayName: sealField('CUSTOMER_DISPLAY_NAME', randomUUID(), input.label),
          firstSeenAt: input.now,
          lastActivityAt: input.now,
          createdById: input.createdById,
          createdByName: input.createdByName,
        },
        select: { id: true },
      });
      const thread = await tx.inboxThread.create({
        data: { customerId: customer.id, status: 'OPEN', openReason: 'SIMULATION', lastActivityAt: input.now, lastActivityKind: 'SYSTEM', openedAt: input.now },
        select: { id: true },
      });
      return { customerId: customer.id, threadId: thread.id };
    });
  }

  /** 시험 고객 삭제 — 항목·태그 연결·스레드·고객 행 삭제(보존 대상 아님). */
  async deleteTestCustomer(customerId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const thread = await tx.inboxThread.findUnique({ where: { customerId }, select: { id: true } });
      if (thread) {
        await tx.inboxThreadTag.deleteMany({ where: { threadId: thread.id } });
        await tx.inboxEntry.deleteMany({ where: { threadId: thread.id } });
        await tx.inboxThread.delete({ where: { id: thread.id } });
      }
      await tx.customerLink.deleteMany({ where: { customerId } });
      await tx.customer.delete({ where: { id: customerId } });
    });
  }

  // ── 시스템 신호(상담 시작·경고) ──

  /** 스레드 열기/재열림 공통부(§8.1·§8.2 — SIGNAL 트리거) — `ensureThreadForSignal`·`openWarningThread`가 공유한다. */
  private async ensureThreadOpenTx(
    tx: Prisma.TransactionClient,
    customerId: string,
    opts: { openReason: InboxOpenReason; activityKind: string; channelType: string; chatbotId: string; now: Date },
  ): Promise<{ threadId: string; customerId: string; opened: boolean }> {
    const existingThread = await tx.inboxThread.findUnique({ where: { customerId } });
    const now = opts.now;
    if (!existingThread) {
      const thread = await tx.inboxThread.create({
        data: {
          customerId,
          status: 'OPEN',
          openReason: opts.openReason,
          lastActivityAt: now,
          lastActivityKind: opts.activityKind,
          // [코드리뷰 R1 반영 M-3] 신호(상담·경고)는 항상 배포 채널(WEB 실연동) 대화다.
          lastChannelFamily: 'DEPLOY',
          lastChannelType: opts.channelType,
          lastChatbotId: opts.chatbotId,
          openedAt: now,
        },
        select: { id: true },
      });
      return { threadId: thread.id, customerId, opened: true };
    }

    const effective = existingThread.status === 'PENDING' && existingThread.snoozeUntil && existingThread.snoozeUntil.getTime() <= now.getTime() ? 'OPEN' : (existingThread.status as InboxThreadStatus);
    const reopen = shouldReopen(effective, 'SIGNAL');
    const data: Prisma.InboxThreadUpdateInput = {
      lastActivityAt: now,
      lastActivityKind: opts.activityKind,
      lastChannelFamily: 'DEPLOY',
      lastChannelType: opts.channelType,
      lastChatbotId: opts.chatbotId,
      version: { increment: 1 },
    };
    if (reopen) {
      data.status = 'OPEN';
      data.snoozeUntil = null;
      data.closedAt = null;
      data.openedAt = now;
    }
    await tx.inboxThread.update({ where: { id: existingThread.id }, data });
    return { threadId: existingThread.id, customerId, opened: reopen };
  }

  /** 연결이 없으면 익명 고객 + SYSTEM 연결을 만들고 스레드를 열거나 만든다. 연결이 있으면 스레드만 연다/만든다. */
  async ensureThreadForSignal(input: {
    chatbotId: string;
    sessionId: string;
    sessionRef: string;
    channelType: string;
    openReason: InboxOpenReason;
    activityKind: string;
    now: Date;
  }): Promise<{ threadId: string; customerId: string; opened: boolean } | null> {
    return this.prisma.$transaction(async (tx) => {
      let link = await tx.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: input.chatbotId, sessionId: input.sessionId } } });
      let customerId: string;
      if (!link) {
        try {
          const customer = await tx.customer.create({
            data: { ref: generateCustomerRef(), kind: 'ANONYMOUS', status: 'ACTIVE', firstSeenAt: input.now, lastActivityAt: input.now },
            select: { id: true },
          });
          link = await tx.customerLink.create({
            data: {
              customerId: customer.id,
              chatbotId: input.chatbotId,
              sessionId: input.sessionId,
              sessionRef: input.sessionRef,
              channelType: input.channelType,
              source: 'SYSTEM',
              linkedAt: input.now,
            },
          });
          customerId = customer.id;
        } catch (e) {
          if (!isP2002(e)) throw e;
          link = await tx.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: input.chatbotId, sessionId: input.sessionId } } });
          if (!link) return null;
          customerId = link.customerId;
        }
      } else {
        customerId = link.customerId;
      }

      return this.ensureThreadOpenTx(tx, customerId, {
        openReason: input.openReason,
        activityKind: input.activityKind,
        channelType: input.channelType,
        chatbotId: input.chatbotId,
        now: input.now,
      });
    });
  }

  /**
   * [코드리뷰 R2 반영 H-2] 경고 단계 도달 시 열림(§8.1 조건② · AC-OC4-2) — 세션당 1회 클레임과
   * 스레드 열기를 한 트랜잭션으로 묶는다. 사전 `CustomerLink`가 없는 순수 익명 세션에서도
   * 동작해야 한다: 링크가 없으면 익명 고객·링크(생성 시각에 곧바로 `warningOpenedAt` 표식)를
   * 만들어 "생성 자체가 클레임"이 되게 하고(생성 경합 P2002는 흡수해 CAS 분기로 넘어간다),
   * 링크가 이미 있으면 `warningOpenedAt IS NULL` CAS만 수행한다. 클레임에 실패하면(이미
   * 다른 처리가 열었음) 스레드를 건드리지 않고 `null`을 반환한다.
   */
  async openWarningThread(input: { chatbotId: string; sessionId: string; sessionRef: string; channelType: string; now: Date }): Promise<{ threadId: string; customerId: string; opened: boolean } | null> {
    return this.prisma.$transaction(async (tx) => {
      let link = await tx.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: input.chatbotId, sessionId: input.sessionId } } });
      let customerId: string;
      let claimedByCreation = false;

      if (!link) {
        try {
          const customer = await tx.customer.create({
            data: { ref: generateCustomerRef(), kind: 'ANONYMOUS', status: 'ACTIVE', firstSeenAt: input.now, lastActivityAt: input.now },
            select: { id: true },
          });
          link = await tx.customerLink.create({
            data: {
              customerId: customer.id,
              chatbotId: input.chatbotId,
              sessionId: input.sessionId,
              sessionRef: input.sessionRef,
              channelType: input.channelType,
              source: 'SYSTEM',
              linkedAt: input.now,
              warningOpenedAt: input.now,
            },
          });
          customerId = customer.id;
          claimedByCreation = true;
        } catch (e) {
          if (!isP2002(e)) throw e;
          link = await tx.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: input.chatbotId, sessionId: input.sessionId } } });
          if (!link) throw e;
          customerId = link.customerId;
        }
      } else {
        customerId = link.customerId;
      }

      if (!claimedByCreation) {
        const cas = await tx.customerLink.updateMany({
          where: { chatbotId: input.chatbotId, sessionId: input.sessionId, warningOpenedAt: null },
          data: { warningOpenedAt: input.now },
        });
        if (cas.count === 0) return null;
      }

      return this.ensureThreadOpenTx(tx, customerId, {
        openReason: 'WARNING',
        activityKind: 'WARNING',
        channelType: input.channelType,
        chatbotId: input.chatbotId,
        now: input.now,
      });
    });
  }

  // ── 수동 연결·분리 ──

  async manualLinkCreate(input: { customerId: string; chatbotId: string; sessionId: string; sessionRef: string; channelType: string; linkedById?: string; linkedByName?: string; now: Date }): Promise<{ linkId: string }> {
    const link = await this.prisma.customerLink.upsert({
      where: { chatbotId_sessionId: { chatbotId: input.chatbotId, sessionId: input.sessionId } },
      create: {
        customerId: input.customerId,
        chatbotId: input.chatbotId,
        sessionId: input.sessionId,
        sessionRef: input.sessionRef,
        channelType: input.channelType,
        source: 'MANUAL',
        linkedById: input.linkedById,
        linkedByName: input.linkedByName,
        linkedAt: input.now,
      },
      update: {},
      select: { id: true },
    });
    return { linkId: link.id };
  }

  async manualLinkReassign(linkId: string, targetCustomerId: string, previousCustomerId: string, previousSource: CustomerLinkSource, actor: { id?: string; name?: string }, now: Date): Promise<void> {
    await this.prisma.customerLink.update({
      where: { id: linkId },
      data: {
        customerId: targetCustomerId,
        source: 'MANUAL',
        previousCustomerId,
        previousSource,
        linkedById: actor.id,
        linkedByName: actor.name,
        linkedAt: now,
      },
    });
  }

  async unlinkRevert(linkId: string, previousCustomerId: string, previousSource: string): Promise<void> {
    await this.prisma.customerLink.update({
      where: { id: linkId },
      data: { customerId: previousCustomerId, source: previousSource, previousCustomerId: null, previousSource: null },
    });
  }

  async unlinkDelete(linkId: string): Promise<void> {
    await this.prisma.customerLink.delete({ where: { id: linkId } });
  }

  /** ADMIN 전용 IDENTITY 분리 — 새 익명 고객으로 옮기고 이후 이 세션의 식별 토큰을 무시한다. */
  async unlinkIdentityToNewAnonymous(linkId: string, now: Date): Promise<{ customerId: string }> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: { ref: generateCustomerRef(), kind: 'ANONYMOUS', status: 'ACTIVE', firstSeenAt: now, lastActivityAt: now },
        select: { id: true },
      });
      await tx.customerLink.update({
        where: { id: linkId },
        data: { customerId: customer.id, source: 'MANUAL', identityBlockedAt: now, identityVerifiedAt: null },
      });
      return { customerId: customer.id };
    });
  }

  // ── 식별 연결(fire-and-forget 적재) ──

  async linkIdentity(input: LinkIdentityInput): Promise<LinkIdentityResult> {
    return this.prisma.$transaction(async (tx) => {
      let customer = await tx.customer.findUnique({ where: { customerKeyHash: input.customerKey } });
      if (!customer) {
        try {
          customer = await tx.customer.create({
            data: {
              ref: generateCustomerRef(),
              kind: 'IDENTIFIED',
              status: 'ACTIVE',
              identitySpaceRef: input.spaceRef,
              customerKeyHash: input.customerKey,
              keyFingerprint: input.fingerprint,
              displayName: input.displayName ? sealField('CUSTOMER_DISPLAY_NAME', randomUUID(), input.displayName) : null,
              firstSeenAt: input.now,
              lastActivityAt: input.now,
            },
          });
        } catch (e) {
          if (!isP2002(e)) throw e;
          customer = await tx.customer.findUnique({ where: { customerKeyHash: input.customerKey } });
          if (!customer) throw e;
        }
      } else {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            lastActivityAt: input.now,
            keyFingerprint: input.fingerprint,
            ...(input.displayName ? { displayName: sealField('CUSTOMER_DISPLAY_NAME', customer.id, input.displayName) } : {}),
          },
        });
      }

      let link = await tx.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: input.chatbotId, sessionId: input.sessionId } } });
      let result: LinkIdentityResult;
      if (!link) {
        try {
          link = await tx.customerLink.create({
            data: {
              customerId: customer.id,
              chatbotId: input.chatbotId,
              sessionId: input.sessionId,
              sessionRef: input.sessionRef,
              channelType: input.channelType,
              source: 'IDENTITY',
              identityVerifiedAt: input.now,
              linkedAt: input.now,
            },
          });
          result = 'LINKED';
        } catch (e) {
          if (!isP2002(e)) throw e;
          link = await tx.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: input.chatbotId, sessionId: input.sessionId } } });
          if (!link) throw e;
          result = link.customerId === customer.id ? 'ALREADY' : 'CONFLICT';
        }
      } else if (link.customerId === customer.id) {
        await tx.customerLink.update({ where: { id: link.id }, data: { identityVerifiedAt: input.now } });
        result = 'ALREADY';
      } else if (link.identityBlockedAt) {
        result = 'BLOCKED';
      } else {
        const linkedCustomer = await tx.customer.findUnique({ where: { id: link.customerId } });
        if (linkedCustomer && linkedCustomer.kind === 'ANONYMOUS' && linkedCustomer.status === 'ACTIVE') {
          await this.mergeCustomersTx(tx, {
            sourceCustomerId: linkedCustomer.id,
            targetCustomerId: customer.id,
            kind: 'IDENTITY_PROMOTION',
            mergedById: undefined,
            mergedByName: 'system',
            now: input.now,
          });
          await tx.customerLink.update({ where: { id: link.id }, data: { identityVerifiedAt: input.now } });
          result = 'PROMOTED';
        } else {
          result = 'CONFLICT';
        }
      }

      if (result === 'LINKED' || result === 'ALREADY' || result === 'PROMOTED') {
        const thread = await tx.inboxThread.findUnique({ where: { customerId: customer.id } });
        if (thread) {
          await tx.inboxThread.update({
            where: { id: thread.id },
            // [코드리뷰 R1 반영 M-3] 식별 연결도 배포 채널(WEB 실연동) 대화다.
            data: { lastActivityAt: input.now, lastActivityKind: 'CONVERSATION', lastChannelFamily: 'DEPLOY', lastChannelType: input.channelType, lastChatbotId: input.chatbotId },
          });
        }
      }

      return result;
    });
  }

  // ── 스레드 상태·담당·태그 ──

  /**
   * [코드리뷰 R2 반영 L-4] 상담원 쪽 사건(§8.1 조건④ "대화 보기에서 스레드 열기")으로 기존
   * 스레드를 다시 연다 — §8.2 재열림 규칙(MANUAL 트리거): `CLOSED` → `OPEN`만(`PENDING`은
   * 유지). 이미 `OPEN`이거나 `PENDING`이면 아무것도 하지 않는다(no-op — `opened: false`).
   */
  async reopenClosedThreadManual(threadId: string, now: Date): Promise<{ opened: boolean }> {
    const thread = await this.prisma.inboxThread.findUnique({ where: { id: threadId }, select: { status: true, snoozeUntil: true, hiddenByMergeId: true } });
    if (!thread || thread.hiddenByMergeId) return { opened: false };
    const effective = thread.status === 'PENDING' && thread.snoozeUntil && thread.snoozeUntil.getTime() <= now.getTime() ? 'OPEN' : (thread.status as InboxThreadStatus);
    if (!shouldReopen(effective, 'MANUAL')) return { opened: false };
    await this.prisma.inboxThread.update({
      where: { id: threadId },
      data: { status: 'OPEN', snoozeUntil: null, closedAt: null, openedAt: now, lastActivityAt: now, version: { increment: 1 } },
    });
    return { opened: true };
  }

  async updateThreadState(threadId: string, expectedVersion: number, next: { status: InboxThreadStatus; snoozeUntil?: Date }, now: Date): Promise<boolean> {
    const patch = computeThreadStatePatch(next, now);
    const result = await this.prisma.inboxThread.updateMany({
      where: { id: threadId, version: expectedVersion, hiddenByMergeId: null },
      data: { status: patch.status, snoozeUntil: patch.snoozeUntil, closedAt: patch.closedAt, version: { increment: 1 } },
    });
    return result.count > 0;
  }

  async claimThread(threadId: string, expectedVersion: number, userId: string, userName: string): Promise<boolean> {
    const result = await this.prisma.inboxThread.updateMany({
      where: { id: threadId, version: expectedVersion, assigneeUserId: null, hiddenByMergeId: null },
      data: { assigneeUserId: userId, assigneeUserName: userName, version: { increment: 1 } },
    });
    return result.count > 0;
  }

  async assignThread(threadId: string, expectedVersion: number, userId: string, userName: string): Promise<boolean> {
    const result = await this.prisma.inboxThread.updateMany({
      where: { id: threadId, version: expectedVersion, hiddenByMergeId: null },
      data: { assigneeUserId: userId, assigneeUserName: userName, version: { increment: 1 } },
    });
    return result.count > 0;
  }

  async releaseThread(threadId: string, expectedVersion: number): Promise<boolean> {
    const result = await this.prisma.inboxThread.updateMany({
      where: { id: threadId, version: expectedVersion, hiddenByMergeId: null },
      data: { assigneeUserId: null, assigneeUserName: null, version: { increment: 1 } },
    });
    return result.count > 0;
  }

  async setThreadTags(threadId: string, expectedVersion: number, tagIds: string[], addedById?: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.inboxThread.updateMany({ where: { id: threadId, version: expectedVersion, hiddenByMergeId: null }, data: { version: { increment: 1 } } });
      if (result.count === 0) return false;
      await tx.inboxThreadTag.deleteMany({ where: { threadId } });
      if (tagIds.length > 0) {
        await tx.inboxThreadTag.createMany({ data: tagIds.map((tagId) => ({ threadId, tagId, addedById })) });
      }
      return true;
    });
  }

  // ── 태그(전역 목록) ──

  async createTag(name: string, nameNormalized: string, color: string): Promise<{ id: string; name: string; color: string }> {
    return this.prisma.inboxTag.create({ data: { name, nameNormalized, color } });
  }

  async updateTag(tagId: string, name: string, nameNormalized: string, color: string): Promise<{ id: string; name: string; color: string }> {
    return this.prisma.inboxTag.update({ where: { id: tagId }, data: { name, nameNormalized, color } });
  }

  async deleteTag(tagId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.inboxThreadTag.deleteMany({ where: { tagId } });
      await tx.inboxTag.delete({ where: { id: tagId } });
    });
  }

  async appendSystemEntry(threadId: string, event: InboxSystemEvent, meta: Record<string, unknown>, now: Date): Promise<void> {
    await this.prisma.inboxEntry.create({
      data: { id: randomUUID(), threadId, kind: 'SYSTEM', text: '', meta: JSON.stringify({ event, ...meta }), occurredAt: now },
    });
  }

  // ── 메모·기록·시뮬레이션 ──

  async createNote(threadId: string, text: MaskedText, authorId: string, authorName: string, now: Date): Promise<{ entryId: string }> {
    const entryId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.inboxEntry.create({
        data: { id: entryId, threadId, kind: 'NOTE', text: sealField('INBOX_ENTRY_TEXT', entryId, text), occurredAt: now, authorUserId: authorId, authorName },
      });
      // 메모는 채널 개념이 없다 — 스레드의 lastChannelFamily/lastChannelType을 바꾸지 않는다.
      await this.touchThreadForEntry(tx, threadId, entryId, 'NOTE', now, 'MANUAL');
    });
    return { entryId };
  }

  async updateNote(entryId: string, text: MaskedText, now: Date): Promise<void> {
    await this.prisma.inboxEntry.update({ where: { id: entryId }, data: { text: sealField('INBOX_ENTRY_TEXT', entryId, text), editedAt: now } });
  }

  async createRecord(
    threadId: string,
    input: { recordChannel: string; direction: string; outcome?: string; occurredAt: Date; text: MaskedText },
    authorId: string,
    authorName: string,
    now: Date,
  ): Promise<{ entryId: string }> {
    const entryId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.inboxEntry.create({
        data: {
          id: entryId,
          threadId,
          kind: 'RECORD',
          recordChannel: input.recordChannel,
          direction: input.direction,
          outcome: input.outcome,
          text: sealField('INBOX_ENTRY_TEXT', entryId, input.text),
          occurredAt: input.occurredAt,
          authorUserId: authorId,
          authorName,
        },
      });
      // [코드리뷰 R1 반영 M-3] 수동 기록 = RECORD 채널(전화·이메일·방문·기타).
      await this.touchThreadForEntry(tx, threadId, entryId, 'RECORD', now, 'MANUAL', { channelFamily: 'RECORD', channelType: input.recordChannel });
    });
    return { entryId };
  }

  async createSimulationEntries(threadId: string, chatbotId: string, simulatedChannel: string, userText: MaskedText, botText: MaskedText, now: Date): Promise<{ userEntryId: string; botEntryId: string }> {
    const userEntryId = randomUUID();
    const botEntryId = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.inboxEntry.create({
        data: { id: userEntryId, threadId, kind: 'SIM_USER', simulatedChannel, chatbotId, text: sealField('INBOX_ENTRY_TEXT', userEntryId, userText), occurredAt: now },
      });
      await tx.inboxEntry.create({
        data: { id: botEntryId, threadId, kind: 'SIM_BOT', simulatedChannel, chatbotId, text: sealField('INBOX_ENTRY_TEXT', botEntryId, botText), occurredAt: now },
      });
      // [코드리뷰 R1 반영 M-3] 시뮬레이션 = SIMULATED 채널.
      await this.touchThreadForEntry(tx, threadId, botEntryId, 'SIMULATION', now, 'MANUAL', { channelFamily: 'SIMULATED', channelType: simulatedChannel });
    });
    return { userEntryId, botEntryId };
  }

  private async touchThreadForEntry(
    tx: Prisma.TransactionClient,
    threadId: string,
    lastEntryId: string,
    activityKind: string,
    now: Date,
    trigger: 'MANUAL' | 'SIGNAL',
    channel?: { channelFamily: string; channelType: string },
  ): Promise<void> {
    const thread = await tx.inboxThread.findUnique({ where: { id: threadId } });
    if (!thread) return;
    const effective = thread.status === 'PENDING' && thread.snoozeUntil && thread.snoozeUntil.getTime() <= now.getTime() ? 'OPEN' : (thread.status as InboxThreadStatus);
    const reopen = shouldReopen(effective, trigger);
    const data: Prisma.InboxThreadUpdateInput = {
      lastActivityAt: now,
      lastActivityKind: activityKind,
      lastEntryId,
      version: { increment: 1 },
      ...(channel ? { lastChannelFamily: channel.channelFamily, lastChannelType: channel.channelType } : {}),
    };
    if (reopen) {
      data.status = 'OPEN';
      data.snoozeUntil = null;
      data.closedAt = null;
      data.openedAt = now;
    }
    await tx.inboxThread.update({ where: { id: threadId }, data });
  }

  // ── 병합·되돌리기 ──

  async mergeCustomers(input: { sourceCustomerId: string; targetCustomerId: string; kind: CustomerMergeKind; mergedById?: string; mergedByName?: string; now: Date }): Promise<MergeResultInternal> {
    return this.prisma.$transaction((tx) => this.mergeCustomersTx(tx, input));
  }

  private async mergeCustomersTx(
    tx: Prisma.TransactionClient,
    input: { sourceCustomerId: string; targetCustomerId: string; kind: CustomerMergeKind; mergedById?: string; mergedByName?: string; now: Date },
  ): Promise<MergeResultInternal> {
    const source = await tx.customer.findUnique({ where: { id: input.sourceCustomerId } });
    const target = await tx.customer.findUnique({ where: { id: input.targetCustomerId } });
    if (!source || !target) throw new Error('CUSTOMER_MERGE_FORBIDDEN');
    const allowed = assertMergeAllowed(source.id, { kind: source.kind as never, status: source.status as never, identityPurgedAt: source.identityPurgedAt }, target.id, {
      kind: target.kind as never,
      status: target.status as never,
      identityPurgedAt: target.identityPurgedAt,
    });
    if (!allowed.ok) throw new Error('CUSTOMER_MERGE_FORBIDDEN');

    const cas = await tx.customer.updateMany({ where: { id: source.id, status: 'ACTIVE' }, data: { status: 'MERGED', mergedIntoId: target.id } });
    if (cas.count === 0) throw new Error('CUSTOMER_MERGE_FORBIDDEN');

    const movedLinkRows = await tx.customerLink.findMany({ where: { customerId: source.id }, select: { id: true } });
    const movedLinkIds = movedLinkRows.map((r) => r.id);
    if (movedLinkIds.length > 0) {
      await tx.customerLink.updateMany({ where: { id: { in: movedLinkIds } }, data: { customerId: target.id } });
    }

    const sourceThread = await tx.inboxThread.findUnique({ where: { customerId: source.id } });
    const targetThread = await tx.inboxThread.findUnique({ where: { customerId: target.id } });

    const mergeId = randomUUID();
    let movedEntryIds: string[] = [];
    let movedThread = false;
    let addedTagIds: string[] = [];
    let droppedTags = 0;
    let sourceThreadPriorStatus: string | null = null;

    if (sourceThread) {
      sourceThreadPriorStatus = sourceThread.status;
      if (!targetThread) {
        await tx.inboxThread.update({
          where: { id: sourceThread.id },
          data: { customerId: target.id, version: { increment: 1 } },
        });
        movedThread = true;
      } else {
        const entryRows = await tx.inboxEntry.findMany({ where: { threadId: sourceThread.id }, select: { id: true } });
        movedEntryIds = entryRows.map((r) => r.id);
        if (movedEntryIds.length > 0) {
          await tx.inboxEntry.updateMany({ where: { id: { in: movedEntryIds } }, data: { threadId: targetThread.id } });
        }

        const sourceTags = await tx.inboxThreadTag.findMany({ where: { threadId: sourceThread.id } });
        const targetTagRows = await tx.inboxThreadTag.findMany({ where: { threadId: targetThread.id } });
        const targetTagIds = new Set(targetTagRows.map((t) => t.tagId));
        const capacity = Math.max(0, 10 - targetTagIds.size);
        const toAdd = sourceTags.filter((t) => !targetTagIds.has(t.tagId));
        const accepted = toAdd.slice(0, capacity);
        droppedTags = toAdd.length - accepted.length;
        if (accepted.length > 0) {
          await tx.inboxThreadTag.createMany({ data: accepted.map((t) => ({ threadId: targetThread.id, tagId: t.tagId })) });
        }
        addedTagIds = accepted.map((t) => t.tagId);

        await tx.inboxThread.update({
          where: { id: sourceThread.id },
          data: { hiddenByMergeId: mergeId },
        });
        await tx.inboxThread.update({
          where: { id: targetThread.id },
          data: {
            lastActivityAt: sourceThread.lastActivityAt > targetThread.lastActivityAt ? sourceThread.lastActivityAt : targetThread.lastActivityAt,
            version: { increment: 1 },
          },
        });
      }
    }

    await tx.customerMerge.create({
      data: {
        id: mergeId,
        kind: input.kind,
        sourceCustomerId: source.id,
        targetCustomerId: target.id,
        sourceThreadId: sourceThread?.id,
        targetThreadId: targetThread?.id ?? (movedThread ? sourceThread?.id : undefined),
        movedThread,
        movedLinkIds: JSON.stringify(movedLinkIds),
        movedEntryIds: JSON.stringify(movedEntryIds),
        addedTagIds: JSON.stringify(addedTagIds),
        sourceThreadPriorStatus,
        mergedById: input.mergedById,
        mergedByName: input.mergedByName,
        mergedAt: input.now,
      },
    });

    const finalTargetThread = targetThread ?? (movedThread ? await tx.inboxThread.findUnique({ where: { customerId: target.id } }) : null);
    if (finalTargetThread) {
      await tx.inboxEntry.create({
        data: {
          id: randomUUID(),
          threadId: finalTargetThread.id,
          kind: 'SYSTEM',
          text: '',
          // [코드리뷰 R1 반영 B-2] 되돌리기 버튼이 쓸 수 있게 mergeId를 meta에 싣는다.
          // [계약 보강] 콘솔이 되돌리기 버튼 노출을 사전 판정(서버 재조회 0)할 수 있게
          // mergedByUserId·mergedAt·mergeKind를 meta에 추가한다(ui-spec §3.6b). 시스템
          // 승격(IDENTITY_PROMOTION)은 수행자가 없어 mergedByUserId=null.
          meta: JSON.stringify({
            event: input.kind === 'IDENTITY_PROMOTION' ? 'PROMOTED' : 'MERGED_IN',
            mergeId,
            sourceAlias: source.ref.slice(0, 6),
            mergedByUserId: input.mergedById ?? null,
            mergedAt: input.now.toISOString(),
            mergeKind: input.kind === 'IDENTITY_PROMOTION' ? 'PROMOTED' : 'MANUAL',
          }),
          occurredAt: input.now,
        },
      });
    }

    return { mergeId, movedLinks: movedLinkIds.length, movedEntries: movedEntryIds.length, movedThread, droppedTags, targetThreadId: finalTargetThread?.id ?? null };
  }

  async revertMerge(mergeId: string, revertedById: string | undefined, revertedByName: string | undefined, now: Date): Promise<{ revertedLinks: number; skippedLinks: number; revertedEntries: number }> {
    return this.prisma.$transaction(async (tx) => {
      const merge = await tx.customerMerge.findUnique({ where: { id: mergeId } });
      if (!merge || merge.revertedAt) throw new Error('CUSTOMER_MERGE_NOT_REVERTIBLE');

      const target = await tx.customer.findUnique({ where: { id: merge.targetCustomerId } });
      if (!target || target.status !== 'ACTIVE') throw new Error('CUSTOMER_MERGE_NOT_REVERTIBLE');

      const casSource = await tx.customer.updateMany({ where: { id: merge.sourceCustomerId, status: 'MERGED' }, data: { status: 'ACTIVE', mergedIntoId: null } });
      if (casSource.count === 0) throw new Error('CUSTOMER_MERGE_NOT_REVERTIBLE');

      const movedLinkIds: string[] = JSON.parse(merge.movedLinkIds);
      const movedEntryIds: string[] = JSON.parse(merge.movedEntryIds);
      const addedTagIds: string[] = JSON.parse(merge.addedTagIds);

      const revertible = await tx.customerLink.findMany({ where: { id: { in: movedLinkIds }, customerId: merge.targetCustomerId }, select: { id: true } });
      const revertibleIds = revertible.map((r) => r.id);
      const skippedLinks = movedLinkIds.length - revertibleIds.length;
      if (revertibleIds.length > 0) {
        await tx.customerLink.updateMany({ where: { id: { in: revertibleIds } }, data: { customerId: merge.sourceCustomerId } });
      }

      let revertedEntries = 0;
      if (merge.movedThread && merge.sourceThreadId) {
        await tx.inboxThread.update({ where: { id: merge.sourceThreadId }, data: { customerId: merge.sourceCustomerId, version: { increment: 1 } } });
      } else if (merge.targetThreadId && movedEntryIds.length > 0) {
        const entryResult = await tx.inboxEntry.updateMany({ where: { id: { in: movedEntryIds }, threadId: merge.targetThreadId }, data: { threadId: merge.sourceThreadId ?? undefined } });
        revertedEntries = entryResult.count;
      }

      if (merge.sourceThreadId) {
        if (addedTagIds.length > 0 && merge.targetThreadId) {
          await tx.inboxThreadTag.deleteMany({ where: { threadId: merge.targetThreadId, tagId: { in: addedTagIds } } });
        }
        await tx.inboxThread.update({
          where: { id: merge.sourceThreadId },
          data: { hiddenByMergeId: null, status: merge.sourceThreadPriorStatus ?? 'OPEN', version: { increment: 1 } },
        });
        await tx.inboxEntry.create({
          data: { id: randomUUID(), threadId: merge.sourceThreadId, kind: 'SYSTEM', text: '', meta: JSON.stringify({ event: 'MERGE_REVERTED' }), occurredAt: now },
        });
      }
      if (merge.targetThreadId) {
        await tx.inboxEntry.create({
          data: { id: randomUUID(), threadId: merge.targetThreadId, kind: 'SYSTEM', text: '', meta: JSON.stringify({ event: 'MERGE_REVERTED' }), occurredAt: now },
        });
      }

      await tx.customerMerge.update({ where: { id: mergeId }, data: { revertedAt: now, revertedById, revertedByName } });

      return { revertedLinks: revertibleIds.length, skippedLinks, revertedEntries };
    });
  }
}
