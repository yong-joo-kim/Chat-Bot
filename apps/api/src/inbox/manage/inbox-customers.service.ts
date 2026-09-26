import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CreateAnonymousCustomerDto, CreateAnonymousCustomerResponse, LinkSessionDto, MergeCustomerDto, MergeResult, RevertMergeResult } from '@chat-bot/shared-types';
import type { SessionUser } from '../../common/auth/session-context';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxStore } from '../core/inbox.store';
import { prepareDisplayName } from '../core/lib/display-name';
import { InboxParticipationCache } from '../core/inbox-participation.cache';
import { SessionRefLookupService } from '../read/session-ref-lookup';
import { decideManualLink, decideUnlink } from '../core/lib/link-rule';
import { assertMergeAllowed } from '../core/lib/merge-rule';

const NOT_FOUND = '요청하신 고객을 찾을 수 없습니다.';

/** [신규 No.42] 새 익명 고객·연결·분리·병합·되돌리기(§7·§14 — 감사 포함). */
@Injectable()
export class InboxCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: InboxStore,
    private readonly participation: InboxParticipationCache,
    private readonly sessionRefLookup: SessionRefLookupService,
    private readonly auditLog: AuditLogService,
    private readonly config: ConfigService,
    private readonly bannedWordFilter: BannedWordFilterService,
  ) {}

  async createAnonymous(dto: CreateAnonymousCustomerDto, actor: SessionUser): Promise<CreateAnonymousCustomerResponse> {
    // [코드리뷰 R1 반영 M-2] sanitizeDisplayName() → 금지어 마스킹 → maskForInbox() — 식별 서비스와 같은 순서.
    const displayName = dto.displayName ? await prepareDisplayName(dto.displayName, this.bannedWordFilter) : undefined;
    const result = await this.store.createAnonymousCustomer({ displayName, createdById: actor.id, createdByName: actor.name, now: new Date(), openReason: 'MANUAL' });
    await this.auditLog.record({ action: 'CREATE', targetType: 'Customer', targetId: result.customerId, summary: `새 익명 고객 생성` });
    return result;
  }

  async link(customerId: string, dto: LinkSessionDto, actor: SessionUser): Promise<void> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.status !== 'ACTIVE' || customer.kind === 'TEST') throw new ApiException('CUSTOMER_LINK_LOCKED', 409, '연결할 수 없는 고객입니다.');
    const participating = await this.participation.isParticipating(dto.chatbotId);
    if (!participating) throw new ApiException('VALIDATION_FAILED', 400, '참여 중인 챗봇이 아닙니다.');
    const sessionId = await this.sessionRefLookup.resolve(dto.chatbotId, dto.sessionRef);
    if (!sessionId) throw new ApiException('NOT_FOUND', 404, '해당 세션을 찾을 수 없습니다.');

    const existing = await this.prisma.customerLink.findUnique({ where: { chatbotId_sessionId: { chatbotId: dto.chatbotId, sessionId } } });
    const decision = decideManualLink(existing ? { customerId: existing.customerId, source: existing.source as never } : null, customerId);
    if (decision.action === 'LOCKED') throw new ApiException('CUSTOMER_LINK_LOCKED', 409, '서명 식별로 연결된 세션은 재지정할 수 없습니다.');
    if (decision.action === 'NOOP') return;

    const now = new Date();
    if (decision.action === 'CREATE') {
      await this.store.manualLinkCreate({ customerId, chatbotId: dto.chatbotId, sessionId, sessionRef: dto.sessionRef, channelType: 'WEB', linkedById: actor.id, linkedByName: actor.name, now });
    } else {
      await this.store.manualLinkReassign(existing!.id, customerId, existing!.customerId, existing!.source as never, { id: actor.id, name: actor.name }, now);
    }
    await this.store.appendSystemEntry((await this.prisma.inboxThread.findUnique({ where: { customerId } }))?.id ?? '', 'LINKED', { chatbotId: dto.chatbotId, sessionRef: dto.sessionRef }, now).catch(() => undefined);
    await this.auditLog.record({ action: 'UPDATE', targetType: 'Customer', targetId: customerId, summary: `대화 연결: 세션 #${dto.sessionRef.slice(0, 6)} → 고객 #${customer.ref.slice(0, 6)}` });
  }

  async unlink(customerId: string, linkId: string, actor: SessionUser): Promise<void> {
    const link = await this.prisma.customerLink.findUnique({ where: { id: linkId } });
    if (!link || link.customerId !== customerId) throw new ApiException('NOT_FOUND', 404, '요청하신 연결을 찾을 수 없습니다.');
    const decision = decideUnlink({ customerId: link.customerId, source: link.source as never });
    if (decision.action === 'ADMIN_ONLY' && actor.role !== 'ADMIN') throw new ApiException('CUSTOMER_LINK_LOCKED', 409, '서명 식별 연결 분리는 관리자만 할 수 있습니다.');

    if (decision.action === 'ADMIN_ONLY') {
      await this.store.unlinkIdentityToNewAnonymous(linkId, new Date());
      await this.store.appendSystemEntry((await this.prisma.inboxThread.findUnique({ where: { customerId } }))?.id ?? '', 'IDENTITY_BLOCKED', {}, new Date()).catch(() => undefined);
    } else if (decision.action === 'REVERT') {
      // 이전 연결이 없는 최초 MANUAL 연결(재지정 이력 0)이거나, 이전 고객이 더는 ACTIVE가 아니면
      // (그사이 병합됨 등) 되돌릴 대상이 없다 — 행 삭제(§7.2).
      const previousCustomer = link.previousCustomerId ? await this.prisma.customer.findUnique({ where: { id: link.previousCustomerId } }) : null;
      if (previousCustomer && previousCustomer.status === 'ACTIVE') {
        await this.store.unlinkRevert(linkId, link.previousCustomerId as string, link.previousSource ?? 'SYSTEM');
      } else {
        await this.store.unlinkDelete(linkId);
      }
    } else {
      await this.store.unlinkDelete(linkId);
    }
    await this.auditLog.record({ action: 'UPDATE', targetType: 'Customer', targetId: customerId, summary: `연결 분리` });
  }

  async merge(customerId: string, dto: MergeCustomerDto, actor: SessionUser): Promise<MergeResult> {
    const source = await this.prisma.customer.findUnique({ where: { id: customerId } });
    const target = await this.prisma.customer.findUnique({ where: { id: dto.targetCustomerId } });
    if (!source || !target) throw new ApiException('NOT_FOUND', 404, NOT_FOUND);
    const allowed = assertMergeAllowed(source.id, { kind: source.kind as never, status: source.status as never, identityPurgedAt: source.identityPurgedAt }, target.id, {
      kind: target.kind as never,
      status: target.status as never,
      identityPurgedAt: target.identityPurgedAt,
    });
    if (!allowed.ok) throw new ApiException('CUSTOMER_MERGE_FORBIDDEN', 409, allowed.message);
    try {
      const result = await this.store.mergeCustomers({ sourceCustomerId: source.id, targetCustomerId: target.id, kind: 'MANUAL', mergedById: actor.id, mergedByName: actor.name, now: new Date() });
      await this.auditLog.record({ action: 'STATUS_CHANGE', targetType: 'Customer', targetId: source.id, summary: `병합: #${source.ref.slice(0, 6)} → #${target.ref.slice(0, 6)}` });
      return result;
    } catch (e) {
      if (e instanceof Error && e.message === 'CUSTOMER_MERGE_FORBIDDEN') throw new ApiException('CUSTOMER_MERGE_FORBIDDEN', 409, '병합할 수 없습니다(경합 또는 상태 변경).');
      throw e;
    }
  }

  async revertMerge(mergeId: string, actor: SessionUser): Promise<RevertMergeResult> {
    const merge = await this.prisma.customerMerge.findUnique({ where: { id: mergeId } });
    if (!merge) throw new ApiException('NOT_FOUND', 404, '요청하신 병합 기록을 찾을 수 없습니다.');
    if (merge.kind === 'IDENTITY_PROMOTION' && actor.role !== 'ADMIN') throw new ApiException('FORBIDDEN', 403, '승격 병합의 되돌리기는 관리자만 할 수 있습니다.');
    if (merge.kind === 'MANUAL' && actor.role !== 'ADMIN') {
      const revertHours = this.config.get<number>('OMNI_MERGE_REVERT_HOURS') ?? 24;
      const isActor = merge.mergedById === actor.id;
      const withinWindow = Date.now() - merge.mergedAt.getTime() <= revertHours * 3600_000;
      if (!isActor || !withinWindow) throw new ApiException('CUSTOMER_MERGE_NOT_REVERTIBLE', 409, '되돌리기 권한 또는 기한이 지났습니다.');
    }
    try {
      const result = await this.store.revertMerge(mergeId, actor.id, actor.name, new Date());
      await this.auditLog.record({ action: 'STATUS_CHANGE', targetType: 'Customer', targetId: merge.sourceCustomerId, summary: '병합 되돌리기' });
      return result;
    } catch (e) {
      if (e instanceof Error && e.message === 'CUSTOMER_MERGE_NOT_REVERTIBLE') throw new ApiException('CUSTOMER_MERGE_NOT_REVERTIBLE', 409, '이미 되돌렸거나 대상이 그 뒤 다시 병합되었습니다.');
      throw e;
    }
  }
}
