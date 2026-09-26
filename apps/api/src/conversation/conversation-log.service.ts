import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import type { ChannelType } from '@chat-bot/shared-types';
import { toKstDayBucket, toKstHourOfDay } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { UnansweredCollectorService } from '../learning/unanswered-collector.service';
import type { InputKind } from '../learning/lib/collect-decision';
import { maskPii } from '@chat-bot/pii-mask';
import { WORKFLOW_EVENT_SINK } from '../common/workflow/workflow-event.port';
import type { WorkflowEventSink } from '../common/workflow/workflow-event.port';

export interface RecordConversationLogParams {
  /** 공개 대화 API의 `messageId`를 그대로 쓴다(§8.3) — 향후 피드백(No.44)이 이 값을 앵커로 쓸 수 있다. */
  id?: string;
  chatbotId: string;
  /** [신규 No.29] 대화 당시 챗봇 소속 그룹 스냅샷(ADR-0033 §4). 호출부가 이미 읽은 챗봇 행에서
   * 전달한다 — 이 서비스는 추가 조회를 하지 않는다. 세 타입(여기·ConversationLogPort·
   * RagAnswerRunInput) 모두 필수라 누락은 컴파일 오류가 된다. */
  groupId: string;
  channelType: ChannelType;
  sessionId: string;
  rawUserMessage: string;
  rawBotResponse: string;
  matchedIntentId?: string;
  matchedNodeId?: string;
  matchedFaqId?: string;
  isAnswered: boolean;
  /** 입구 금지어 필터에 차단된 턴인지(DD-37, FR-12-45). 기본 false. */
  blockedByFilter?: boolean;
  /** [신규 DD-52] 버튼 턴 판별 — `ConversationLog` 컬럼을 늘리지 않고 파이프라인이 직접 전달한다(FR-15-2). */
  inputKind: InputKind;
  /** [신규] 2단계(외부 RAG)가 답한 턴인가(J-10, DD-82). No.14 응답출처 `RAG` 조각의 유일한 근거. 기본 false. */
  answeredByRag?: boolean;
  /** [No.26] 외부 API 고정 문구로 끝난 턴인가(§6.1, FR-L4-13) — 미응답 큐에 적재하지 않는다. 기본 false. */
  apiNotice?: boolean;
  /** [No.27] 이번 턴 입력을 설문 세션이 소비했는가(FR-SV5-8) — 질문 순위·미응답 수집·RAG에서 제외하는 근거. 기본 false. */
  surveyTurn?: boolean;
  /** [No.24] 상담 구간(개입 중·검증된 발신) 사용자 턴인가(ADR-0036 §1) — 질문 순위·미응답 수집에서
   * 제외, 응답출처 OTHER 불변. 기본 false. */
  handoffTurn?: boolean;
  /** [신규 No.22] 답한 자산의 **대화 당시** 토픽(공통·미응답·RAG·상담 턴 = undefined → null). */
  topicId?: string;
  /** [신규 No.44] 이 턴에 평가 버튼을 제공했는가(ADR-0038 §1). 기본 false. */
  feedbackOffered?: boolean;
  /** [신규 No.40] 이 턴을 처리할 때의 운영 포인터(모드 켜짐) — 없으면 라이브 서빙(모드 꺼짐, §14). */
  servedVersionId?: string;
}

/**
 * `ConversationLog` 적재 단일 진입점(FR-11-20, §6 규약 ②). 마스킹은 **이 안에서만** 적용한다
 * (ADR-0013) — 다른 곳에서 `prisma.conversationLog.create`를 직접 호출하지 않는다.
 * No.12부터 **금지어 마스킹 → PII 마스킹** 순서로 처리한다(FR-12-45). 출구 필터로 이미 마스킹된
 * `outputs`에서 만들어진 `rawBotResponse`는 이 2차 마스킹이 사실상 no-op(멱등)이 된다(§10.4).
 * 적재 실패는 대화 응답을 실패시키지 않는다(FR-11-24) — 호출부가 `await` 없이 fire-and-forget으로
 * 부르고, 여기서 모든 예외를 삼켜 경고 로그만 남긴다.
 */
@Injectable()
export class ConversationLogService {
  private readonly logger = new Logger('ConversationLogService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly bannedWordFilter: BannedWordFilterService,
    private readonly collector: UnansweredCollectorService,
    @Optional() @Inject(WORKFLOW_EVENT_SINK) private readonly workflowEvents?: WorkflowEventSink,
  ) {}

