import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { DialogOutput } from '@chat-bot/shared-types';
import { maskPii } from '@chat-bot/pii-mask';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { GuardrailRuntimeService } from '../guardrails/runtime/guardrail-runtime.service';
import type { InputKind } from '../learning/lib/collect-decision';
import { RagHttpClient } from './rag-http.client';
import { RagGateService } from './rag-gate.service';
import { RagCallLogService } from './rag-call-log.service';
import type { PendingAnswerStore } from './pending-answer.store';
import type { ConversationLogPort } from './conversation-log.port';
import { judgeRagResponse } from './lib/judge-rag-response';
import { truncateAnswer } from './lib/truncate-answer';
import { sanitizeSources, scopeMismatchDetected } from './lib/sanitize-sources';
import { RagErrorBodySchema, RagQueryResponseSchema } from './lib/rag-response.schema';
import type { RagQueryResponseRaw } from './lib/rag-response.schema';
import type { RagOutcome } from '@chat-bot/shared-types';

export interface RagAnswerRunInput {
  messageId: string;
  chatbotId: string;
  /** [신규 No.29] 대화 당시 챗봇 소속 그룹 스냅샷(ADR-0033 §4) — 요청 시점 값. */
  groupId: string;
  sessionId: string;
  /** 마스킹 전 원문. 이 서비스 내부에서 송신 직전 PII 마스킹을 적용한다(J-9, FR-0-47). */
  question: string;
  scope: { company: string; category?: string | null; subcategory?: string | null };
  similarityThreshold?: number | null;
  timeoutMs: number;
  showSources: boolean;
  fallbackText: string;
  inputKind: InputKind;
  /** [신규 No.44] 이 턴에 평가 버튼을 제공했는가(ADR-0038 §1). */
  feedbackOffered?: boolean;
  /** [신규 No.40] POST 시점의 운영 포인터(§14 — 그 사이 전환돼도 POST 시점 버전이 적재된다). */
  servedVersionId?: string;
}

type CallResult =
  | { kind: 'SUCCESS'; response: RagQueryResponseRaw; retryCount: number }
  | { kind: 'FAILURE'; outcome: RagOutcome; httpStatus?: number; retryCount: number };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 2단계(외부 RAG) 백그라운드 처리 1건(§9.2~§9.9, ADR-0023) — PII 마스킹 → `RagHttpClient.query()`
 * → 판정(FR-N2-17) → 출처 정제 → 출구 금지어 마스킹 → `PendingAnswerStore.complete()` →
 * `RagCallLog` 1건 + `ConversationLog` 1건(`ConversationLogPort`, DD-81). 모든 실패는 기존
 * 폴백 경로로 수렴한다(FR-0-43) — 사용자에게 오류를 노출하지 않는다.
 */
@Injectable()
export class RagAnswerService {
  private readonly logger = new Logger('RagAnswerService');

  constructor(
    private readonly ragHttpClient: RagHttpClient,
    private readonly gate: RagGateService,
    private readonly callLog: RagCallLogService,
    @Inject('PendingAnswerStore') private readonly pendingStore: PendingAnswerStore,
    private readonly bannedWordFilter: BannedWordFilterService,
    // [신규 No.36 — 6번째 인자(끝), 선택] 출구 판정(§6.1). 선택 인자라 기존 5인자 생성자 호출(단위 시험)은
    // 무수정 통과한다 — 없으면 출구 판정 0(도입 전 동작).
    @Optional() private readonly guardrails?: GuardrailRuntimeService,
  ) {}

  /** fire-and-forget 진입점 — 호출부(`PublicConversationService`)는 `await`하지 않는다. */
  enqueue(input: RagAnswerRunInput, logPort: ConversationLogPort): void {
    void this.run(input, logPort).catch((e) => {
      this.logger.warn(`RAG 백그라운드 처리 중 예상치 못한 예외: chatbotId=${input.chatbotId} error=${e instanceof Error ? e.message : 'unknown'}`);
    });
  }

