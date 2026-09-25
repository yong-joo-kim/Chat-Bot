import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DialogueBundleService } from '../dialogue-common/dialogue-bundle.service';
import type { TransferSource } from './lib/transfer-selection';

/**
 * ① 캡처(topic-system-설계.md §9.1) — 인터랙티브 트랜잭션 안에서 `build(chatbotId, tx)`(필터 없음)를
 * 호출만 하고, 토픽 목록을 순차 조회한다(§6.1 M-1과 같은 이유 — 단일 커넥션 tx에서 순차 await).
 */
@Injectable()
export class AssetTransferCaptureService {
  constructor(private readonly bundleService: DialogueBundleService) {}

  async captureTransferSource(tx: Prisma.TransactionClient, chatbotId: string): Promise<TransferSource> {
    const bundle = await this.bundleService.build(chatbotId, tx);
    const topics = await tx.topic.findMany({
      where: { chatbotId },
      orderBy: [{ sortOrder: 'asc' }],
      select: { id: true, name: true, description: true, sortOrder: true, enabled: true },
    });
    return { chatbotId, bundle, topics, capturedAt: new Date() };
  }
}
