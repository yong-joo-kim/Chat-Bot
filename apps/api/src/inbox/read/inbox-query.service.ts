import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CHANNEL_TYPE_LABELS,
  RECORD_CHANNEL_LABELS,
  hasPermission,
  type CustomerSearchDto,
  type CustomerSearchResponse,
  type IdentitySpaceListResponse,
  type InboxAssigneeListResponse,
  type InboxSourceFamily,
  type InboxSummaryResponse,
  type InboxThreadListItem,
  type InboxThreadListQuery,
  type InboxThreadListResponse,
  type SessionLinkLookupResponse,
} from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { assignAliases } from '../../handoff/lib/session-ref';
import { InboxParticipationCache } from '../core/inbox-participation.cache';
import { InboxTextReader } from './inbox-text.reader';
import { effectiveStatus } from './lib/effective-status';
import { buildThreadListWhere } from './lib/list-where';
import { computeCustomerKeyHash } from '../identity/lib/customer-key';
import { InboxIdentitySecretResolver } from '../identity/inbox-identity-secret.resolver';

/** [신규 No.42] 목록·요약·고객 검색·세션 연결 조회·담당 후보·식별 공간(§9). */
@Injectable()
export class InboxQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly participation: InboxParticipationCache,
    private readonly textReader: InboxTextReader,
    private readonly secretResolver: InboxIdentitySecretResolver,
  ) {}

  private pollAfterMs(): number {
    return this.config.get<number>('OMNI_INBOX_POLL_MS') ?? 10000;
  }

  /**
   * [신규 §9.1] 목록 — 정확히 쿼리 ≤7(NFR-OCP1). 챗봇 이름·참여 목록은 참여 캐시에서(쿼리 0).
   * 순서: (4) 전역 활성 상담 → (activeHandoff 필터면 이 결과로 고객 id 집합을 먼저 만들어 (1)의
   * `customerId in`에 넣는다) → (1)+(2) 목록/count → (3) 연결 대화 수 groupBy → (5) 페이지 고객의
   * 연결 교차(활성 상담 배지) → (6) 마지막 항목 미리보기 → (7) 담당자 활성 여부.
   */
  async list(query: InboxThreadListQuery, actorId: string): Promise<InboxThreadListResponse> {
    const now = new Date();
    const participatingIds = await this.participation.participatingChatbotIds(); // 캐시 — 쿼리 0

    // (4) 전역 활성 상담(참여 챗봇만) — 목록 전체에서 1회.
    const activeSessions =
      participatingIds.length > 0
        ? await this.prisma.handoffSession.findMany({
            where: { status: { in: ['CONNECTING', 'CONNECTED'] }, chatbotId: { in: participatingIds } },
            select: { chatbotId: true, sessionId: true },
          })
        : [];
    const activeSessionKeySet = new Set(activeSessions.map((s) => `${s.chatbotId}:${s.sessionId}`));

    // activeHandoff=true 필터 — (4)의 세션을 (5)와 같은 모양의 조회로 고객 id 집합화해 (1)의 where에 넣는다.
    let preFilterLinks: Array<{ customerId: string; chatbotId: string; sessionId: string }> = [];
    let activeHandoffCustomerIds: string[] | undefined;
    if (query.activeHandoff) {
      preFilterLinks =
        activeSessions.length > 0
          ? await this.prisma.customerLink.findMany({ where: { OR: activeSessions.map((s) => ({ chatbotId: s.chatbotId, sessionId: s.sessionId })) }, select: { customerId: true, chatbotId: true, sessionId: true } })
          : [];
      activeHandoffCustomerIds = [...new Set(preFilterLinks.map((l) => l.customerId))];
    }

    const where = buildThreadListWhere(query, now, { activeHandoffCustomerIds, chatbotIds: query.chatbotIds });
    if ((where as { assigneeUserId?: string }).assigneeUserId === '__ME__') (where as { assigneeUserId?: string }).assigneeUserId = actorId;

    // (1)+(2) 목록 · count.
    const [rows, total] = await Promise.all([
      this.prisma.inboxThread.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { customer: true, tags: { include: { tag: true } } },
      }),
      this.prisma.inboxThread.count({ where }),
    ]);

    const customerIds = rows.map((r) => r.customerId);

    // (3) 연결 대화 수(참여 챗봇만) — groupBy.
    const linkCounts =
      customerIds.length > 0 && participatingIds.length > 0
        ? await this.prisma.customerLink.groupBy({ by: ['customerId'], where: { customerId: { in: customerIds }, chatbotId: { in: participatingIds } }, _count: { _all: true } })
        : [];
    const linkCountByCustomer = new Map(linkCounts.map((g) => [g.customerId, g._count._all]));

    // (5) 페이지 고객의 연결(참여 챗봇만) — activeHandoff 필터일 때는 (4)에서 이미 구한 (5)와 같은
    // 모양의 결과(preFilterLinks)를 페이지 고객으로 좁혀 재사용한다(쿼리 추가 0).
    const pageLinks =
      customerIds.length === 0 || activeSessions.length === 0
        ? []
        : query.activeHandoff
          ? preFilterLinks.filter((l) => customerIds.includes(l.customerId))
          : await this.prisma.customerLink.findMany({ where: { customerId: { in: customerIds }, chatbotId: { in: participatingIds } }, select: { customerId: true, chatbotId: true, sessionId: true } });
    const activeHandoffCountByCustomer = new Map<string, number>();
    for (const l of pageLinks) {
      if (activeSessionKeySet.has(`${l.chatbotId}:${l.sessionId}`)) activeHandoffCountByCustomer.set(l.customerId, (activeHandoffCountByCustomer.get(l.customerId) ?? 0) + 1);
    }

    // (7) 담당자 활성 여부.
    const assigneeIds = [...new Set(rows.map((r) => r.assigneeUserId).filter((x): x is string => !!x))];
    const assigneeUsers = assigneeIds.length > 0 ? await this.prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, status: true } }) : [];
    const assigneeActive = new Map(assigneeUsers.map((u) => [u.id, u.status === 'ACTIVE']));

    // (6) 마지막 항목 미리보기.
    const lastEntryIds = rows.map((r) => r.lastEntryId).filter((x): x is string => !!x);
    const lastEntries = lastEntryIds.length > 0 ? await this.prisma.inboxEntry.findMany({ where: { id: { in: lastEntryIds } }, select: { id: true, text: true, textPurgedAt: true } }) : [];
    const lastEntryById = new Map(lastEntries.map((e) => [e.id, e]));

    const refs = rows.map((r) => r.customer.ref);
    const aliasOf = assignAliases(refs);

    const items: InboxThreadListItem[] = rows.map((row) => {
      const eff = effectiveStatus({ status: row.status as InboxThreadListItem['status'], snoozeUntil: row.snoozeUntil }, now);
      const lastEntry = row.lastEntryId ? lastEntryById.get(row.lastEntryId) : undefined;
      const identityPurged = !!row.customer.identityPurgedAt;
      // [신규] noParticipatingChatbot — 이 고객이 참여 챗봇에 걸린 연결이 하나도 없다(목록 필터·caching
      // 만으로 판정 — 추가 쿼리 0, linkCountByCustomer는 이미 참여 챗봇으로만 집계했다).
      const noParticipating = participatingIds.length === 0 || (linkCountByCustomer.get(row.customerId) ?? 0) === 0;
      return {
        threadId: row.id,
        version: row.version,
        customer: {
          id: row.customer.id,
          alias: aliasOf.get(row.customer.ref) ?? row.customer.ref.slice(0, 6),
          displayName: row.customer.displayName ? (this.textReader.openDisplayName(row.customer.id, row.customer.displayName) ?? undefined) : undefined,
          kind: row.customer.kind as InboxThreadListItem['customer']['kind'],
          ...(identityPurged ? { identityPurged: true as const } : {}),
        },
        status: eff.status,
        ...(row.snoozeUntil ? { snoozeUntil: row.snoozeUntil } : {}),
        ...(eff.snoozeExpired ? { snoozeExpired: true as const } : {}),
        ...(row.assigneeUserId ? { assignee: { id: row.assigneeUserId, name: row.assigneeUserName ?? '', active: assigneeActive.get(row.assigneeUserId) ?? false } } : {}),
        tags: row.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
        ...(row.lastChannelType
          ? {
              lastChannel: {
                family: (row.lastChannelFamily as InboxSourceFamily | null) ?? 'DEPLOY',
                type: row.lastChannelType,
                label:
                  RECORD_CHANNEL_LABELS[row.lastChannelType as keyof typeof RECORD_CHANNEL_LABELS] ??
                  CHANNEL_TYPE_LABELS[row.lastChannelType as keyof typeof CHANNEL_TYPE_LABELS] ??
                  row.lastChannelType,
              },
            }
          : {}),
        ...(row.lastChatbotId ? { lastChatbot: { id: row.lastChatbotId, name: '' } } : {}),
        linkedConversationCount: linkCountByCustomer.get(row.customerId) ?? 0,
        activeHandoffCount: activeHandoffCountByCustomer.get(row.customerId) ?? 0,
        lastActivityAt: row.lastActivityAt,
        lastActivityKind: row.lastActivityKind,
        ...(lastEntry
          ? lastEntry.textPurgedAt
            ? { lastEntryPurged: true as const }
            : { lastEntryPreview: this.textReader.openEntryText(lastEntry.id, lastEntry.text).slice(0, 60) }
          : {}),
        ...(noParticipating ? { noParticipatingChatbot: true as const } : {}),
      };
    });

    // lastChatbot 이름은 참여 캐시에서 채운다(쿼리 0) — 위에서는 자리표시자만 넣어 뒀다.
    for (const item of items) {
      if (item.lastChatbot) {
        const cachedName = await this.participation.chatbotName(item.lastChatbot.id);
        item.lastChatbot.name = cachedName ?? '(참여하지 않는 챗봇)';
      }
    }

    const participatingChatbots = await this.participation.participatingChatbots(); // 캐시 — 쿼리 0

    return { items, total, page: query.page, pageSize: query.pageSize, pollAfterMs: this.pollAfterMs(), generatedAt: now, participatingChatbots };
  }

  async summary(actorId: string): Promise<InboxSummaryResponse> {
    const now = new Date();
    const baseWhere = { hiddenByMergeId: null } as const;
    const [open, pending, mine, unassigned] = await Promise.all([
      this.prisma.inboxThread.count({ where: { ...baseWhere, OR: [{ status: 'OPEN' }, { status: 'PENDING', snoozeUntil: { lte: now } }] } }),
      this.prisma.inboxThread.count({ where: { ...baseWhere, status: 'PENDING', OR: [{ snoozeUntil: null }, { snoozeUntil: { gt: now } }] } }),
      this.prisma.inboxThread.count({ where: { ...baseWhere, assigneeUserId: actorId, status: { not: 'CLOSED' } } }),
      this.prisma.inboxThread.count({ where: { ...baseWhere, assigneeUserId: null, status: { not: 'CLOSED' } } }),
    ]);
    const participatingIds = await this.participation.participatingChatbotIds();
    const activeSessions = participatingIds.length > 0 ? await this.prisma.handoffSession.count({ where: { status: { in: ['CONNECTING', 'CONNECTED'] }, chatbotId: { in: participatingIds } } }) : 0;
    return { open, pending, mine, unassigned, activeHandoff: activeSessions, generatedAt: now };
  }

  async assignees(): Promise<InboxAssigneeListResponse> {
    const users = await this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, role: true } });
    return users.filter((u) => hasPermission(u.role as never, 'cs:write')).map((u) => ({ id: u.id, name: u.name }));
  }

  /**
   * [코드리뷰 R1 반영 B-5] 참조(REF)별로 그 공간을 쓰는 참여 챗봇 목록을 함께 반환한다(콘솔의
   * "누가 이 공간을 쓰는지" 표시 요구 — 문자열 배열로는 담을 수 없어 형태를 바꿨다, §27 기록).
   */
  async identitySpaces(): Promise<IdentitySpaceListResponse> {
    const rows = await this.prisma.chatbotInboxSetting.findMany({
      where: { enabled: true, identitySecretRef: { not: null } },
      select: { identitySecretRef: true, chatbotId: true },
    });
    const chatbotIds = [...new Set(rows.map((r) => r.chatbotId))];
    const chatbots = chatbotIds.length > 0 ? await this.prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true } }) : [];
    const nameById = new Map(chatbots.map((c) => [c.id, c.name]));

    const grouped = new Map<string, { id: string; name: string }[]>();
    for (const row of rows) {
      const ref = row.identitySecretRef as string;
      const list = grouped.get(ref) ?? [];
      list.push({ id: row.chatbotId, name: nameById.get(row.chatbotId) ?? '(삭제됨)' });
      grouped.set(ref, list);
    }
    return [...grouped.entries()].map(([ref, chatbots]) => ({ ref, chatbots }));
  }

  async sessionLink(chatbotId: string, sessionRef: string): Promise<SessionLinkLookupResponse> {
    const participating = await this.participation.isParticipating(chatbotId);
    if (!participating) return { participating: false };
    const link = await this.prisma.customerLink.findFirst({ where: { chatbotId, sessionRef } });
    if (!link) return { participating: true, customer: null };
    const customer = await this.prisma.customer.findUnique({ where: { id: link.customerId } });
    if (!customer) return { participating: true, customer: null };
    const thread = await this.prisma.inboxThread.findUnique({ where: { customerId: customer.id } });
    const aliasOf = assignAliases([customer.ref]);
    const linkedCount = await this.prisma.customerLink.count({ where: { customerId: customer.id } });
    return {
      participating: true,
      customer: {
        id: customer.id,
        alias: aliasOf.get(customer.ref) ?? customer.ref.slice(0, 6),
        displayName: customer.displayName ? (this.textReader.openDisplayName(customer.id, customer.displayName) ?? undefined) : undefined,
        kind: customer.kind as never,
      },
      ...(thread ? { threadId: thread.id, threadStatus: effectiveStatus({ status: thread.status as never, snoozeUntil: thread.snoozeUntil }, new Date()).status } : {}),
      cardBrief: { conversationCount: linkedCount, handoffCount: 0 },
    };
  }

  async searchCustomers(dto: CustomerSearchDto): Promise<CustomerSearchResponse> {
    if (dto.memberId && dto.identitySpaceRef) {
      const secret = this.secretResolver.getCustomerKeySecret();
      if (!secret) throw new ApiException('VALIDATION_FAILED', 400, '서버에 고객 키 비밀이 설정되지 않았습니다.');
      const hash = computeCustomerKeyHash(secret, dto.identitySpaceRef, dto.memberId);
      const customer = await this.prisma.customer.findUnique({ where: { customerKeyHash: hash } });
      if (!customer) return { items: [] };
      return { items: [await this.toSearchItem(customer)] };
    }

    const scanLimit = this.config.get<number>('OMNI_NAME_SEARCH_SCAN_LIMIT') ?? 2000;
    const kinds = dto.kinds ?? (dto.includeTest ? undefined : (['IDENTIFIED', 'ANONYMOUS'] as const));
    const activeSince = dto.activeWithinDays ? new Date(Date.now() - dto.activeWithinDays * 86_400_000) : undefined;

    if (dto.q && /^[0-9a-f]{4,16}$/.test(dto.q)) {
      const candidates = await this.prisma.customer.findMany({
        where: { ref: { startsWith: dto.q }, ...(kinds ? { kind: { in: [...kinds] } } : {}), ...(activeSince ? { lastActivityAt: { gte: activeSince } } : {}) },
        orderBy: { lastActivityAt: 'desc' },
        take: dto.limit ?? 50,
      });
      return { items: await Promise.all(candidates.map((c) => this.toSearchItem(c))) };
    }

    const recent = await this.prisma.customer.findMany({
      where: { ...(kinds ? { kind: { in: [...kinds] } } : {}) },
      orderBy: { lastActivityAt: 'desc' },
      take: scanLimit,
    });
    const truncatedScan = recent.length >= scanLimit;
    const q = dto.q?.toLowerCase();
    const matched = recent.filter((c) => {
      if (activeSince && c.lastActivityAt < activeSince) return false;
      if (!q) return true;
      const name = c.displayName ? (this.textReader.openDisplayName(c.id, c.displayName) ?? '') : '';
      return name.toLowerCase().includes(q);
    });
    const limited = matched.slice(0, dto.limit ?? 50);
    return { items: await Promise.all(limited.map((c) => this.toSearchItem(c))), ...(truncatedScan ? { truncatedScan: true as const } : {}) };
  }

  private async toSearchItem(customer: { id: string; ref: string; kind: string; displayName: string | null; identityPurgedAt: Date | null; lastActivityAt: Date }) {
    const aliasOf = assignAliases([customer.ref]);
    const thread = await this.prisma.inboxThread.findUnique({ where: { customerId: customer.id } });
    const linkedCount = await this.prisma.customerLink.count({ where: { customerId: customer.id } });
    return {
      customerId: customer.id,
      alias: aliasOf.get(customer.ref) ?? customer.ref.slice(0, 6),
      displayName: customer.displayName ? (this.textReader.openDisplayName(customer.id, customer.displayName) ?? undefined) : undefined,
      kind: customer.kind as never,
      identified: customer.kind === 'IDENTIFIED',
      ...(customer.identityPurgedAt ? { identityPurged: true as const } : {}),
      lastActivityAt: customer.lastActivityAt,
      ...(thread ? { threadId: thread.id, threadStatus: thread.status as never } : {}),
      linkedConversationCount: linkedCount,
    };
  }
}
