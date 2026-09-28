import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChatbotKbStatusResponse, KbMetaResponse } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RagHttpClient } from '../rag/rag-http.client';
import { KbRunStore } from './core/kb-run.store';

/** [신규 No.43] 메타(전송 전제·RAG 상태 등)·챗봇 카드(읽기 전용). */
@Injectable()
export class KbStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ragClient: RagHttpClient,
    private readonly store: KbRunStore,
  ) {}

  async meta(): Promise<KbMetaResponse> {
    const ack = this.config.get<string>('KB_INGEST_TRANSPORT_ACK');
    const ingestAck = ack === 'INTERNAL_NETWORK' || ack === 'AUTHENTICATED' || ack === 'TLS' ? ack : null;
    const { ragReady, ragCheckedAt } = await this.store.getWaitingContext([]);
    const failedSourceCount = await this.prisma.kbSource.count({ where: { lastRunStatus: { in: ['FAILED', 'PARTIAL'] } } });
    const needsCleanupSourceCount = await this.prisma.kbDocument.groupBy({ by: ['sourceId'], where: { cleanupReason: { not: null } } }).then((g) => g.length);

    return {
      enabled: true,
      ragConfigured: this.ragClient.isConfigured(),
      ingestAck,
      ragReady,
      ragCheckedAt,
      htmlFormat: (this.config.get<string>('KB_HTML_INGEST_FORMAT') ?? 'DOCX') as KbMetaResponse['htmlFormat'],
      caps: { maxPages: this.config.get<number>('KB_CRAWL_MAX_PAGES_CAP') ?? 5000, maxFileBytes: this.config.get<number>('KB_CRAWL_MAX_FILE_BYTES') ?? 20971520 },
      privateAllowlistConfigured: (this.config.get<string>('KB_CRAWL_PRIVATE_ALLOWLIST') ?? '').length > 0,
      governanceMode: (this.config.get<string>('DATA_GOVERNANCE_MODE') as 'OFF' | 'ON') ?? 'OFF',
      rawFileIngestAllowedByServer: this.config.get<boolean>('KB_ALLOW_RAW_FILE_INGEST') ?? false,
      bulkWindow: (this.config.get<string>('KB_INGEST_BULK_WINDOW') ?? '') || null,
      failedSourceCount,
      needsCleanupSourceCount,
    };
  }

  async chatbotStatus(chatbotId: string): Promise<ChatbotKbStatusResponse> {
    const answerSetting = await this.prisma.chatbotAnswerSetting.findUnique({ where: { chatbotId }, select: { ragCompany: true, ragCategory: true, ragSubcategory: true } });
    if (!answerSetting?.ragCompany) return { sources: [], environmentModeOn: false };

    const sources = await this.prisma.kbSource.findMany({
      where: {
        scopeCompany: answerSetting.ragCompany,
        ...(answerSetting.ragCategory ? { scopeCategory: answerSetting.ragCategory } : {}),
        // [버그 수정 — 3차 보완] §11 매칭 규칙은 회사·카테고리·서브카테고리 3단인데 서브카테고리
        // 조건이 빠져 있었다(카테고리까지만 같으면 서브카테고리가 다른 소스도 걸렸다).
        ...(answerSetting.ragSubcategory ? { scopeSubcategory: answerSetting.ragSubcategory } : {}),
      },
      select: { id: true, name: true, lastRunStatus: true, lastRunFinishedAt: true },
    });
    const needsCleanupBySource = await this.prisma.kbDocument.groupBy({ by: ['sourceId'], where: { sourceId: { in: sources.map((s) => s.id) }, cleanupReason: { not: null } }, _count: { _all: true } });
    const needsCleanupMap = new Map(needsCleanupBySource.map((g) => [g.sourceId, g._count._all]));

    return {
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        lastRunStatus: (s.lastRunStatus as ChatbotKbStatusResponse['sources'][number]['lastRunStatus']) ?? null,
        lastSyncedAt: s.lastRunFinishedAt,
        needsCleanupCount: needsCleanupMap.get(s.id) ?? 0,
      })),
      environmentModeOn: false,
    };
  }
}
