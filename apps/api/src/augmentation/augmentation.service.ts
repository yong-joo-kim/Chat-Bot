import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AugmentationCapability,
  AugmentationGenerateRequestDto,
  AugmentationGenerateResponse,
  AugmentationListQuery,
  AugmentationListResponse,
  AugmentationRejectRequestDto,
  AugmentationRejectResponse,
  AugmentationRunResult,
} from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { EmbeddingProviderFactory } from '../embedding/embedding-provider.factory';
import { TrainingJobService } from '../training-jobs/training-job.service';
import { TrainingJobQueue } from '../training-jobs/training-job.queue';
import { AugmentationProviderFactory } from './providers/augmentation-provider.factory';
import { AugmentationJobRunner } from './augmentation-job.runner';
import { toAugmentationSuggestionDto } from './augmentation-suggestion.mapper';

const NOT_FOUND_MESSAGE = '요청하신 의도를 찾을 수 없습니다.';
const MAX_EXAMPLES = 500; // IntentsService의 예문 상한(FR-L1-4)과 동일 값 — 생성 전 사전 거부 판단용.

@Injectable()
export class AugmentationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly config: ConfigService,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    private readonly augmentationFactory: AugmentationProviderFactory,
    private readonly jobs: TrainingJobService,
    private readonly queue: TrainingJobQueue,
    private readonly runner: AugmentationJobRunner,
  ) {}

  private parseExamples(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private async loadBannedWords(): Promise<string[]> {
    const rows = await this.prisma.bannedWord.findMany({ where: { enabled: true }, select: { word: true } });
    return rows.map((r) => r.word);
  }

  /** `GET .../augmentations/capability`(§4.3) — "조용한 저하"를 만들지 않는다. */
  async capability(chatbotId: string): Promise<AugmentationCapability> {
    await this.scope.assertReadable(chatbotId);
    const bannedWords = await this.loadBannedWords();
    const cap = await this.augmentationFactory.getCapability({ bannedWords });
    const embeddingProvider = await this.embeddingFactory.getProvider();
    return { ...cap, embeddingReady: !!embeddingProvider };
  }

  async generate(chatbotId: string, intentId: string, dto: AugmentationGenerateRequestDto): Promise<AugmentationGenerateResponse> {
    await this.scope.assertWritable(chatbotId);

    const intent = await this.prisma.intent.findFirst({ where: { id: intentId, chatbotId }, select: { id: true, examples: true } });
    if (!intent) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const exampleCount = this.parseExamples(intent.examples).length;
    if (exampleCount >= MAX_EXAMPLES) {
      throw new ApiException('LIMIT_EXCEEDED', 400, `이 의도는 이미 예문 상한(${MAX_EXAMPLES}개)에 도달했습니다. 예문을 정리한 뒤 다시 시도해 주세요.`);
    }

    const active = await this.jobs.findActive(chatbotId, 'AUGMENT', intentId);
    if (active) {
      throw new ApiException('AUGMENTATION_IN_PROGRESS', 409, '이 의도에 대한 증강 작업이 이미 진행 중입니다. 완료 후 다시 시도해 주세요.');
    }

    const maxPending = this.config.get<number>('AUGMENTATION_MAX_PENDING') ?? 500;
    const pendingCount = await this.prisma.augmentationSuggestion.count({ where: { chatbotId, status: 'PENDING' } });
    if (pendingCount >= maxPending) {
      throw new ApiException(
        'LIMIT_EXCEEDED',
        409,
        `검토 대기 중인 증강 제안이 상한(${maxPending}건)에 도달했습니다. 기존 제안을 승인하거나 거절해 정리한 뒤 다시 시도해 주세요.`,
      );
    }

    const embeddingProvider = await this.embeddingFactory.getProvider();
    if (!embeddingProvider) {
      throw new ApiException(
        'AUGMENTATION_UNAVAILABLE',
        503,
        '임베딩 서비스를 사용할 수 없어 검증 없는 증강을 만들 수 없습니다. 임베딩 서비스 연결(EMBEDDING_BASE_URL)을 확인한 뒤 다시 시도해 주세요.',
      );
    }

    const job = await this.jobs.create(chatbotId, 'AUGMENT', intentId);
    const requestedCount = dto.count ?? this.config.get<number>('AUGMENTATION_MAX_SUGGESTIONS') ?? 20;

    this.queue.enqueue(job.id, async (ctx) => {
      const result = await this.runner.run({ chatbotId, intentId, requestedCount, jobId: job.id }, ctx.onProgress);
      return result;
    });

    return { jobId: job.id, status: 'QUEUED' };
  }

  async list(chatbotId: string, intentId: string, query: AugmentationListQuery): Promise<AugmentationListResponse> {
    await this.scope.assertReadable(chatbotId);
    const intent = await this.prisma.intent.findFirst({ where: { id: intentId, chatbotId }, select: { id: true, examples: true } });
    if (!intent) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);

    const statusFilter = query.status && query.status.length > 0 ? query.status : ['PENDING'];
    const where = { chatbotId, intentId, status: { in: statusFilter } };

    const [rows, total] = await Promise.all([
      this.prisma.augmentationSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' as const },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.augmentationSuggestion.count({ where }),
    ]);

    const embeddingProvider = await this.embeddingFactory.getProvider();
    const currentModelId = embeddingProvider?.modelId;
    const ttlDays = this.config.get<number>('AUGMENTATION_SUGGESTION_TTL_DAYS') ?? 7;
    const ttlMs = ttlDays * 86_400_000;
    const now = Date.now();

    const conflictIntentIds = [...new Set(rows.map((r) => r.conflictIntentId).filter((v): v is string => !!v))];
    const conflictIntents = conflictIntentIds.length
      ? await this.prisma.intent.findMany({ where: { id: { in: conflictIntentIds } }, select: { id: true, name: true } })
      : [];
    const conflictNameById = new Map(conflictIntents.map((c) => [c.id, c.name]));

    const items = rows.map((row) =>
      toAugmentationSuggestionDto(row, {
        stale:
          row.status === 'PENDING' &&
          (row.modelId !== currentModelId || now - row.createdAt.getTime() > ttlMs || !intent),
        conflictIntentName: row.conflictIntentId ? conflictNameById.get(row.conflictIntentId) : undefined,
      }),
    );

    const latestJob = await this.jobs.findLatest(chatbotId, 'AUGMENT', intentId);
    let runResult: AugmentationRunResult | undefined;
    if (latestJob?.resultSummary) {
      try {
        const parsed = JSON.parse(latestJob.resultSummary);
        runResult = {
          generated: parsed.generated ?? 0,
          accepted: parsed.accepted ?? 0,
          rejected: parsed.rejected ?? {},
          providerId: parsed.providerId ?? 'rule',
          degraded: parsed.degraded ?? false,
          degradeReason: parsed.degradeReason,
        };
      } catch {
        runResult = undefined;
      }
    }

    const capability = await this.capability(chatbotId);
    const sufficientExamples = this.parseExamples(intent.examples).length >= (this.config.get<number>('AUGMENTATION_SUFFICIENT_EXAMPLES') ?? 10);

    return { items, total, page: query.page, pageSize: query.pageSize, runResult, capability, sufficientExamples };
  }

  async reject(chatbotId: string, intentId: string, dto: AugmentationRejectRequestDto): Promise<AugmentationRejectResponse> {
    await this.scope.assertWritable(chatbotId);
    const result = await this.prisma.augmentationSuggestion.updateMany({
      where: { id: { in: dto.suggestionIds }, chatbotId, intentId, status: 'PENDING' },
      data: { status: 'REJECTED' },
    });
    return { succeeded: result.count };
  }
}
