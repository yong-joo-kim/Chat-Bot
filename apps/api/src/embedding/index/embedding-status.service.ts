import { Injectable } from '@nestjs/common';
import type { EmbeddingIndexStatus } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingProviderFactory } from '../embedding-provider.factory';
import { QueryEmbeddingService } from '../query-embedding.service';

/** `GET /chatbots/:chatbotId/embeddings/status`(FR-N1-23) 응답 조립. */
@Injectable()
export class EmbeddingStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: EmbeddingProviderFactory,
    private readonly queryEmbedding: QueryEmbeddingService,
  ) {}

  async getStatus(chatbotId: string): Promise<EmbeddingIndexStatus> {
    const provider = await this.providerFactory.getProvider();
    const modelId = provider?.modelId ?? null;
    const dimension = provider?.dimension ?? null;

    if (!modelId) {
      return {
        modelId: null,
        dimension: null,
        totalTargets: 0,
        indexed: 0,
        pending: 0,
        failed: 0,
        staleModel: false,
        lastIndexedAt: null,
        providerHealthy: false,
      };
    }

    const [indexed, pending, failed, staleCount, lastReady, providerHealthy] = await Promise.all([
      this.prisma.embeddingVector.count({ where: { chatbotId, modelId, status: 'READY' } }),
      this.prisma.embeddingVector.count({ where: { chatbotId, modelId, status: 'PENDING' } }),
      this.prisma.embeddingVector.count({ where: { chatbotId, modelId, status: 'FAILED' } }),
      this.prisma.embeddingVector.count({ where: { chatbotId, NOT: { modelId } } }),
      this.prisma.embeddingVector.findFirst({
        where: { chatbotId, modelId, status: 'READY' },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.queryEmbedding.providerHealthy(),
    ]);

    return {
      modelId,
      dimension,
      totalTargets: indexed + pending + failed,
      indexed,
      pending,
      failed,
      staleModel: staleCount > 0,
      lastIndexedAt: lastReady?.updatedAt ?? null,
      providerHealthy,
    };
  }
}
