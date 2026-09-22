import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BannedWord,
  BannedWordListQuery,
  BannedWordTestResponse,
  CreateBannedWordDto,
  Paginated,
  UpdateBannedWordDto,
  normalizeText,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { toBannedWordDto } from './banned-word.mapper';
import { BannedWordFilterService } from './banned-word-filter.service';

const NOT_FOUND_MESSAGE = '요청하신 금지어를 찾을 수 없습니다.';

/**
 * 금지어 사전 관리(No.12-d, J-3). 전역 1벌이며 정규식은 받지 않는다(NFR-S12).
 * 쓰기 성공 직후 캐시를 즉시 무효화한다(AC-12D-8).
 */
@Injectable()
export class BannedWordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly filterService: BannedWordFilterService,
  ) {}

  async list(query: BannedWordListQuery): Promise<Paginated<BannedWord>> {
    const where: Prisma.BannedWordWhereInput = {};
    if (query.q) where.OR = [{ word: { contains: query.q } }, { description: { contains: query.q } }];
    if (query.policy && query.policy.length > 0) where.policy = { in: query.policy };
    if (query.enabled !== undefined) where.enabled = query.enabled;
    const orderBy = { [query.sort]: query.order } as Prisma.BannedWordOrderByWithRelationInput;

    const [rows, total] = await Promise.all([
      this.prisma.bannedWord.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.bannedWord.count({ where }),
    ]);
    return toPaginated(rows.map(toBannedWordDto), total, query.page, query.pageSize);
  }

  private async findRowOrThrow(id: string) {
    const row = await this.prisma.bannedWord.findUnique({ where: { id } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async create(dto: CreateBannedWordDto): Promise<BannedWord> {
    const word = dto.word.trim();
    const wordNormalized = normalizeText(word);

    const row = await this.prisma.bannedWord.create({
      data: {
        word,
        wordNormalized,
        matchType: dto.matchType,
        policy: dto.policy,
        enabled: dto.enabled,
        description: dto.description,
      },
    });
    this.filterService.invalidate();

    await this.auditLogService.record({ action: 'CREATE', targetType: 'BannedWord', targetId: row.id, targetName: row.word, after: row });

    return toBannedWordDto(row);
  }

  async update(id: string, dto: UpdateBannedWordDto): Promise<BannedWord> {
    const current = await this.findRowOrThrow(id);

    const word = dto.word !== undefined ? dto.word.trim() : current.word;
    const wordNormalized = dto.word !== undefined ? normalizeText(word) : current.wordNormalized;

    const row = await this.prisma.bannedWord.update({
      where: { id },
      data: {
        word,
        wordNormalized,
        ...(dto.matchType !== undefined ? { matchType: dto.matchType } : {}),
        ...(dto.policy !== undefined ? { policy: dto.policy } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
    });
    this.filterService.invalidate();

    await this.auditLogService.record({ action: 'UPDATE', targetType: 'BannedWord', targetId: row.id, targetName: row.word, before: current, after: row });

    return toBannedWordDto(row);
  }

  async remove(id: string): Promise<void> {
    const current = await this.findRowOrThrow(id);
    await this.prisma.bannedWord.delete({ where: { id } });
    this.filterService.invalidate();

    await this.auditLogService.record({ action: 'DELETE', targetType: 'BannedWord', targetId: current.id, targetName: current.word, before: current });
  }

  test(text: string): Promise<BannedWordTestResponse> {
    return this.filterService.test(text);
  }
}
