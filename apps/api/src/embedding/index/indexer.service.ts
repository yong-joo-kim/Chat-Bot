import { Injectable, Logger } from '@nestjs/common';
import type { EmbeddingOwnerType } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { EmbeddingProviderFactory } from '../embedding-provider.factory';
import { encodeVector } from '../lib/vector-codec';
import { textHashOf } from '../lib/text-hash';

interface IndexTarget {
  ownerType: EmbeddingOwnerType;
  ownerId: string;
  slotIndex: number;
  text: string;
}

const BATCH_SIZE = 64;

/**
 * 1단계 색인 갱신(§8.9, DD-76) — 색인 대상 4종만 다룬다(FR-N1-16). 트리거는
 * `DialogueBundleService.invalidate()` 1지점뿐이며 대화 자산 쓰기 경로에 색인 로직을
 * 복제하지 않는다. `embedding`은 `dialogue-common`을 의존하지 않으므로 FAQ/의도를
 * Prisma에서 직접 읽는다(DD-85).
 */
@Injectable()
export class IndexerService {
  private readonly logger = new Logger('IndexerService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerFactory: EmbeddingProviderFactory,
  ) {}

  async reindexChatbot(chatbotId: string): Promise<void> {
    const provider = await this.providerFactory.getProvider();
    if (!provider) {
      this.logger.warn(`임베딩 서비스를 사용할 수 없어 색인을 건너뜁니다(저하 모드): chatbotId=${chatbotId}`);
      return;
    }

    const [faqs, intents] = await Promise.all([
      this.prisma.faqEntry.findMany({ where: { chatbotId } }),
      this.prisma.intent.findMany({ where: { chatbotId } }),
    ]);

    const targets: IndexTarget[] = [];
    for (const faq of faqs) {
      // FR-N1-17 — enabled=false여도 색인은 유지한다(매칭 제외는 apps/api 조회 시 판정).
      targets.push({ ownerType: 'FAQ_QUESTION', ownerId: faq.id, slotIndex: 0, text: faq.question });
      this.parseArray(faq.altQuestions).forEach((alt, i) => {
        targets.push({ ownerType: 'FAQ_ALT', ownerId: faq.id, slotIndex: i, text: alt });
      });
    }
    for (const intent of intents) {
      targets.push({ ownerType: 'INTENT_NAME', ownerId: intent.id, slotIndex: 0, text: intent.name });
      this.parseArray(intent.examples).forEach((example, i) => {
        targets.push({ ownerType: 'INTENT_EXAMPLE', ownerId: intent.id, slotIndex: i, text: example });
      });
    }

    const existing = await this.prisma.embeddingVector.findMany({
      where: { chatbotId, modelId: provider.modelId },
      select: { ownerType: true, ownerId: true, slotIndex: true, textHash: true, status: true },
    });
    const key = (o: { ownerType: string; ownerId: string; slotIndex: number }): string => `${o.ownerType}:${o.ownerId}:${o.slotIndex}`;
    const existingMap = new Map(existing.map((e) => [key(e), e]));

    // 갱신 단위는 텍스트 1건 — 해시가 같고 이미 READY면 재임베딩하지 않는다(FR-N1-19).
    const toEmbed = targets.filter((t) => {
      const found = existingMap.get(key(t));
      return !found || found.status !== 'READY' || found.textHash !== textHashOf(t.text);
    });

    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      try {
        const vectors = await provider.embed(
          batch.map((b) => b.text),
          'PASSAGE',
        );
        await Promise.all(batch.map((target, idx) => this.upsertReady(chatbotId, provider.modelId, provider.dimension, target, vectors[idx])));
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown error';
        this.logger.warn(`배치 임베딩 실패(best-effort, 재시도 대상) — chatbotId=${chatbotId} count=${batch.length} error=${reason}`);
        await Promise.all(batch.map((target) => this.upsertFailed(chatbotId, provider.modelId, provider.dimension, target, reason)));
      }
      // 배치 간 양보(NFR-P5) — 대화 처리 이벤트 루프에 기회를 준다.
      await new Promise((resolve) => setImmediate(resolve));
    }

    // 고아 정리(DD-69) — 더 이상 존재하지 않는 FAQ/의도의 벡터를 제거한다(현재 modelId 한정).
    const targetKeySet = new Set(targets.map(key));
    const orphans = existing.filter((e) => !targetKeySet.has(key(e)));
    for (const orphan of orphans) {
      await this.prisma.embeddingVector.deleteMany({
        where: { chatbotId, modelId: provider.modelId, ownerType: orphan.ownerType, ownerId: orphan.ownerId, slotIndex: orphan.slotIndex },
      });
    }
  }

  private async upsertReady(chatbotId: string, modelId: string, dimension: number, target: IndexTarget, vector: Float32Array): Promise<void> {
    const where = {
      chatbotId_ownerType_ownerId_slotIndex_modelId: {
        chatbotId,
        ownerType: target.ownerType,
        ownerId: target.ownerId,
        slotIndex: target.slotIndex,
        modelId,
      },
    };
    const shared = { dimension, textHash: textHashOf(target.text), vector: encodeVector(vector), status: 'READY', failureReason: null };
    await this.prisma.embeddingVector.upsert({
      where,
      create: { chatbotId, ownerType: target.ownerType, ownerId: target.ownerId, slotIndex: target.slotIndex, modelId, ...shared },
      update: shared,
    });
  }

  private async upsertFailed(chatbotId: string, modelId: string, dimension: number, target: IndexTarget, reason: string): Promise<void> {
    const where = {
      chatbotId_ownerType_ownerId_slotIndex_modelId: {
        chatbotId,
        ownerType: target.ownerType,
        ownerId: target.ownerId,
        slotIndex: target.slotIndex,
        modelId,
      },
    };
    await this.prisma.embeddingVector.upsert({
      where,
      create: {
        chatbotId,
        ownerType: target.ownerType,
        ownerId: target.ownerId,
        slotIndex: target.slotIndex,
        modelId,
        dimension,
        textHash: textHashOf(target.text),
        vector: '',
        status: 'FAILED',
        failureReason: reason,
      },
      update: { status: 'FAILED', failureReason: reason },
    });
  }

  private parseArray(json: string): string[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
}
