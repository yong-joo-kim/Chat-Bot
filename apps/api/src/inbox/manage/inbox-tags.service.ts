import { Injectable } from '@nestjs/common';
import { normalizeText } from '@chat-bot/shared-types';
import type { InboxTagCreateDto, InboxTagItem, InboxTagListResponse, InboxTagUpdateDto } from '@chat-bot/shared-types';
import { INBOX_LIMITS } from '@chat-bot/shared-types';
import type { SessionUser } from '../../common/auth/session-context';
import { ApiException } from '../../common/api.exception';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InboxStore } from '../core/inbox.store';

const NOT_FOUND = '요청하신 태그를 찾을 수 없습니다.';

/** [신규 No.42] 전역 태그 목록(ADMIN 서비스 재검증 · §8.3 · §14 — 감사 포함). 쓰기는 `InboxStore` 1곳(O-2). */
@Injectable()
export class InboxTagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: InboxStore,
    private readonly auditLog: AuditLogService,
  ) {}

  private assertAdmin(actor: SessionUser): void {
    if (actor.role !== 'ADMIN') throw new ApiException('FORBIDDEN', 403, '태그 관리는 관리자만 할 수 있습니다.');
  }

  async list(): Promise<InboxTagListResponse> {
    const tags = await this.prisma.inboxTag.findMany({ orderBy: { name: 'asc' } });
    const usage = await this.prisma.inboxThreadTag.groupBy({ by: ['tagId'], _count: { _all: true } });
    const usageByTag = new Map(usage.map((u) => [u.tagId, u._count._all]));
    const items: InboxTagItem[] = tags.map((t) => ({ id: t.id, name: t.name, color: t.color as never, usageCount: usageByTag.get(t.id) ?? 0 }));
    return items;
  }

  async create(dto: InboxTagCreateDto, actor: SessionUser): Promise<InboxTagItem> {
    this.assertAdmin(actor);
    const total = await this.prisma.inboxTag.count();
    if (total >= INBOX_LIMITS.tagsGlobalMax) throw new ApiException('LIMIT_EXCEEDED', 400, `태그는 최대 ${INBOX_LIMITS.tagsGlobalMax}개까지 만들 수 있습니다.`);
    const nameNormalized = normalizeText(dto.name);
    const dup = await this.prisma.inboxTag.findUnique({ where: { nameNormalized } });
    if (dup) throw new ApiException('DUPLICATE_NAME', 400, '이미 사용 중인 태그 이름입니다.');
    const tag = await this.store.createTag(dto.name, nameNormalized, dto.color);
    await this.auditLog.record({ action: 'CREATE', targetType: 'InboxTag', targetId: tag.id, summary: `태그 생성: ${dto.name}` });
    return { id: tag.id, name: tag.name, color: tag.color as never, usageCount: 0 };
  }

  async update(tagId: string, dto: InboxTagUpdateDto, actor: SessionUser): Promise<InboxTagItem> {
    this.assertAdmin(actor);
    const tag = await this.prisma.inboxTag.findUnique({ where: { id: tagId } });
    if (!tag) throw new ApiException('NOT_FOUND', 404, NOT_FOUND);
    const nameNormalized = normalizeText(dto.name);
    if (nameNormalized !== tag.nameNormalized) {
      const dup = await this.prisma.inboxTag.findUnique({ where: { nameNormalized } });
      if (dup) throw new ApiException('DUPLICATE_NAME', 400, '이미 사용 중인 태그 이름입니다.');
    }
    const updated = await this.store.updateTag(tagId, dto.name, nameNormalized, dto.color);
    await this.auditLog.record({ action: 'UPDATE', targetType: 'InboxTag', targetId: tagId, summary: `태그 수정: ${dto.name}` });
    const usage = await this.prisma.inboxThreadTag.count({ where: { tagId } });
    return { id: updated.id, name: updated.name, color: updated.color as never, usageCount: usage };
  }

  async remove(tagId: string, force: boolean, actor: SessionUser): Promise<void> {
    this.assertAdmin(actor);
    const tag = await this.prisma.inboxTag.findUnique({ where: { id: tagId } });
    if (!tag) throw new ApiException('NOT_FOUND', 404, NOT_FOUND);
    const inUseCount = await this.prisma.inboxThreadTag.count({ where: { tagId } });
    if (inUseCount > 0 && !force) {
      throw new ApiException('VALIDATION_FAILED', 400, `이 태그를 사용 중인 스레드가 ${inUseCount}건 있습니다. 강제 삭제가 필요합니다.`, [{ field: 'force', message: `inUseCount:${inUseCount}` }]);
    }
    await this.store.deleteTag(tagId);
    await this.auditLog.record({ action: 'DELETE', targetType: 'InboxTag', targetId: tagId, summary: `태그 삭제: ${tag.name}(제거 스레드 ${inUseCount}건)` });
  }
}
