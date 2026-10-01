import { Injectable, Logger } from '@nestjs/common';
import { toKstDayBucket } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';

/** 일별 숫자 칸 5개(요청 수 = 합 — 저장하지 않는다). */
export type SpeechStatColumn = 'ok' | 'empty' | 'invalid' | 'failed' | 'busy';

function isUniqueConstraintViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}

/**
 * [신규 No.32] ★ `SpeechDailyStat` 쓰기 유일 파일(+ `chatbots.service.ts` 영구삭제 동반 삭제만 예외, VO-7). `upsert` + `increment` ·
 * `P2002`(동시 생성 경합) 1회 재시도. 실패는 경고 로그만 — 응답을 막지 않는다(fire-and-forget). 오디오·글자·세션·IP·시각 원본은 받지도 저장하지도 않는다(VO-8).
 */
@Injectable()
export class SpeechStatWriter {
  private readonly logger = new Logger('SpeechStatWriter');

  constructor(private readonly prisma: PrismaService) {}

  async increment(chatbotId: string, column: SpeechStatColumn, now: Date): Promise<void> {
    const dayBucket = toKstDayBucket(now);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.prisma.speechDailyStat.upsert({
          where: { chatbotId_dayBucket: { chatbotId, dayBucket } },
          create: { chatbotId, dayBucket, [column]: 1 },
          update: { [column]: { increment: 1 } },
        });
        return;
      } catch (e) {
        if (isUniqueConstraintViolation(e) && attempt === 0) continue;
        this.logger.warn(`음성 인식 집계 증가 실패: column=${column}`);
        return;
      }
    }
  }

  /** 응답 대기 0 — 실패해도 예외를 던지지 않는다. */
  recordDetached(chatbotId: string, column: SpeechStatColumn): void {
    void this.increment(chatbotId, column, new Date()).catch(() => undefined);
  }
}
