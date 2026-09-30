import { z } from 'zod';
import { BannedWordMatchType } from './security';
import { PaginationQuerySchema, paginated } from './common';

/**
 * [신규 No.36] AI 거버넌스·가드레일(안전 가드레일) — `docs/02-spec/ai-guardrails-설계.md` §4·§7·§8·§13.2,
 * ADR-0048. 규칙 기반(표현 목록) 입구·출구 검사 + RAG 답 개인정보 형식 가림 설정 + 현황·이벤트 계약.
 * 모델·임베딩 호출 0 — 이 파일은 zod 스키마·상수만 둔다.
 */

export const GuardrailCategory = z.enum([
  'CRISIS_SELF_HARM',
  'MEDICAL_ADVICE',
  'LEGAL_ADVICE',
  'FINANCIAL_ADVICE',
  'PERSONAL_INFO_REQUEST',
  'PROMPT_INJECTION',
  'DISCRIMINATION_HATE',
  'OTHER',
]);
export type GuardrailCategory = z.infer<typeof GuardrailCategory>;

export const GUARDRAIL_CATEGORY_LABELS: Record<GuardrailCategory, string> = {
  CRISIS_SELF_HARM: '위기·자해',
  MEDICAL_ADVICE: '의료 조언',
  LEGAL_ADVICE: '법률 조언',
  FINANCIAL_ADVICE: '투자·재무 조언',
  PERSONAL_INFO_REQUEST: '개인정보 요구',
  PROMPT_INJECTION: '지시 무시 시도',
  DISCRIMINATION_HATE: '차별·혐오',
  OTHER: '기타',
};

export const GuardrailAppliesTo = z.enum(['INBOUND', 'OUTBOUND', 'BOTH']);
export type GuardrailAppliesTo = z.infer<typeof GuardrailAppliesTo>;

export const GUARDRAIL_APPLIES_TO_LABELS: Record<GuardrailAppliesTo, string> = {
  INBOUND: '사용자 질문',
  OUTBOUND: 'AI 답변',
  BOTH: '둘 다',
};

export const GuardrailAction = z.enum(['MONITOR', 'REPLACE', 'NO_RAG']);
export type GuardrailAction = z.infer<typeof GuardrailAction>;

export const GUARDRAIL_ACTION_LABELS: Record<GuardrailAction, string> = {
  MONITOR: '기록만',
  REPLACE: '안전 문구로 대체',
  NO_RAG: 'AI로 보내지 않음',
};

export const GuardrailStage = z.enum(['INBOUND', 'OUTBOUND']);
export type GuardrailStage = z.infer<typeof GuardrailStage>;

/** 출구 개인정보 가림 종류(`pii-mask`의 `PiiKind` 소문자와 1:1 — 대응은 API `exit-pii.ts` 1곳). */
export const GuardrailPiiKind = z.enum(['RRN', 'CARD', 'ACCOUNT', 'PHONE', 'EMAIL']);
export type GuardrailPiiKind = z.infer<typeof GuardrailPiiKind>;

export const GUARDRAIL_PII_KIND_LABELS: Record<GuardrailPiiKind, string> = {
  RRN: '주민등록번호',
  CARD: '카드번호',
  ACCOUNT: '계좌번호',
  PHONE: '전화번호',
  EMAIL: '이메일',
};

/** 기본 가림 종류 — 행이 없는 챗봇의 값(P-6). */
export const GUARDRAIL_PII_DEFAULT_KINDS: readonly GuardrailPiiKind[] = ['RRN', 'CARD'];

export const GUARDRAIL_LIMITS = {
  nameMax: 50,
  expressionMax: 50,
  expressionMinNormalized: 2,
  expressionsPerRuleMax: 100,
  replacementMax: 300,
  replacementMaxLines: 5,
  testTextMax: 2000,
  overviewMaxRangeDays: 90,
  eventsPageMax: 100,
  eventsPageDefault: 50,
} as const;

/* ── 규칙 ── */

/** `REPLACE` ⇒ 대체 문구 필수 · `NO_RAG` ⇒ 적용 위치가 `INBOUND`일 때만(AC-AG2-2·4). */
const GuardrailRuleBodyObject = z.object({
  name: z.string().trim().min(1).max(GUARDRAIL_LIMITS.nameMax),
  category: GuardrailCategory,
  expressions: z.array(z.string().trim().min(1).max(GUARDRAIL_LIMITS.expressionMax)).min(1).max(GUARDRAIL_LIMITS.expressionsPerRuleMax),
  matchType: BannedWordMatchType.default('CONTAINS'),
  appliesTo: GuardrailAppliesTo,
  action: GuardrailAction.default('MONITOR'),
  replacementText: z.string().trim().min(1).max(GUARDRAIL_LIMITS.replacementMax).nullable().optional(),
  enabled: z.boolean().default(true),
});

