import { Injectable } from '@nestjs/common';
import {
  ChatbotGroupWithCount,
  CopyChatbotGroupDto,
  CreateChatbotGroupDto,
  Paginated,
  UpdateChatbotGroupDto,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { toPaginated } from '../common/pagination';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { deriveCopyName } from '../chatbots/lib/copy-name.util';
import { deriveCopySlug, SlugDerivationExhaustedError } from '../chatbots/lib/slug.util';
import { toChatbotGroupWithCountDto } from './chatbot-groups.mapper';

const NOT_FOUND_MESSAGE = '요청하신 대상을 찾을 수 없습니다.';
const GROUP_WITH_COUNT_INCLUDE = { _count: { select: { chatbots: true } } } as const;

@Injectable()
export class ChatbotGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(dto: CreateChatbotGroupDto): Promise<ChatbotGroupWithCount> {
    const row = await this.prisma.chatbotGroup.create({
      data: { name: dto.name, description: dto.description },
      include: GROUP_WITH_COUNT_INCLUDE,
    });
    await this.auditLogService.record({ action: 'CREATE', targetType: 'ChatbotGroup', targetId: row.id, targetName: row.name, after: row });
    return toChatbotGroupWithCountDto(row);
  }

  async list(page: number, pageSize: number): Promise<Paginated<ChatbotGroupWithCount>> {
    const [rows, total] = await Promise.all([
      this.prisma.chatbotGroup.findMany({
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: GROUP_WITH_COUNT_INCLUDE,
      }),
      this.prisma.chatbotGroup.count(),
    ]);
    return toPaginated(rows.map(toChatbotGroupWithCountDto), total, page, pageSize);
  }

  async findOne(id: string): Promise<ChatbotGroupWithCount> {
    return toChatbotGroupWithCountDto(await this.findRowOrThrow(id));
  }

  async update(id: string, dto: UpdateChatbotGroupDto): Promise<ChatbotGroupWithCount> {
    const before = await this.findRowOrThrow(id);
    const row = await this.prisma.chatbotGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
      },
      include: GROUP_WITH_COUNT_INCLUDE,
    });
    await this.auditLogService.record({ action: 'UPDATE', targetType: 'ChatbotGroup', targetId: row.id, targetName: row.name, before, after: row });
    return toChatbotGroupWithCountDto(row);
  }

  /** 소속 챗봇이 1건 이상이면 409(FR-1-5, AC-1-5). 빈 그룹은 정상 204(EX-1-4). */
  async remove(id: string): Promise<void> {
    const row = await this.findRowOrThrow(id);
    if (row._count.chatbots > 0) {
      throw new ApiException(
        'GROUP_NOT_EMPTY',
        409,
        `소속 챗봇 ${row._count.chatbots}개를 먼저 이동하거나 삭제해 주세요.`,
      );
    }
    await this.prisma.chatbotGroup.delete({ where: { id } });
    await this.auditLogService.record({ action: 'DELETE', targetType: 'ChatbotGroup', targetId: row.id, targetName: row.name, before: row });
  }

  /** 그룹 복사 — 소속 챗봇도 함께 복제한다(FR-1-7, AC-1-9). 하위 대화설계 리소스는 복제하지 않는다(FR-1-14). */
  async copy(id: string, dto: CopyChatbotGroupDto): Promise<ChatbotGroupWithCount> {
    const original = await this.prisma.chatbotGroup.findUnique({
      where: { id },
      include: { chatbots: true },
    });
    if (!original) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const newGroupName = dto.name ?? deriveCopyName(original.name);

    return this.prisma.$transaction(async (tx) => {
      const newGroup = await tx.chatbotGroup.create({
        data: { name: newGroupName, description: original.description },
      });

      for (const bot of original.chatbots) {
        const newName = deriveCopyName(bot.name);
        let newSlug: string;
        try {
          newSlug = await deriveCopySlug(bot.slug, async (candidate) => {
            const exists = await tx.chatbot.findUnique({ where: { slug: candidate }, select: { id: true } });
            return exists !== null;
          });
        } catch (e) {
          if (e instanceof SlugDerivationExhaustedError) {
            throw new ApiException('DUPLICATE_SLUG', 409, '이미 사용 중인 고유 URL입니다. 다른 값을 입력해 주세요.');
          }
          throw e;
        }

        await tx.chatbot.create({
          data: {
            groupId: newGroup.id,
            name: newName,
            slug: newSlug,
            avatarUrl: bot.avatarUrl,
            description: bot.description,
            status: 'DRAFT',
            skin: bot.skin,
          },
        });
      }

      const result = await tx.chatbotGroup.findUniqueOrThrow({
        where: { id: newGroup.id },
        include: GROUP_WITH_COUNT_INCLUDE,
      });
      return result;
    }).then(async (result) => {
      await this.auditLogService.record({ action: 'COPY', targetType: 'ChatbotGroup', targetId: result.id, targetName: result.name, after: result });
      return toChatbotGroupWithCountDto(result);
    });
  }

  private async findRowOrThrow(id: string) {
    const row = await this.prisma.chatbotGroup.findUnique({ where: { id }, include: GROUP_WITH_COUNT_INCLUDE });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }
}
