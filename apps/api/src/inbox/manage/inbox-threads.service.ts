import { Injectable } from '@nestjs/common';
import type {
  AssignThreadDto,
  CreateNoteDto,
  CreateRecordDto,
  InboxMaskPreviewResponse,
  InboxThreadListItem,
  OpenThreadFromSessionDto,
  OpenThreadFromSessionResponse,
  ReleaseThreadDto,
  SetThreadTagsDto,
  UpdateNoteDto,
  UpdateThreadStateDto,
} from '@chat-bot/shared-types';
import { INBOX_LIMITS, hasPermission } from '@chat-bot/shared-types';
import type { SessionUser } from '../../common/auth/session-context';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxStore } from '../core/inbox.store';
import { maskForInbox } from '../core/lib/masked-text';
import { InboxParticipationCache } from '../core/inbox-participation.cache';
import { SessionRefLookupService } from '../read/session-ref-lookup';
import { InboxThreadDetailService } from '../read/inbox-thread-detail.service';

const THREAD_NOT_FOUND = '요청하신 스레드를 찾을 수 없습니다.';

/** [신규 No.42] 상태·담당·태그 부착·메모·기록·세션에서 열기(§8·§14 — 감사 포함). */
@Injectable()
export class InboxThreadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: InboxStore,
    private readonly detail: InboxThreadDetailService,
    private readonly participation: InboxParticipationCache,
    private readonly sessionRefLookup: SessionRefLookupService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async assertThreadEditable(threadId: string): Promise<{ status: string; hiddenByMergeId: string | null }> {
    const thread = await this.prisma.inboxThread.findUnique({ where: { id: threadId }, select: { status: true, hiddenByMergeId: true } });
    if (!thread) throw new ApiException('NOT_FOUND', 404, THREAD_NOT_FOUND);
    if (thread.hiddenByMergeId) throw new ApiException('INBOX_THREAD_CONFLICT', 409, '병합으로 숨겨진 스레드는 편집할 수 없습니다.');
    return thread;
  }

  private async reload(threadId: string): Promise<InboxThreadListItem> {
    const d = await this.detail.detail(threadId, undefined);
    return d.thread;
  }

  async updateState(threadId: string, dto: UpdateThreadStateDto, actor: SessionUser): Promise<InboxThreadListItem> {
    const before = await this.assertThreadEditable(threadId);
    const ok = await this.store.updateThreadState(threadId, dto.version, { status: dto.status, snoozeUntil: dto.snoozeUntil }, new Date());
    if (!ok) throw new ApiException('INBOX_THREAD_CONFLICT', 409, '다른 사람이 먼저 상태를 바꿨습니다. 새로 불러와 주세요.');
    await this.store.appendSystemEntry(threadId, 'STATUS', { from: before.status, to: dto.status }, new Date());
    await this.auditLog.record({ action: 'STATUS_CHANGE', targetType: 'InboxThread', targetId: threadId, summary: `상태: ${before.status} → ${dto.status}` });
    return this.reload(threadId);
  }

  async claim(threadId: string, actor: SessionUser): Promise<InboxThreadListItem> {
    await this.assertThreadEditable(threadId);
    const version = (await this.prisma.inboxThread.findUniqueOrThrow({ where: { id: threadId }, select: { version: true } })).version;
    const ok = await this.store.claimThread(threadId, version, actor.id, actor.name);
    if (!ok) throw new ApiException('INBOX_THREAD_CONFLICT', 409, '이미 다른 담당자가 가져갔습니다.');
    await this.auditLog.record({ action: 'UPDATE', targetType: 'InboxThread', targetId: threadId, summary: `담당: 없음 → ${actor.name}` });
    return this.reload(threadId);
  }

  async assign(threadId: string, dto: AssignThreadDto, actor: SessionUser): Promise<InboxThreadListItem> {
    await this.assertThreadEditable(threadId);
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, name: true, role: true, status: true } });
    if (!target) throw new ApiException('VALIDATION_FAILED', 400, '지정할 담당자를 찾을 수 없습니다.');
    if (!hasPermission(target.role as never, 'cs:write')) throw new ApiException('VALIDATION_FAILED', 400, '해당 사용자는 담당자로 지정할 수 없습니다.');
    const ok = await this.store.assignThread(threadId, dto.version, target.id, target.name);
    if (!ok) throw new ApiException('INBOX_THREAD_CONFLICT', 409, '다른 사람이 먼저 담당을 바꿨습니다. 새로 불러와 주세요.');
    await this.auditLog.record({ action: 'UPDATE', targetType: 'InboxThread', targetId: threadId, summary: `담당 변경: → ${target.name}` });
    return this.reload(threadId);
  }

  async release(threadId: string, dto: ReleaseThreadDto, actor: SessionUser): Promise<InboxThreadListItem> {
    await this.assertThreadEditable(threadId);
    const row = await this.prisma.inboxThread.findUniqueOrThrow({ where: { id: threadId }, select: { assigneeUserId: true } });
    if (row.assigneeUserId !== actor.id && actor.role !== 'ADMIN') throw new ApiException('FORBIDDEN', 403, '담당자 본인 또는 관리자만 놓을 수 있습니다.');
    const ok = await this.store.releaseThread(threadId, dto.version);
    if (!ok) throw new ApiException('INBOX_THREAD_CONFLICT', 409, '다른 사람이 먼저 바꿨습니다. 새로 불러와 주세요.');
    await this.auditLog.record({ action: 'UPDATE', targetType: 'InboxThread', targetId: threadId, summary: '담당: 놓음' });
    return this.reload(threadId);
  }

  async setTags(threadId: string, dto: SetThreadTagsDto, actor: SessionUser): Promise<InboxThreadListItem> {
    await this.assertThreadEditable(threadId);
    if (dto.tagIds.length > 0) {
      const count = await this.prisma.inboxTag.count({ where: { id: { in: dto.tagIds } } });
      if (count !== dto.tagIds.length) throw new ApiException('VALIDATION_FAILED', 400, '존재하지 않는 태그가 포함되어 있습니다.');
    }
    const ok = await this.store.setThreadTags(threadId, dto.version, dto.tagIds, actor.id);
    if (!ok) throw new ApiException('INBOX_THREAD_CONFLICT', 409, '다른 사람이 먼저 바꿨습니다. 새로 불러와 주세요.');
    await this.store.appendSystemEntry(threadId, 'TAGS', { tagIds: dto.tagIds }, new Date());
    return this.reload(threadId);
  }

  async createNote(threadId: string, dto: CreateNoteDto, actor: SessionUser): Promise<InboxThreadListItem> {
    await this.assertThreadEditable(threadId);
    const masked = maskForInbox(dto.text);
    await this.store.createNote(threadId, masked, actor.id, actor.name, new Date());
    return this.reload(threadId);
  }

  async updateNote(threadId: string, entryId: string, dto: UpdateNoteDto, actor: SessionUser): Promise<InboxThreadListItem> {
    const entry = await this.prisma.inboxEntry.findUnique({ where: { id: entryId } });
    if (!entry || entry.kind !== 'NOTE' || entry.threadId !== threadId) throw new ApiException('NOT_FOUND', 404, '요청하신 메모를 찾을 수 없습니다.');
    if (entry.authorUserId !== actor.id) throw new ApiException('FORBIDDEN', 403, '작성자 본인만 수정할 수 있습니다.');
    const ageMs = Date.now() - entry.createdAt.getTime();
    if (ageMs > INBOX_LIMITS.noteEditWindowMinutes * 60_000) throw new ApiException('FORBIDDEN', 403, '작성 후 10분이 지나 수정할 수 없습니다.');
    const masked = maskForInbox(dto.text);
    await this.store.updateNote(entryId, masked, new Date());
    return this.reload(entry.threadId);
  }

  async createRecord(threadId: string, dto: CreateRecordDto, actor: SessionUser): Promise<InboxThreadListItem> {
    await this.assertThreadEditable(threadId);
    const now = new Date();
    const earliest = now.getTime() - INBOX_LIMITS.recordPastDays * 86_400_000;
    const latest = now.getTime() + INBOX_LIMITS.recordFutureSlackSec * 1000;
    if (dto.occurredAt.getTime() < earliest || dto.occurredAt.getTime() > latest) {
      throw new ApiException('VALIDATION_FAILED', 400, '발생 시각이 허용 범위를 벗어났습니다(최근 7일 이내).');
    }
    const masked = maskForInbox(dto.text);
    await this.store.createRecord(threadId, { recordChannel: dto.recordChannel, direction: dto.direction, outcome: dto.outcome, occurredAt: dto.occurredAt, text: masked }, actor.id, actor.name, now);
    return this.reload(threadId);
  }

  async openFromSession(dto: OpenThreadFromSessionDto, actor: SessionUser): Promise<OpenThreadFromSessionResponse> {
    const participating = await this.participation.isParticipating(dto.chatbotId);
    if (!participating) throw new ApiException('VALIDATION_FAILED', 400, '참여 중인 챗봇이 아닙니다.');
    const sessionId = await this.sessionRefLookup.resolve(dto.chatbotId, dto.sessionRef);
    if (!sessionId) throw new ApiException('NOT_FOUND', 404, '해당 세션을 찾을 수 없습니다.');

    const existingLink = await this.prisma.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: dto.chatbotId, sessionId } } });
    let customerId: string;
    if (existingLink) {
      customerId = existingLink.customerId;
    } else {
      const created = await this.store.createAnonymousCustomer({ now: new Date(), openReason: 'MANUAL' });
      customerId = created.customerId;
      await this.store.manualLinkCreate({
        customerId,
        chatbotId: dto.chatbotId,
        sessionId,
        sessionRef: dto.sessionRef,
        channelType: 'WEB',
        linkedById: actor.id,
        linkedByName: actor.name,
        now: new Date(),
      });
    }

    let thread = await this.prisma.inboxThread.findUnique({ where: { customerId } });
    if (!thread) {
      const result = await this.store.ensureThreadForSignal({ chatbotId: dto.chatbotId, sessionId, sessionRef: dto.sessionRef, channelType: 'WEB', openReason: 'MANUAL', activityKind: 'SYSTEM', now: new Date() });
      if (!result) throw new ApiException('NOT_FOUND', 404, THREAD_NOT_FOUND);
      return { threadId: result.threadId };
    }
    // [코드리뷰 R2 반영 L-4] 기존 스레드가 CLOSED면 §8.2대로 다시 연다(상담원 쪽 사건 = MANUAL 트리거).
    await this.store.reopenClosedThreadManual(thread.id, new Date());
    return { threadId: thread.id };
  }

  async maskPreview(text: string): Promise<InboxMaskPreviewResponse> {
    const masked = maskForInbox(text);
    return { masked };
  }
}