export const GuardrailRuleBodySchema = GuardrailRuleBodyObject.superRefine((v, ctx) => {
  if (v.action === 'REPLACE' && !v.replacementText) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['replacementText'], message: '안전 문구로 대체하려면 대체 문구를 입력해 주세요.' });
  }
  if (v.action === 'NO_RAG' && v.appliesTo !== 'INBOUND') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['action'], message: "'AI로 보내지 않음'은 적용 위치가 '사용자 질문'일 때만 고를 수 있습니다." });
  }
});
export type GuardrailRuleBody = z.infer<typeof GuardrailRuleBodySchema>;

export const CreateGuardrailRuleSchema = GuardrailRuleBodySchema;
export type CreateGuardrailRuleDto = z.infer<typeof CreateGuardrailRuleSchema>;
/** PUT은 전체 교체 — 생성과 같은 본문. */
export const UpdateGuardrailRuleSchema = GuardrailRuleBodySchema;
export type UpdateGuardrailRuleDto = z.infer<typeof UpdateGuardrailRuleSchema>;

export const GuardrailRuleSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string(),
  category: GuardrailCategory,
  expressions: z.array(z.string()),
  matchType: BannedWordMatchType,
  appliesTo: GuardrailAppliesTo,
  action: GuardrailAction,
  replacementText: z.string().nullable(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  expressionCount: z.number().int().nonnegative(),
  /** 현재 금지어 사전에 대체 문구가 걸리는지(저장 후 금지어가 추가된 경우 경고 — EX-AG-9). */
  replacementBannedHit: z.boolean(),
  recentHits7d: z.number().int().nonnegative(),
  updatedByEmail: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type GuardrailRule = z.infer<typeof GuardrailRuleSchema>;

export const GuardrailRuleListResponseSchema = z.object({
  items: z.array(GuardrailRuleSchema),
  meta: z.object({
    /** 챗봇이 외부 RAG를 쓰는지(꺼져 있으면 출구 규칙은 적용될 일이 없다 — EX-AG-16). */
    ragActive: z.boolean(),
    /** 서버 긴급 스위치 `GUARDRAILS_ENABLED`. */
    serverEnabled: z.boolean(),
    limits: z.object({
      maxRules: z.number().int(),
      maxExpressions: z.number().int(),
      usedRules: z.number().int().nonnegative(),
      usedExpressions: z.number().int().nonnegative(),
    }),
  }),
});
export type GuardrailRuleListResponse = z.infer<typeof GuardrailRuleListResponseSchema>;

/** 저장 응답 — 중복 제거된 표현 수(FR-AG1 · 4.2 ②). */
export const GuardrailRuleSaveResponseSchema = GuardrailRuleSchema.extend({
  removedDuplicateExpressions: z.number().int().nonnegative().optional(),
});
export type GuardrailRuleSaveResponse = z.infer<typeof GuardrailRuleSaveResponseSchema>;

export const MoveGuardrailRuleSchema = z.object({ direction: z.enum(['UP', 'DOWN']) });
export type MoveGuardrailRuleDto = z.infer<typeof MoveGuardrailRuleSchema>;

/* ── 개인정보 가림 설정 ── */

export const GuardrailPiiExitSettingsSchema = z.object({
  kinds: z.array(GuardrailPiiKind).max(5),
  preserveDates: z.boolean(),
});
export type GuardrailPiiExitSettings = z.infer<typeof GuardrailPiiExitSettingsSchema>;

export const UpdateGuardrailSettingsSchema = z.object({ piiExit: GuardrailPiiExitSettingsSchema });
export type UpdateGuardrailSettingsDto = z.infer<typeof UpdateGuardrailSettingsSchema>;

export const GuardrailSettingsResponseSchema = z.object({
  piiExit: GuardrailPiiExitSettingsSchema,
  /** 저장된 행이 없어 기본값을 보여 주는 중이면 true. */
  isDefault: z.boolean(),
  /** 거버넌스 모드 ON일 때 끌 수 없는 종류(`RRN`·`CARD`), OFF면 빈 배열. */
  governanceFloor: z.array(GuardrailPiiKind),
  /** [선택 필드 — ui-spec A-3] 서버 긴급 스위치 표시(셸이 규칙 목록 없이도 배너를 띄울 수 있게). */
  serverEnabled: z.boolean().optional(),
});
export type GuardrailSettingsResponse = z.infer<typeof GuardrailSettingsResponseSchema>;

/* ── 문장으로 시험하기(저장 0 · 감사 0 · 이벤트 0) ── */

export const GuardrailTestRequestSchema = z.object({
  text: z.string().min(1).max(GUARDRAIL_LIMITS.testTextMax),
  stage: GuardrailStage,
  /** 편집 중 규칙을 저장 전 시험 — id가 없으면 "저장된 규칙 + 이 규칙(맨 뒤)". */
  draftRule: GuardrailRuleBodySchema.optional(),
  /** 있으면 저장본 대신 `draftRule`을 그 규칙 자리에 대입한다. */
  draftRuleId: z.string().uuid().optional(),
  draftPiiExit: GuardrailPiiExitSettingsSchema.optional(),
});
export type GuardrailTestRequest = z.infer<typeof GuardrailTestRequestSchema>;

export const GuardrailTestResultKind = z.enum(['PASS', 'MONITOR', 'NO_RAG', 'REPLACE', 'MASKED', 'FALLBACK']);
export type GuardrailTestResultKind = z.infer<typeof GuardrailTestResultKind>;

export const GuardrailTestResponseSchema = z.object({
  stage: GuardrailStage,
  result: GuardrailTestResultKind,
  hits: z.array(
    z.object({
      ruleId: z.string().uuid().nullable(),
      ruleName: z.string(),
      category: GuardrailCategory,
      action: GuardrailAction,
      decisive: z.boolean(),
      matchedExpressions: z.array(z.string()),
    }),
  ),
  /** 대체 문구 · 가린 텍스트(출구 금지어 적용 후) · PASS면 입력 그대로 · FALLBACK이면 빈 문자열일 수 있다. */
  resultText: z.string(),
  piiCounts: z.record(GuardrailPiiKind, z.number().int()),
});
export type GuardrailTestResponse = z.infer<typeof GuardrailTestResponseSchema>;

/* ── 현황 · 이벤트 ── */

export const GuardrailOverviewQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type GuardrailOverviewQuery = z.infer<typeof GuardrailOverviewQuerySchema>;

export const GuardrailOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  serverEnabled: z.boolean(),
  totals: z.object({
    /** 규칙이 걸린 턴 수(턴당 결정 규칙 1건 기준). */
    inboundHits: z.number().int().nonnegative(),
    outboundHits: z.number().int().nonnegative(),
    replaced: z.number().int().nonnegative(),
    noRag: z.number().int().nonnegative(),
    monitored: z.number().int().nonnegative(),
    /** 개인정보가 가려진 AI 답 수(턴 기준). */
    maskedAnswers: z.number().int().nonnegative(),
    /** 판정 오류·가림 확인 불가로 폴백된 답 수(턴 기준). */
    errorFallbacks: z.number().int().nonnegative(),
  }),
  rules: z.array(
    z.object({
      ruleId: z.string(),
      ruleName: z.string(),
      category: GuardrailCategory.nullable(),
      /** 규칙이 삭제됐으면 null. */
      currentAction: GuardrailAction.nullable(),
      currentEnabled: z.boolean().nullable(),
      deleted: z.boolean(),
      inboundHits: z.number().int().nonnegative(),
      outboundHits: z.number().int().nonnegative(),
      changedHits: z.number().int().nonnegative(),
    }),
  ),
  pii: z.array(z.object({ kind: GuardrailPiiKind, answers: z.number().int().nonnegative(), count: z.number().int().nonnegative() })),
  rag: z.object({
    delivered: z.number().int().nonnegative(),
    replaced: z.number().int().nonnegative(),
    masked: z.number().int().nonnegative(),
    fallbackOnError: z.number().int().nonnegative(),
    /** 분모 = delivered + replaced + fallbackOnError, 0이면 null. */
    replacedRatio: z.number().min(0).max(1).nullable(),
  }),
  /** 직전 버전 단독 롤백(2인 승인 예외) 알림. */
  alerts: z.array(
    z.object({
      switchLogId: z.string().uuid(),
      at: z.coerce.date(),
      actorEmail: z.string().nullable(),
      fromVersionNo: z.number().int().nullable(),
      toVersionNo: z.number().int().nullable(),
    }),
  ),
  hitl: z.object({ envModeOn: z.boolean(), approvalRequired: z.boolean() }),
});
export type GuardrailOverview = z.infer<typeof GuardrailOverviewSchema>;