  /**
   * ⚠ 유량 슬롯(`RagGateService.tryAcquire()`)은 **호출부**(`PublicConversationService`/
   * `SimulationService`)가 PENDING 여부를 결정하는 시점에 이미 확보해 둔다 — AC-N2-13("동시
   * 호출 상한 초과 시 대기하지 않고 즉시 폴백")이 **첫 응답 자체**를 즉시 폴백으로 요구하기
   * 때문에, 슬롯 확보 실패를 PENDING 이후(백그라운드)에야 알면 안 된다. 이 메서드는 항상
   * 이미 확보된 슬롯 1개를 전제하고, 끝나면 `finally`에서 반납만 한다 — 여기서 다시
   * `tryAcquire()`를 호출하지 않는다(이중 소비 방지).
   */
  private async run(input: RagAnswerRunInput, logPort: ConversationLogPort): Promise<void> {
    const maskedQuestion = maskPii(input.question).maskedText;
    const start = Date.now();

    try {
      if (!this.ragHttpClient.isConfigured()) {
        await this.finishAsFallback(input, logPort, maskedQuestion);
        return;
      }

      const vllmReady = await this.gate.isVllmReady();
      if (vllmReady === false) {
        await this.callLog.record({ chatbotId: input.chatbotId, conversationLogId: input.messageId, outcome: 'CIRCUIT_OPEN', latencyMs: Date.now() - start, scopeCompany: input.scope.company });
        await this.finishAsFallback(input, logPort, maskedQuestion);
        return;
      }

      const call = await this.callWithRetry(input, maskedQuestion);
      const latencyMs = Date.now() - start;

      if (call.kind === 'FAILURE') {
        this.gate.recordFailure();
        await this.callLog.record({
          chatbotId: input.chatbotId,
          conversationLogId: input.messageId,
          outcome: call.outcome,
          httpStatus: call.httpStatus,
          latencyMs,
          retryCount: call.retryCount,
          scopeCompany: input.scope.company,
        });
        await this.finishAsFallback(input, logPort, maskedQuestion);
        return;
      }

      this.gate.recordSuccess();
      const judgement = judgeRagResponse(call.response);

      if (!judgement.ok) {
        await this.callLog.record({
          chatbotId: input.chatbotId,
          conversationLogId: input.messageId,
          outcome: 'NO_EVIDENCE',
          httpStatus: 200,
          latencyMs,
          retryCount: call.retryCount,
          retrievalSuccess: call.response.retrieval_success,
          scopeCompany: input.scope.company,
        });
        await this.finishAsFallback(input, logPort, maskedQuestion);
        return;
      }

      const scopeMismatch = scopeMismatchDetected(judgement.response.source_info, input.scope.company);
      if (scopeMismatch) {
        this.logger.warn(`RAG 응답의 common_metadata.company가 요청 스코프와 다릅니다: chatbotId=${input.chatbotId}`);
      }
      const sources = input.showSources && !scopeMismatch ? sanitizeSources(judgement.response.source_info) : [];
      const answerText = truncateAnswer(judgement.response.result);
      // [신규 No.36] 출구 가드레일(§6.1) — 2,000자 절단 직후 · 출구 금지어 마스킹 전. 예외를 던지지 않는다.
      const verdict = this.guardrails ? await this.guardrails.evaluateOutbound(input.chatbotId, answerText) : null;

      if (verdict && (verdict.kind === 'REPLACE' || verdict.kind === 'FALLBACK')) {
        // 외부 호출 자체는 성공 — 호출 품질 기록은 그대로 남기고, 사용자에게는 기존 실패 수렴(`FAILED`)으로 끝낸다(출처 0).
        await this.callLog.record({
          chatbotId: input.chatbotId,
          conversationLogId: input.messageId,
          outcome: 'SUCCESS',
          httpStatus: 200,
          latencyMs,
          retryCount: call.retryCount,
          retrievalSuccess: 1,
          sourceCount: judgement.response.source_info?.total_sources,
          scopeCompany: input.scope.company,
        });
        const replacement = verdict.kind === 'REPLACE' && verdict.replacementText ? verdict.replacementText : input.fallbackText;
        // [신규 No.32] 안전 문구 대체(REPLACE)만 `safety` 표식을 단다 — 출구 `FALLBACK`(챗봇 폴백 문구)은 표식 없음(말투 SAFETY 고정은 대체에만 — C-6).
        await this.finishAsFallback(input, logPort, maskedQuestion, {
          text: replacement,
          guardrailStage: 'OUTBOUND',
          ...(verdict.kind === 'REPLACE' ? { safety: true as const } : {}),
        });
        this.guardrails?.recordEvents({ chatbotId: input.chatbotId, messageId: input.messageId, verdict });
        return;
      }

      const finalText = verdict ? verdict.text : answerText;
      const outputs = await this.bannedWordFilter.maskOutbound([{ type: 'TEXT', payload: { text: finalText } } as DialogOutput]);

      await this.callLog.record({
        chatbotId: input.chatbotId,
        conversationLogId: input.messageId,
        outcome: 'SUCCESS',
        httpStatus: 200,
        latencyMs,
        retryCount: call.retryCount,
        retrievalSuccess: 1,
        sourceCount: judgement.response.source_info?.total_sources,
        scopeCompany: input.scope.company,
      });

      this.pendingStore.complete(input.messageId, { status: 'READY', outputs, sources });

      await logPort.record({
        id: input.messageId,
        chatbotId: input.chatbotId,
        groupId: input.groupId,
        channelType: 'WEB',
        sessionId: input.sessionId,
        rawUserMessage: maskedQuestion,
        rawBotResponse: finalText,
        isAnswered: true,
        answeredByRag: true,
        inputKind: input.inputKind,
        feedbackOffered: input.feedbackOffered,
        ...(input.servedVersionId ? { servedVersionId: input.servedVersionId } : {}),
      });
      if (verdict) this.guardrails?.recordEvents({ chatbotId: input.chatbotId, messageId: input.messageId, verdict });
    } finally {
      this.gate.release();
    }
  }

