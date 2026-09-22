import { Injectable, Logger } from '@nestjs/common';
import { toKstDayBucket } from '@chat-bot/shared-types';
import type { RagOutcome } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordRagCallLogParams {
  chatbotId: string;
  conversationLogId?: string;
  outcome: RagOutcome;
  httpStatus?: number;
  latencyMs: number;
  retryCount?: number;
  retrievalSuccess?: 0 | 1;
  sourceCount?: number;
  scopeCompany?: string;
}

/**
 * 외부 RAG 호출 관측 로그(§9.9, FR-N2-32) — **질문·답변 원문을 저장하지 않는다**(AC-N2-29,
 * DD-83). 실패해도 대화 응답에 영향을 주지 않는다(구조는 `UnansweredCollectorService`와 동일).
 */
@Injectable()
export class RagCallLogService {
  private readonly logger = new Logger('RagCallLogService');

  constructor(private readonly prisma: PrismaService) {}

  async record(params: RecordRagCallLogParams): Promise<void> {
    try {
      await this.prisma.ragCallLog.create({
        data: {
          chatbotId: params.chatbotId,
          conversationLogId: params.conversationLogId,
          outcome: params.outcome,
          httpStatus: params.httpStatus,
          latencyMs: params.latencyMs,
          retryCount: params.retryCount ?? 0,
          retrievalSuccess: params.retrievalSuccess,
          sourceCount: params.sourceCount,
          scopeCompany: params.scopeCompany,
          dayBucket: toKstDayBucket(new Date()),
        },
      });
    } catch (e) {
      this.logger.warn(`RagCallLog 적재 실패: chatbotId=${params.chatbotId} error=${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