export const GuardrailEventKind = z.enum(['RULE', 'PII', 'ERROR']);
export type GuardrailEventKind = z.infer<typeof GuardrailEventKind>;
export const GuardrailAppliedAction = z.enum(['MONITOR', 'REPLACE', 'NO_RAG', 'MASK', 'FALLBACK']);
export type GuardrailAppliedAction = z.infer<typeof GuardrailAppliedAction>;
export const GuardrailEffect = z.enum(['CHANGED', 'NONE']);
export type GuardrailEffect = z.infer<typeof GuardrailEffect>;

export const GuardrailEventListQuerySchema = PaginationQuerySchema.extend({
  from: z.coerce.date(),
  to: z.coerce.date(),
  ruleId: z.string().optional(),
  stage: GuardrailStage.optional(),
  appliedAction: GuardrailAppliedAction.optional(),
  pageSize: z.coerce.number().int().min(1).max(GUARDRAIL_LIMITS.eventsPageMax).default(GUARDRAIL_LIMITS.eventsPageDefault),
});
export type GuardrailEventListQuery = z.infer<typeof GuardrailEventListQuerySchema>;

export const GuardrailEventItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
  messageId: z.string(),
  stage: GuardrailStage,
  kind: GuardrailEventKind,
  ruleId: z.string().nullable(),
  ruleName: z.string().nullable(),
  category: GuardrailCategory.nullable(),
  ruleAction: GuardrailAction.nullable(),
  appliedAction: GuardrailAppliedAction,
  decisive: z.boolean(),
  effect: GuardrailEffect,
  piiKind: GuardrailPiiKind.nullable(),
  piiCount: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  /** 대화 기록 마스킹본(저장값 그대로). 기록이 없으면 null · 보존기간 파기면 `textPurged=true`·본문 빈 값. */
  conversation: z
    .object({
      userMessage: z.string(),
      botResponse: z.string(),
      textPurged: z.boolean(),
    })
    .nullable(),
});
export type GuardrailEventItem = z.infer<typeof GuardrailEventItemSchema>;

