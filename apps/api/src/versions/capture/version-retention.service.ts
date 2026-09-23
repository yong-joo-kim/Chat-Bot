import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatbotVersionTrigger } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { selectVersionsToPrune } from '../lib/retention-policy';
import type { VersionMeta } from '../lib/retention-policy';

/**
 * 보존 정리(§6.6, FR-H1-16/18/19) — 새 스냅샷 생성 **직후** 같은 요청 안에서 호출한다(스케줄러 없음).
 * best-effort — 실패는 흡수하고 경고 로그만 남긴다(다음 생성 때 다시 시도된다). 정리는 감사하지
 * 않는다(FR-H3-18).
 */
@Injectable()
export class VersionRetentionService {
  private readonly logger = new Logger('VersionRetentionService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private policy() {
    return {
      retentionAuto: this.config.get<number>('VERSION_RETENTION_AUTO') ?? 30,
      retentionManual: this.config.get<number>('VERSION_RETENTION_MANUAL') ?? 30,
      totalMaxBytes: this.config.get<number>('VERSION_TOTAL_MAX_BYTES_PER_CHATBOT') ?? 314572800,
    };
  }

  /**
   * [신규 2026-09-23 No.25] 수동 단건 삭제(§10.1 `DELETE .../versions/:versionId`) — `version.service.ts`가
   * `chatbotVersionPayload`를 직접 참조하지 않도록(§16 V-7) 이 서비스가 대신 지운다.
   */
  async deleteOne(versionId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.chatbotVersionPayload.deleteMany({ where: { versionId } });
      await tx.chatbotVersion.delete({ where: { id: versionId } });
    });
  }

  async pruneBestEffort(chatbotId: string, justCreatedId: string): Promise<void> {
    try {
      const rows = await this.prisma.chatbotVersion.findMany({
        where: { chatbotId },
        select: { id: true, trigger: true, versionNo: true, pinned: true, sizeBytes: true },
      });
      const metas: VersionMeta[] = rows.map((r) => ({
        id: r.id,
        trigger: r.trigger as ChatbotVersionTrigger,
        versionNo: r.versionNo,
        pinned: r.pinned,
        sizeBytes: r.sizeBytes,
      }));

      const result = selectVersionsToPrune(metas, this.policy(), justCreatedId);
      if (result.pruneIds.length === 0) return;

      await this.prisma.$transaction(async (tx) => {
        await tx.chatbotVersionPayload.deleteMany({ where: { versionId: { in: result.pruneIds } } });
        await tx.chatbotVersion.deleteMany({ where: { id: { in: result.pruneIds } } });
      });

      if (result.stillOverLimit) {
        this.logger.warn(`챗봇 ${chatbotId}의 버전 총량이 정리 후에도 상한을 초과합니다(고정 버전만 남음).`);
      }
    } catch (e) {
      this.logger.warn(`버전 보존 정리 실패(best-effort): chatbotId=${chatbotId} error=${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
