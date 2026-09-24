import { Injectable } from '@nestjs/common';
import { HANDOFF_LIMITS, normalizeText } from '@chat-bot/shared-types';
import type { CannedResponse, CannedResponseListQuery, CreateCannedResponseDto, MoveCannedResponseDto, UpdateCannedResponseDto } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { toCannedResponseDto } from './canned-responses.mapper';

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * `CannedResponse` 쓰기 유일 파일(P-11, §12.3) — 200개 상한·정규화 유일·위/아래 이동·감사.
 * 대화 번들·스냅샷·엔진 밖.
 */
@Injectable()
export class CannedResponsesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** 관리 목록(`dialogue:read`) — 전체(비활성 포함), 페이지네이션 없음(≤200). */
  async list(chatbotId: string): Promise<CannedResponse[]> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.cannedResponse.findMany({ where: { chatbotId }, orderBy: { sortOrder: 'asc' } });
    return rows.map(toCannedResponseDto);
  }

  /** 콘솔 검색(`cs:read`) — enabled만. */
  async search(chatbotId: string, query: CannedResponseListQuery): Promise<CannedResponse[]> {
    await this.scope.assertReadable(chatbotId);
    const rows = await this.prisma.cannedResponse.findMany({
      where: {
        chatbotId,
        enabled: true,
        ...(query.category ? { category: query.category } : {}),
        ...(query.q
          ? {
              OR: [{ title: { contains: query.q } }, { body: { contains: query.q } }, { shortcut: { contains: query.q } }],
            }
          : {}),
      },
      orderBy: { sortOrder: 'asc' },
      take: HANDOFF_LIMITS.cannedPerChatbot,
    });
    return rows.map(toCannedResponseDto);
  }

  async create(chatbotId: string, dto: CreateCannedResponseDto): Promise<CannedResponse> {
    await this.scope.assertWritable(chatbotId);
    const count = await this.prisma.cannedResponse.count({ where: { chatbotId } });
    if (count >= HANDOFF_LIMITS.cannedPerChatbot) {
      throw new ApiException('LIMIT_EXCEEDED', 409, `자주 쓰는 문장은 챗봇당 최대 ${HANDOFF_LIMITS.cannedPerChatbot}개까지 등록할 수 있습니다.`);
    }
    const maxSortOrder = await this.prisma.cannedResponse.aggregate({ where: { chatbotId }, _max: { sortOrder: true } });

    try {
      const row = await this.prisma.cannedResponse.create({
        data: {
          chatbotId,
          title: dto.title,
          titleNormalized: normalizeText(dto.title),
          body: dto.body,
          category: dto.category ?? null,
          shortcut: dto.shortcut ?? null,
          sortOrder: (maxSortOrder._max.sortOrder ?? 0) + 1,
          enabled: dto.enabled,
        },
      });
      await this.auditLog.record({
        action: 'CREATE',
        targetType: 'CannedResponse',
        targetId: row.id,
        chatbotId,
        after: { title: row.title, category: row.category, shortcut: row.shortcut, enabled: row.enabled, sortOrder: row.sortOrder, bodyLength: row.body.length },
        summary: `자주 쓰는 문장 등록: ${row.title}`,
      });
      return toCannedResponseDto(row);
    } catch (e) {
      if (isUniqueConstraintViolation(e)) {
        throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 제목 또는 단축어가 있습니다.', [{ field: 'title', message: '중복된 이름입니다.' }]);
      }
      throw e;
    }
  }

  async update(chatbotId: string, id: string, dto: UpdateCannedResponseDto): Promise<CannedResponse> {
    await this.scope.assertWritable(chatbotId);
    const before = await this.findOrThrow(chatbotId, id);

    try {
      const row = await this.prisma.cannedResponse.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title, titleNormalized: normalizeText(dto.title) } : {}),
          ...(dto.body !== undefined ? { body: dto.body } : {}),
          ...(dto.category !== undefined ? { category: dto.category } : {}),
          ...(dto.shortcut !== undefined ? { shortcut: dto.shortcut } : {}),
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        },
      });
      await this.auditLog.record({
        action: 'UPDATE',
        targetType: 'CannedResponse',
        targetId: row.id,
        chatbotId,
        before: { title: before.title, category: before.category, shortcut: before.shortcut, enabled: before.enabled, sortOrder: before.sortOrder, bodyLength: before.body.length },
        after: { title: row.title, category: row.category, shortcut: row.shortcut, enabled: row.enabled, sortOrder: row.sortOrder, bodyLength: row.body.length },
        summary: `자주 쓰는 문장 수정: ${row.title}`,
      });
      return toCannedResponseDto(row);
    } catch (e) {
      if (isUniqueConstraintViolation(e)) {
        throw new ApiException('DUPLICATE_NAME', 409, '이미 같은 제목 또는 단축어가 있습니다.', [{ field: 'title', message: '중복된 이름입니다.' }]);
      }
      throw e;
    }
  }

  async remove(chatbotId: string, id: string): Promise<void> {
    await this.scope.assertWritable(chatbotId);
    const before = await this.findOrThrow(chatbotId, id);
    await this.prisma.cannedResponse.delete({ where: { id } });
    await this.auditLog.record({
      action: 'DELETE',
      targetType: 'CannedResponse',
      targetId: id,
      chatbotId,
      before: { title: before.title, category: before.category, shortcut: before.shortcut, enabled: before.enabled, sortOrder: before.sortOrder, bodyLength: before.body.length },
      summary: `자주 쓰는 문장 삭제: ${before.title}`,
    });
  }

  async move(chatbotId: string, id: string, dto: MoveCannedResponseDto): Promise<CannedResponse[]> {
    await this.scope.assertWritable(chatbotId);
    const current = await this.findOrThrow(chatbotId, id);
    const all = await this.prisma.cannedResponse.findMany({ where: { chatbotId }, orderBy: { sortOrder: 'asc' } });
    const index = all.findIndex((r) => r.id === id);
    const targetIndex = dto.direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= all.length) return all.map(toCannedResponseDto);

    const target = all[targetIndex];
    await this.prisma.$transaction([
      this.prisma.cannedResponse.update({ where: { id: current.id }, data: { sortOrder: target.sortOrder } }),
      this.prisma.cannedResponse.update({ where: { id: target.id }, data: { sortOrder: current.sortOrder } }),
    ]);

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'CannedResponse',
      targetId: id,
      chatbotId,
      summary: `순서 변경: ${current.title}`,
    });

    const rows = await this.prisma.cannedResponse.findMany({ where: { chatbotId }, orderBy: { sortOrder: 'asc' } });
    return rows.map(toCannedResponseDto);
  }

  private async findOrThrow(chatbotId: string, id: string) {
    const row = await this.prisma.cannedResponse.findUnique({ where: { id } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 문장을 찾을 수 없습니다.');
    return row;
  }
}