export const GuardrailEventListResponseSchema = paginated(GuardrailEventItemSchema);
export type GuardrailEventListResponse = z.infer<typeof GuardrailEventListResponseSchema>;

/* ── 시뮬레이터 표시(설계서 §9) ── */

export const GuardrailInboundViewSchema = z.object({
  action: z.enum(['MONITOR', 'NO_RAG', 'REPLACE']),
  ruleNames: z.array(z.string()),
  replacementText: z.string().optional(),
});
export type GuardrailInboundView = z.infer<typeof GuardrailInboundViewSchema>;

export const RagPreviewSchema = z.object({
  outcome: z.enum(['PASS', 'MONITOR', 'MASKED', 'REPLACED', 'FALLBACK']),
  /** 운영이면 사용자에게 나갈 텍스트(대체 문구·폴백 문구·가린 답 — 출구 금지어 적용 후). */
  finalText: z.string(),
  /** REPLACED·FALLBACK일 때 원답을 저장 마스킹한 본(원문 개인정보 비노출). */
  originalMasked: z.string().optional(),
  ruleNames: z.array(z.string()),
  piiCounts: z.record(GuardrailPiiKind, z.number().int()),
});
export type RagPreview = z.infer<typeof RagPreviewSchema>;

/* ── 데이터 지도 선택 키(설계서 §8.6) ── */

export const GovernanceGuardrailsMapSchema = z.object({
  chatbotsWithRules: z.number().int().nonnegative(),
  rules: z.number().int().nonnegative(),
  enabledRules: z.number().int().nonnegative(),
  events: z.number().int().nonnegative(),
  eventsStoreText: z.literal(false),
  exits: z.array(z.never()).length(0),
  piiExitDefaultKinds: z.tuple([z.literal('RRN'), z.literal('CARD')]),
  piiExitCustomizedChatbots: z.number().int().nonnegative(),
  approvalPolicyChatbots: z.number().int().nonnegative(),
  serverEnabled: z.boolean(),
});
export type GovernanceGuardrailsMap = z.infer<typeof GovernanceGuardrailsMapSchema>;
