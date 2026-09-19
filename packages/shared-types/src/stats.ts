import { z } from 'zod';

/** No.14 기본 통계의 원천 데이터 — 대화 로그(원문은 PII 마스킹 후 저장 전제, 개발명세서.md §5) */
export const ConversationLogSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  channelType: z.string(),
  /** 대화 세션 식별자(No.2 접속수 산정 근거, ADR-0001). 대화 처리 Phase에서 채워진다. */
  sessionId: z.string().optional(),
  userMessage: z.string(),
  botResponse: z.string(),
  matchedIntentId: z.string().uuid().optional(),
  isAnswered: z.boolean().default(true),
  createdAt: z.coerce.date(),
});
export type ConversationLog = z.infer<typeof ConversationLogSchema>;

/** No.2 대시보드 조회 요청(FR-2-5, FR-2-4). */
export const DashboardQuerySchema = z.object({
  chatbotId: z.string().uuid(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  topN: z.coerce.number().int().min(1).max(10).default(5),
});
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

/** 접속수 산정 기준(ADR-0001) — UI 카드 캡션 문구를 서버 상태에 맞춰 전환하는 데 사용한다. */
export const VisitCountBasis = z.enum(['SESSION', 'LOG_COUNT']);
export type VisitCountBasis = z.infer<typeof VisitCountBasis>;

/** No.2 대시보드 집계 결과 */
export const DashboardSummarySchema = z.object({
  chatbotId: z.string().uuid(),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  visitCount: z.number().int().nonnegative(),
  /** 기간 내 sessionId 보유 로그가 하나라도 있으면 'SESSION', 전혀 없으면 'LOG_COUNT'(ADR-0001). */
  visitCountBasis: VisitCountBasis,
  /** 조회 완료 배지에 사용되는 집계 건수(FR-2-12). */
  totalLogCount: z.number().int().nonnegative(),
  responseRate: z.number().min(0).max(1),
  noResponseRate: z.number().min(0).max(1),
  topQuestions: z.array(z.object({ question: z.string(), count: z.number().int().nonnegative() })),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

/** No.15 학습현황(관리자 보조 재학습) 큐 항목 */
export const UnansweredQuestionStatus = z.enum(['PENDING', 'RESOLVED']);
export type UnansweredQuestionStatus = z.infer<typeof UnansweredQuestionStatus>;

export const UnansweredQuestionSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  questionText: z.string().min(1),
  occurredCount: z.number().int().positive(),
  suggestedIntentName: z.string().optional(),
  status: UnansweredQuestionStatus.default('PENDING'),
  createdAt: z.coerce.date(),
});
export type UnansweredQuestion = z.infer<typeof UnansweredQuestionSchema>;

/** No.15 관리자가 의도명을 입력해 재학습 큐를 해소할 때의 요청 */
export const ResolveUnansweredQuestionSchema = z.object({
  intentName: z.string().min(1).max(100),
});
export type ResolveUnansweredQuestionDto = z.infer<typeof ResolveUnansweredQuestionSchema>;
