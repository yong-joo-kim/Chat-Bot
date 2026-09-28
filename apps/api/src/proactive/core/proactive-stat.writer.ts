import { Injectable, Logger } from '@nestjs/common';
import { toKstDayBucket } from '@chat-bot/shared-types';
import type { ProactiveEventKind } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * [신규 No.35] ★ `ProactiveDailyStat` 쓰기 유일 파일(+ `chatbots.service.ts` 영구삭제 동반 삭제만
 * 예외, PA-2). `upsert` + `increment` · `P2002`(동시 생성 경합) 1회 재시도. 실패는 경고 로그만(§5.3).
 */
const COLUMN_BY_KIND: Record<ProactiveEventKind, 'shown' | 'clicked' | 'dismissed' | 'optedOut'> = {
  SHOWN: 'shown',
  CLICKED: 'clicked',
  DISMISSED: 'dismissed',
  OPTED_OUT: 'optedOut',
};

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

@Injectable()
export class ProactiveStatWriter {
  private readonly logger = new Logger('ProactiveStatWriter');

  constructor(private readonly prisma: PrismaService) {}

  async increment(chatbotId: string, ruleId: string, ruleName: string, now: Date, kind: ProactiveEventKind): Promise<void> {
    const dayBucket = toKstDayBucket(now);
    const column = COLUMN_BY_KIND[kind];

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.proactiveDailyStat.upsert({
          where: { ruleId_dayBucket: { ruleId, dayBucket } },
          create: { chatbotId, ruleId, ruleName, dayBucket, [column]: 1 },
          update: { ruleName, [column]: { increment: 1 } },
        });
        return;
      } catch (e) {
        if (isUniqueConstraintViolation(e) && attempt === 0) continue;
        this.logger.warn(`선제 안내 집계 증가 실패: chatbotId=${chatbotId} kind=${kind}`);
        return;
      }
    }
  }
}
