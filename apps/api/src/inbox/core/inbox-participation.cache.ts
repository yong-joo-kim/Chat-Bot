import { Injectable } from '@nestjs/common';
import { INBOX_LIMITS } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

interface ParticipationEntry {
  identitySecretRef: string | null;
  openOnWarning: boolean;
  /** [신규 §9.1] 같은 조회(관계 include)로 챗봇 이름을 함께 실어 목록·요약의 이름 조회 쿼리를 0으로 만든다. */
  chatbotName: string;
}

interface ParticipationSnapshot {
  byChatbotId: Map<string, ParticipationEntry>;
  fetchedAt: number;
}

/**
 * [신규 No.42] 참여 챗봇 스냅샷(§6.3 · §9.1) — 1쿼리 · TTL 30초 · 같은 인스턴스에서 저장 시
 * 즉시 무효화한다(다른 인스턴스는 최대 30초 — K-4). 비참여 판정은 이 캐시만 읽는다(DB 0).
 */
@Injectable()
export class InboxParticipationCache {
  private snapshot: ParticipationSnapshot | null = null;

  constructor(private readonly prisma: PrismaService) {}

  invalidate(): void {
    this.snapshot = null;
  }

  private async load(): Promise<ParticipationSnapshot> {
    const rows = await this.prisma.chatbotInboxSetting.findMany({
      where: { enabled: true },
      select: { chatbotId: true, identitySecretRef: true, openOnWarning: true, chatbot: { select: { name: true } } },
    });
    const byChatbotId = new Map(rows.map((r) => [r.chatbotId, { identitySecretRef: r.identitySecretRef, openOnWarning: r.openOnWarning, chatbotName: r.chatbot.name }]));
    return { byChatbotId, fetchedAt: Date.now() };
  }

  private async getSnapshot(): Promise<ParticipationSnapshot> {
    if (this.snapshot && Date.now() - this.snapshot.fetchedAt < INBOX_LIMITS.participationCacheTtlMs) return this.snapshot;
    this.snapshot = await this.load();
    return this.snapshot;
  }

  async isParticipating(chatbotId: string): Promise<boolean> {
    const s = await this.getSnapshot();
    return s.byChatbotId.has(chatbotId);
  }

  async get(chatbotId: string): Promise<ParticipationEntry | undefined> {
    const s = await this.getSnapshot();
    return s.byChatbotId.get(chatbotId);
  }

  async participatingChatbotIds(): Promise<string[]> {
    const s = await this.getSnapshot();
    return [...s.byChatbotId.keys()];
  }

  /** [신규 §9.1] 참여 챗봇 {id,name} 목록 — 쿼리 0(캐시에서). */
  async participatingChatbots(): Promise<Array<{ id: string; name: string }>> {
    const s = await this.getSnapshot();
    return [...s.byChatbotId.entries()].map(([id, v]) => ({ id, name: v.chatbotName }));
  }

  /** [신규 §9.1] 챗봇 이름 조회(캐시에서 — 쿼리 0). 캐시에 없으면(비참여·삭제됨) undefined. */
  async chatbotName(chatbotId: string): Promise<string | undefined> {
    const s = await this.getSnapshot();
    return s.byChatbotId.get(chatbotId)?.chatbotName;
  }
}
