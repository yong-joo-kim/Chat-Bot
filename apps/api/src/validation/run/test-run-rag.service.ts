import { Injectable } from '@nestjs/common';
import { maskPii } from '@chat-bot/pii-mask';
import type { ChatbotAnswerSetting, TestRunResultBand } from '@chat-bot/shared-types';
import { RagHttpClient } from '../../rag/rag-http.client';
import { RagGateService } from '../../rag/rag-gate.service';
import { judgeRagResponse } from '../../rag/lib/judge-rag-response';
import { RagQueryResponseSchema } from '../../rag/lib/rag-response.schema';

export interface TestRunRagResult {
  /** 이 문장이 실제 대화였다면 2단계로 갔을 것(band FAILED + RAG 사용 가능) — `useRag` 옵션과 무관하게 표시만 한다. */
  wouldUseRag: boolean;
  /** 실제로 외부 RAG를 호출했는가(상한·게이트를 통과해 시도했는가). */
  ragAttempted?: boolean;
  ragLatencyMs?: number;
  ragSourceCount?: number;
}

/**
 * TC 실행의 RAG(2단계) 취급(J-10, ADR-0030 §3) — **`RagHttpClient`/`RagGateService`를 그대로
 * 재사용**한다(두 번째 외부 RAG 출구를 만들지 않는다). 기본 `useRag=false`, 실행당 상한은
 * 호출부(실행기)가 카운터로 관리한다(이 서비스는 매 호출이 이미 상한 이내임을 전제한다).
 * 게이트 획득 실패 시 **대기하지 않고 건너뛴다**(운영 대화 우선). `RagCallLog`는 남기지 않는다.
 */
@Injectable()
export class TestRunRagService {
  constructor(
    private readonly ragHttpClient: RagHttpClient,
    private readonly ragGate: RagGateService,
  ) {}

  async attempt(
    questionText: string,
    bandKind: TestRunResultBand | undefined,
    settings: Pick<ChatbotAnswerSetting, 'ragEnabled' | 'ragCompany' | 'ragCategory' | 'ragSubcategory' | 'ragSimilarityThreshold' | 'ragTimeoutMs'>,
    useRag: boolean,
    underBudget: boolean,
  ): Promise<TestRunRagResult> {
    const wouldUseRag = bandKind === 'FAILED' && settings.ragEnabled && !!settings.ragCompany && this.ragHttpClient.isConfigured();

    if (!useRag || !wouldUseRag || !underBudget) {
      return { wouldUseRag };
    }
    if (!this.ragGate.tryAcquire()) {
      return { wouldUseRag }; // 대기하지 않고 건너뛴다 — 운영 대화의 2단계를 굶기지 않는다.
    }

    const start = Date.now();
    try {
      const maskedQuestion = maskPii(questionText).maskedText;
      const httpResult = await this.ragHttpClient.query(
        {
          question: maskedQuestion,
          company: settings.ragCompany as string,
          category: settings.ragCategory ?? undefined,
          subcategory: settings.ragSubcategory ?? undefined,
          similarityThreshold: settings.ragSimilarityThreshold ?? undefined,
        },
        settings.ragTimeoutMs,
      );
      if (!httpResult.networkError && httpResult.httpStatus === 200) {
        const parsed = RagQueryResponseSchema.safeParse(httpResult.body);
        if (parsed.success) {
          const judgement = judgeRagResponse(parsed.data);
          this.ragGate.recordSuccess();
          return {
            wouldUseRag,
            ragAttempted: true,
            ragLatencyMs: Date.now() - start,
            ragSourceCount: judgement.ok ? judgement.response.source_info?.total_sources : undefined,
          };
        }
        this.ragGate.recordFailure();
      } else {
        this.ragGate.recordFailure();
      }
      return { wouldUseRag, ragAttempted: true, ragLatencyMs: Date.now() - start };
    } finally {
      this.ragGate.release();
    }
  }
}
