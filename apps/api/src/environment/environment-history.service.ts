import { Injectable } from '@nestjs/common';
import type { EnvironmentHistoryQuery, EnvironmentSwitchLogItem, Paginated } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';

/** [신규 No.40] 전환 이력 조회(읽기 전용, §9.6) — `createdAt desc` 고정. 삭제·수정 경로 0(append-only). */
@Injectable()
export class EnvironmentHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(chatbotId: string, query: EnvironmentHistoryQuery): Promise<Paginated<EnvironmentSwitchLogItem>> {
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');

    const where = { chatbotId, ...(query.environment ? { environment: query.environment } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.environmentSwitchLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.environmentSwitchLog.count({ where }),
    ]);

    const items: EnvironmentSwitchLogItem[] = rows.map((row) => ({
      id: row.id,
      environment: row.environment as 'STAGING' | 'PROD',
      method: row.method as EnvironmentSwitchLogItem['method'],
      fromVersionNo: row.fromVersionNo,
      toVersionNo: row.toVersionNo,
      toVersionId: row.toVersionId,
      deployScheduleId: row.deployScheduleId,
      disableMode: row.disableMode as EnvironmentSwitchLogItem['disableMode'],
      actorEmail: row.actorEmail,
      reason: row.reason,
      createdAt: row.createdAt,
    }));

    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