  async record(params: RecordConversationLogParams): Promise<void> {
    try {
      // ① 금지어 마스킹 → ② PII 마스킹 순서(FR-12-45). 원문은 어디에도 남기지 않는다(NFR-S4).
      const userMessage = maskPii(await this.bannedWordFilter.maskPlainText(params.rawUserMessage)).maskedText;
      // ⚠ botResponse도 마스킹 대상이다 — completionMessage의 {슬롯} 치환값에 사용자가 입력한
      // 전화번호/이메일이 그대로 들어갈 수 있다(§8.4).
      const botResponse = maskPii(await this.bannedWordFilter.maskPlainText(params.rawBotResponse)).maskedText;

      // ③ dayBucket/hourBucket 계산(KST, 적재 시점 확정 — DD-50/59, ADR-0017). 문자열 1개+정수 1개 계산이라
      // 대화 응답 시간에 측정 가능한 영향이 없다(NFR-P6).
      const now = new Date();
      const dayBucket = toKstDayBucket(now);
      const hourBucket = toKstHourOfDay(now);

      const created = await this.prisma.conversationLog.create({
        data: {
          ...(params.id ? { id: params.id } : {}),
          chatbotId: params.chatbotId,
          groupId: params.groupId,
          channelType: params.channelType,
          sessionId: params.sessionId,
          userMessage,
          botResponse,
          matchedIntentId: params.matchedIntentId,
          matchedNodeId: params.matchedNodeId,
          matchedFaqId: params.matchedFaqId,
          isAnswered: params.isAnswered,
          blockedByFilter: params.blockedByFilter ?? false,
          answeredByRag: params.answeredByRag ?? false,
          dayBucket,
          hourBucket,
          surveyTurn: params.surveyTurn ?? false,
          handoffTurn: params.handoffTurn ?? false,
          apiNotice: params.apiNotice ?? false,
          // [신규 No.22 — §17 T-12] 쓰기 주체는 이 1곳뿐이다.
          topicId: params.topicId,
          // [신규 No.44] 쓰기 주체는 이 1곳뿐이다(F-10). inputKind는 이미 필수 파라미터라 모든
          // 호출부가 값을 넘긴다 — 신규 적재 행은 전부 TEXT/BUTTON_MESSAGE/BUTTON_NODE다(AC-FB2-3).
          feedbackOffered: params.feedbackOffered ?? false,
          inputKind: params.inputKind,
          // [신규 No.40] 쓰기 주체는 이 1곳뿐이다(E-8). 적재 후 불변.
          servedVersionId: params.servedVersionId ?? null,
        },
      });

      // ⑤ 미응답 질문 수집(DD-51, ADR-0019) — INSERT 성공 이후에만 호출한다(§3.4 포함관계 불변식).
      // `record()`는 "무엇을 수집할지"를 알지 않는다 — 마스킹된 값과 판정 결과만 넘긴다.
      await this.collector.collect({
        chatbotId: params.chatbotId,
        channelType: params.channelType,
        questionText: userMessage,
        isAnswered: params.isAnswered,
        blockedByFilter: params.blockedByFilter ?? false,
        inputKind: params.inputKind,
        apiNotice: params.apiNotice ?? false,
        surveyTurn: params.surveyTurn ?? false,
        handoffTurn: params.handoffTurn ?? false,
      });

      // [신규 No.41] 적재 성공 뒤(§6.2) — 연속 미응답 판정은 구독 캐시에 없으면 즉시 반환한다(DB 0).
      this.workflowEvents?.emit({
        kind: 'TURN_LOGGED',
        chatbotId: params.chatbotId,
        sessionId: params.sessionId,
        channelType: params.channelType,
        messageId: created.id,
        isAnswered: params.isAnswered,
        blockedByFilter: params.blockedByFilter ?? false,
        surveyTurn: params.surveyTurn ?? false,
        handoffTurn: params.handoffTurn ?? false,
        apiNotice: params.apiNotice ?? false,
        occurredAt: now,
      });
    } catch (e) {
      // 경고 로그에도 메시지 본문을 넣지 않는다(chatbotId/sessionId/오류코드만, NFR-S4).
      const errorMessage = e instanceof Error ? e.message : 'unknown error';
      this.logger.warn(`ConversationLog 적재 실패: chatbotId=${params.chatbotId} sessionId=${params.sessionId} error=${errorMessage}`);
    }
  }
}
