import { Injectable } from '@nestjs/common';
import { judgeBand } from '@chat-bot/dialogue-engine';
import type { ChatbotAnswerSetting, RagConnectionCheckResult, ThresholdPreviewRequestDto, ThresholdPreviewResponse, UpdateAnswerSettingDto } from '@chat-bot/shared-types';
import { ApiException } from '../common/api.exception';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-logs/audit-log.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import { SemanticMatchService } from '../embedding/semantic-match.service';
import { RagHttpClient } from '../rag/rag-http.client';
import { RagStatusResponseSchema, RagDocumentsMetadataResponseSchema } from '../rag/lib/rag-response.schema';
import { parseDocumentMetadata, scopeChunkCount as computeScopeChunkCount } from '../rag/lib/parse-document-metadata';
import { AnswerSettingsCacheService } from './answer-settings-cache.service';
import { toAnswerSettingDto } from './answer-settings.mapper';
import { validateAnswerSettingShape } from './lib/validate-thresholds';

const GRAPH_DB_NOT_LOADED = 'Graph DB가 로드되지 않았습니다.';

/**
 * 챗봇별 1·2단계 답변 설정 CRUD·검증·감사·미리보기·연결 점검(§10.1). 저장은 upsert이며
 * 저장 즉시 다음 턴부터 적용된다(FR-N1-30, 캐시 무효화).
 */
@Injectable()
export class AnswerSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly cache: AnswerSettingsCacheService,
    private readonly auditLog: AuditLogService,
    private readonly bundleService: DialogueBundleService,
    private readonly semanticMatch: SemanticMatchService,
    private readonly ragHttpClient: RagHttpClient,
  ) {}

  async getSettings(chatbotId: string): Promise<ChatbotAnswerSetting> {
    await this.scope.assertReadable(chatbotId);
    return this.cache.get(chatbotId);
  }

  async updateSettings(chatbotId: string, dto: UpdateAnswerSettingDto): Promise<ChatbotAnswerSetting> {
    await this.scope.assertWritable(chatbotId);

    const failure = validateAnswerSettingShape(dto);
    if (failure) {
      throw new ApiException(failure.kind, 400, failure.message, [{ field: failure.field, message: failure.message }]);
    }

    const before = await this.prisma.chatbotAnswerSetting.findUnique({ where: { chatbotId } });
    const row = await this.prisma.chatbotAnswerSetting.upsert({
      where: { chatbotId },
      create: { chatbotId, ...dto },
      update: { ...dto },
    });

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'Chatbot',
      targetId: chatbotId,
      chatbotId,
      before: before ?? undefined,
      after: row,
      summary: 'AI 답변 설정 변경',
    });

    this.cache.invalidate(chatbotId);
    return toAnswerSettingDto(row);
  }

  async preview(chatbotId: string, dto: ThresholdPreviewRequestDto): Promise<ThresholdPreviewResponse> {
    await this.scope.assertReadable(chatbotId);
    const settings = await this.cache.get(chatbotId);

    if (!settings.semanticEnabled) {
      return { band: 'FAILED', top3: [], wouldUseRag: settings.ragEnabled && !!settings.ragCompany };
    }

    const { bundle } = await this.bundleService.getCached(chatbotId);
    const thresholds = { accept: settings.acceptThreshold, low: settings.lowThreshold, margin: settings.marginThreshold };
    const semantic = await this.semanticMatch.score(chatbotId, dto.message, bundle, thresholds);
    if (!semantic) {
      throw new ApiException('EMBEDDING_UNAVAILABLE', 503, '임베딩 서비스를 사용할 수 없거나 색인이 비어 있습니다.');
    }

    // NFR-M2/AC-N3-9 — 엔진과 동일한 판정 함수를 재사용한다(복제 금지).
    const band = judgeBand(semantic.ranked, thresholds);
    const top3 = semantic.ranked.slice(0, 3).map((c) => ({ kind: c.kind, id: c.id, label: c.matchedText, score: c.score }));
    const wouldUseRag = band.kind === 'FAILED' && settings.ragEnabled && !!settings.ragCompany;

    return { band: band.kind, top3, wouldUseRag };
  }

  /** 연결 점검(FR-N3-6/7) — `/api/rag/query`를 호출하지 않는다(AC-N3-4). */
  async testConnection(chatbotId: string): Promise<RagConnectionCheckResult> {
    await this.scope.assertReadable(chatbotId);
    const settings = await this.cache.get(chatbotId);
    const checkedAt = new Date();

    if (!this.ragHttpClient.isConfigured()) {
      return { upstreamStatus: 'NOT_CONFIGURED', vllmReady: null, neo4jReady: null, scopeChunkCount: null, checkedAt };
    }
    if (!settings.ragCompany) {
      throw new ApiException('RAG_NOT_CONFIGURED', 400, '회사(company) 스코프를 먼저 설정해 주세요.');
    }

    const statusResult = await this.ragHttpClient.status(5000);
    if (statusResult.networkError) {
      return { upstreamStatus: 'UNAVAILABLE', vllmReady: null, neo4jReady: null, scopeChunkCount: null, checkedAt };
    }
    const parsedStatus = RagStatusResponseSchema.safeParse(statusResult.body);
    if (!parsedStatus.success || parsedStatus.data.status === 'unhealthy' || statusResult.httpStatus >= 500) {
      return {
        upstreamStatus: 'UNAVAILABLE',
        vllmReady: parsedStatus.success ? parsedStatus.data.vllm_ready : null,
        neo4jReady: null,
        scopeChunkCount: null,
        checkedAt,
      };
    }

    const vllmReady = parsedStatus.data.vllm_ready;
    const neo4jReady = parsedStatus.data.services?.neo4j?.status === 'connected';

    let chunkCount: number | null = null;
    const metaResult = await this.ragHttpClient.documentMetadata(5000);
    if (!metaResult.networkError && metaResult.httpStatus === 200) {
      const parsedMeta = RagDocumentsMetadataResponseSchema.safeParse(metaResult.body);
      if (parsedMeta.success && parsedMeta.data.result !== GRAPH_DB_NOT_LOADED) {
        const parsed = parseDocumentMetadata(parsedMeta.data.result);
        chunkCount = computeScopeChunkCount(parsed, {
          company: settings.ragCompany,
          category: settings.ragCategory,
          subcategory: settings.ragSubcategory,
        });
      }
    }

    return { upstreamStatus: 'OK', vllmReady, neo4jReady, scopeChunkCount: chunkCount, checkedAt };
  }
}