  /**
   * `override`([신규 No.36]) — 출구 가드레일이 답을 막았을 때만 준다: 사용자에게 나갈 문구와 대화 기록 표식.
   * 없으면 현행과 같다(기존 호출 4곳 무수정).
   */
  private async finishAsFallback(
    input: RagAnswerRunInput,
    logPort: ConversationLogPort,
    maskedQuestion: string,
    override?: { text: string; guardrailStage: 'OUTBOUND'; safety?: true },
  ): Promise<void> {
    const fallbackText = override?.text ?? input.fallbackText;
    const outputs = await this.bannedWordFilter.maskOutbound([{ type: 'TEXT', payload: { text: fallbackText } } as DialogOutput]);
    this.pendingStore.complete(input.messageId, { status: 'FAILED', outputs, ...(override?.safety ? { safetyReplaced: true as const } : {}) });
    await logPort.record({
      id: input.messageId,
      chatbotId: input.chatbotId,
      groupId: input.groupId,
      channelType: 'WEB',
      sessionId: input.sessionId,
      rawUserMessage: maskedQuestion,
      rawBotResponse: fallbackText,
      isAnswered: false,
      answeredByRag: false,
      inputKind: input.inputKind,
      feedbackOffered: input.feedbackOffered,
      ...(input.servedVersionId ? { servedVersionId: input.servedVersionId } : {}),
      ...(override ? { guardrailStage: override.guardrailStage } : {}),
    });
  }

  /** 재시도 정책(FR-N2-27, §1.4 근거 6) — 503의 두 종류를 `code` 키 유무로 구분한다. */
  private async callWithRetry(input: RagAnswerRunInput, maskedQuestion: string): Promise<CallResult> {
    let retryCount = 0;
    for (;;) {
      const result = await this.ragHttpClient.query(
        {
          question: maskedQuestion,
          company: input.scope.company,
          category: input.scope.category ?? undefined,
          subcategory: input.scope.subcategory ?? undefined,
          similarityThreshold: input.similarityThreshold ?? undefined,
        },
        input.timeoutMs,
      );

      if (result.networkError) {
        return { kind: 'FAILURE', outcome: 'TIMEOUT', retryCount };
      }

      if (result.httpStatus === 200) {
        const parsed = RagQueryResponseSchema.safeParse(result.body);
        if (!parsed.success) return { kind: 'FAILURE', outcome: 'SCHEMA_INVALID', httpStatus: 200, retryCount };
        return { kind: 'SUCCESS', response: parsed.data, retryCount };
      }

      if (result.httpStatus === 429 && retryCount < 1) {
        retryCount += 1;
        await sleep(3000);
        continue;
      }

      if (result.httpStatus === 503) {
        const errorBody = RagErrorBodySchema.safeParse(result.body);
        const hasCode = errorBody.success && !!errorBody.data.code;
        if (hasCode && retryCount < 1) {
          retryCount += 1;
          await sleep(5000);
          continue;
        }
        // code 없음(vLLM 미준비) 또는 재시도 소진 — 재시도 금지, 즉시 실패.
        return { kind: 'FAILURE', outcome: 'UPSTREAM_ERROR', httpStatus: 503, retryCount };
      }

      // 408 · 500 · 400 등 — 재시도 금지(FR-N2-27).
      return { kind: 'FAILURE', outcome: 'UPSTREAM_ERROR', httpStatus: result.httpStatus, retryCount };
    }
  }
}
