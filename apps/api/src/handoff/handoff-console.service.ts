import { Injectable } from '@nestjs/common';
import type { HandoffConsoleResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/** 챗봇 선택기(§17.1 ⑳) — 상담 켜진 챗봇 우선 노출, 활성 상담 수 · 내 상담 수. */
@Injectable()
export class HandoffConsoleService {
  constructor(private readonly prisma: PrismaService) {}

  async listChatbots(viewerId: string): Promise<HandoffConsoleResponse> {
    const chatbots = await this.prisma.chatbot.findMany({ where: { status: { not: 'ARCHIVED' } }, select: { id: true, name: true, status: true } });
    const settings = await this.prisma.chatbotHandoffSetting.findMany({ where: { chatbotId: { in: chatbots.map((c) => c.id) } } });
    const settingsById = new Map(settings.map((s) => [s.chatbotId, s]));

    const activeCounts = await this.prisma.handoffSession.groupBy({
      by: ['chatbotId'],
      where: { chatbotId: { in: chatbots.map((c) => c.id) }, status: { in: ['CONNECTING', 'CONNECTED'] } },
      _count: { _all: true },
    });
    const activeCountByChatbot = new Map(activeCounts.map((a) => [a.chatbotId, a._count._all]));

    const myActiveCount = await this.prisma.handoffSession.count({ where: { assignedUserId: viewerId, status: { in: ['CONNECTING', 'CONNECTED'] } } });

    const items = chatbots
      .map((c) => ({
        chatbotId: c.id,
        name: c.name,
        status: c.status,
        handoffEnabled: settingsById.get(c.id)?.enabled ?? false,
        activeHandoffCount: activeCountByChatbot.get(c.id) ?? 0,
      }))
      .sort((a, b) => Number(b.handoffEnabled) - Number(a.handoffEnabled) || a.name.localeCompare(b.name));

    return { items, myActiveCount };
  }
}
