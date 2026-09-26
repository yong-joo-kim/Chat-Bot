import { z } from 'zod';
import { PaginationQuerySchema, SortOrder, csvEnumArray, queryBoolean } from './common';
import { DialogueNameSchema, ResourceRefSchema } from './dialogue';
import { OffsetDateTimeSchema } from './deploy-schedule';
import { ChannelType } from './channel';

/**
 * 설문관리(No.27) 도메인 스키마. `docs/02-spec/survey-management-설계.md` §4.3 근거.
 * 의존 방향: `survey.ts → common.ts · dialogue.ts(DialogueNameSchema·ResourceRefSchema) ·
 * deploy-schedule.ts(OffsetDateTimeSchema)`. `dialogue-engine.ts → survey.ts`(번들). 순환 없음.
 * 위젯은 이 파일을 import하지 않는다(ADR-0035 결정 2 — 위젯 변경 0).
 */

export const SURVEY_LIMITS = {
  perChatbotMax: 50,
  nameMax: 50,
  descriptionMax: 300,
  introMessageMax: 500,
  completionMessageMax: 500,
  cancelKeywordsMax: 10,
  cancelKeywordMax: 20,
  sessionTimeoutMinutesMin: 1,
  sessionTimeoutMinutesMax: 1440,
  sessionTimeoutMinutesDefault: 30,
  questionsMax: 20,
  questionPromptMax: 300,
  choicesMin: 2,
  choicesMax: 10,
  choiceLabelMax: 40,
  scaleLabelMax: 20,
  textMaxLengthMin: 1,
  textMaxLengthMax: 500,
  textMaxLengthDefault: 300,
  maxRetry: 2,
  completedSurveyIdsMax: 20,
  buttonsPerBlock: 5,
  buttonBlocksMax: 3,
  exportRowsMax: 10_000,
  listPageSizeDefault: 50,
  listPageSizeMax: 100,
  lowSampleThreshold: 30,
  periodMaxDays: 366,
} as const;

/** 설문 이름(FR-SV2-2) — `DialogueNameSchema`(1~100자)보다 좁은 1~50자. */
const SurveyNameSchema = z
  .string()
  .trim()
  .min(1, '이름을 입력해 주세요.')
  .max(SURVEY_LIMITS.nameMax, `이름은 최대 ${SURVEY_LIMITS.nameMax}자까지 입력할 수 있습니다.`)
  .refine((v) => !/[\n\r\t]/.test(v), { message: '이름에 줄바꿈이나 탭을 넣을 수 없습니다.' });

export const SurveyStatus = z.enum(['DRAFT', 'OPEN', 'CLOSED']);
export type SurveyStatus = z.infer<typeof SurveyStatus>;

export const SurveyQuestionType = z.enum(['SINGLE_CHOICE', 'MULTI_CHOICE', 'SCALE', 'TEXT']);
export type SurveyQuestionType = z.infer<typeof SurveyQuestionType>;

export const SurveyScaleKind = z.enum(['STAR_5', 'NPS_11']);
export type SurveyScaleKind = z.infer<typeof SurveyScaleKind>;

export const SurveyResponseStatus = z.enum(['EXPOSED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED']);
export type SurveyResponseStatus = z.infer<typeof SurveyResponseStatus>;

export const SurveyEndReason = z.enum(['CANCELLED', 'RETRY_EXCEEDED', 'SWITCHED', 'TIMEOUT', 'DEFINITION_CHANGED', 'CLOSED']);
export type SurveyEndReason = z.infer<typeof SurveyEndReason>;

export const SurveySkipReason = z.enum(['NOT_FOUND', 'NOT_OPEN', 'OUT_OF_PERIOD', 'ALREADY_RESPONDED', 'EMPTY']);
export type SurveySkipReason = z.infer<typeof SurveySkipReason>;

/* ------------------------------------------------------------------------------------------------
 * 문항 — 판별 유니온(type)
 * ---------------------------------------------------------------------------------------------- */

export const SurveyChoiceSchema = z.object({
  key: z.string().uuid(),
  label: z.string().trim().min(1).max(SURVEY_LIMITS.choiceLabelMax),
});
export type SurveyChoice = z.infer<typeof SurveyChoiceSchema>;

const QuestionCommon = {
  key: z.string().uuid(),
  prompt: z.string().trim().min(1).max(SURVEY_LIMITS.questionPromptMax),
  required: z.boolean().default(true),
};

function assertChoiceUniqueness(choices: SurveyChoice[], ctx: z.RefinementCtx): void {
  const labelSeen = new Set<string>();
  const keySeen = new Set<string>();
  choices.forEach((c, i) => {
    const normalized = c.label.trim().toLowerCase();
    if (labelSeen.has(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '선택지 라벨이 중복됩니다.', path: ['choices', i, 'label'] });
    }
    labelSeen.add(normalized);
    if (keySeen.has(c.key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '선택지 key가 중복됩니다.', path: ['choices', i, 'key'] });
    }
    keySeen.add(c.key);
  });
}

const SurveyQuestionUnion = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SINGLE_CHOICE'), ...QuestionCommon, choices: z.array(SurveyChoiceSchema).min(SURVEY_LIMITS.choicesMin).max(SURVEY_LIMITS.choicesMax) }),
  z.object({
    type: z.literal('MULTI_CHOICE'),
    ...QuestionCommon,
    choices: z.array(SurveyChoiceSchema).min(SURVEY_LIMITS.choicesMin).max(SURVEY_LIMITS.choicesMax),
    minSelect: z.number().int().min(1),
    maxSelect: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('SCALE'),
    ...QuestionCommon,
    scale: SurveyScaleKind,
    lowLabel: z.string().trim().max(SURVEY_LIMITS.scaleLabelMax).optional(),
    highLabel: z.string().trim().max(SURVEY_LIMITS.scaleLabelMax).optional(),
  }),
  z.object({
    type: z.literal('TEXT'),
    ...QuestionCommon,
    maxLength: z.number().int().min(SURVEY_LIMITS.textMaxLengthMin).max(SURVEY_LIMITS.textMaxLengthMax).default(SURVEY_LIMITS.textMaxLengthDefault),
  }),
]);

export const SurveyQuestionSchema = SurveyQuestionUnion.superRefine((v, ctx) => {
  if (v.type === 'SINGLE_CHOICE' || v.type === 'MULTI_CHOICE') {
    assertChoiceUniqueness(v.choices, ctx);
  }
  if (v.type === 'MULTI_CHOICE') {
    if (v.minSelect > v.maxSelect) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '최소 선택 수는 최대 선택 수보다 클 수 없습니다.', path: ['minSelect'] });
    }
    if (v.maxSelect > v.choices.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '최대 선택 수가 선택지 수보다 많습니다.', path: ['maxSelect'] });
    }
  }
});
export type SurveyQuestion = z.infer<typeof SurveyQuestionUnion>;

/** 저장 요청용 — 문항·선택지 `key`는 선택(없으면 서버 발급). 기존 key를 보내지 않으면 삭제+신규로 판정된다. */
const QuestionCommonInput = {
  key: z.string().uuid().optional(),
  prompt: z.string().trim().min(1).max(SURVEY_LIMITS.questionPromptMax),
  required: z.boolean().default(true),
};
const SurveyChoiceInputSchema = z.object({
  key: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(SURVEY_LIMITS.choiceLabelMax),
});
export const SurveyQuestionInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SINGLE_CHOICE'), ...QuestionCommonInput, choices: z.array(SurveyChoiceInputSchema).min(SURVEY_LIMITS.choicesMin).max(SURVEY_LIMITS.choicesMax) }),
  z.object({
    type: z.literal('MULTI_CHOICE'),
    ...QuestionCommonInput,
    choices: z.array(SurveyChoiceInputSchema).min(SURVEY_LIMITS.choicesMin).max(SURVEY_LIMITS.choicesMax),
    minSelect: z.number().int().min(1),
    maxSelect: z.number().int().min(1),
  }),
  z.object({
    type: z.literal('SCALE'),
    ...QuestionCommonInput,
    scale: SurveyScaleKind,
    lowLabel: z.string().trim().max(SURVEY_LIMITS.scaleLabelMax).optional(),
    highLabel: z.string().trim().max(SURVEY_LIMITS.scaleLabelMax).optional(),
  }),
  z.object({
    type: z.literal('TEXT'),
    ...QuestionCommonInput,
    maxLength: z.number().int().min(SURVEY_LIMITS.textMaxLengthMin).max(SURVEY_LIMITS.textMaxLengthMax).default(SURVEY_LIMITS.textMaxLengthDefault),
  }),
]);
export type SurveyQuestionInput = z.infer<typeof SurveyQuestionInputSchema>;

/* ------------------------------------------------------------------------------------------------
 * 설문 엔티티(번들에 실리는 모양)
 * ---------------------------------------------------------------------------------------------- */

export const SurveySchema = z
  .object({
    id: z.string().uuid(),
    chatbotId: z.string().uuid(),
    name: DialogueNameSchema,
    description: z.string().max(SURVEY_LIMITS.descriptionMax).optional(),
    status: SurveyStatus,
    activeFrom: z.coerce.date().optional(),
    activeTo: z.coerce.date().optional(),
    introMessage: z.string().max(SURVEY_LIMITS.introMessageMax).optional(),
    completionMessage: z.string().min(1).max(SURVEY_LIMITS.completionMessageMax),
    cancelKeywords: z.array(z.string().trim().min(1).max(SURVEY_LIMITS.cancelKeywordMax)).max(SURVEY_LIMITS.cancelKeywordsMax),
    sessionTimeoutMinutes: z.number().int().min(SURVEY_LIMITS.sessionTimeoutMinutesMin).max(SURVEY_LIMITS.sessionTimeoutMinutesMax),
    questions: z.array(SurveyQuestionSchema).max(SURVEY_LIMITS.questionsMax),
    structureVersion: z.number().int().min(1),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.questions.forEach((q, i) => {
      if (seen.has(q.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '문항 key가 중복됩니다.', path: ['questions', i, 'key'] });
      seen.add(q.key);
    });
  });
export type Survey = z.infer<typeof SurveySchema>;

/* ------------------------------------------------------------------------------------------------
 * 생성 · 수정
 * ---------------------------------------------------------------------------------------------- */

export const CreateSurveySchema = z
  .object({
    name: SurveyNameSchema,
    description: z.string().max(SURVEY_LIMITS.descriptionMax).optional(),
    activeFrom: OffsetDateTimeSchema.optional(),
    activeTo: OffsetDateTimeSchema.optional(),
    introMessage: z.string().max(SURVEY_LIMITS.introMessageMax).optional(),
    completionMessage: z.string().min(1).max(SURVEY_LIMITS.completionMessageMax).default('설문에 참여해 주셔서 감사합니다.'),
    cancelKeywords: z.array(z.string().trim().min(1).max(SURVEY_LIMITS.cancelKeywordMax)).max(SURVEY_LIMITS.cancelKeywordsMax).default(['그만', '취소', '설문 종료']),
    sessionTimeoutMinutes: z.number().int().min(SURVEY_LIMITS.sessionTimeoutMinutesMin).max(SURVEY_LIMITS.sessionTimeoutMinutesMax).default(SURVEY_LIMITS.sessionTimeoutMinutesDefault),
    questions: z.array(SurveyQuestionInputSchema).max(SURVEY_LIMITS.questionsMax).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.activeFrom && v.activeTo && v.activeFrom.getTime() >= v.activeTo.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '시작 시각은 종료 시각보다 앞서야 합니다.', path: ['activeFrom'] });
    }
  });
export type CreateSurveyDto = z.infer<typeof CreateSurveySchema>;

export const UpdateSurveySchema = z
  .object({
    name: SurveyNameSchema.optional(),
    description: z.string().max(SURVEY_LIMITS.descriptionMax).nullable().optional(),
    activeFrom: OffsetDateTimeSchema.nullable().optional(),
    activeTo: OffsetDateTimeSchema.nullable().optional(),
    introMessage: z.string().max(SURVEY_LIMITS.introMessageMax).nullable().optional(),
    completionMessage: z.string().min(1).max(SURVEY_LIMITS.completionMessageMax).optional(),
    cancelKeywords: z.array(z.string().trim().min(1).max(SURVEY_LIMITS.cancelKeywordMax)).max(SURVEY_LIMITS.cancelKeywordsMax).optional(),
    sessionTimeoutMinutes: z.number().int().min(SURVEY_LIMITS.sessionTimeoutMinutesMin).max(SURVEY_LIMITS.sessionTimeoutMinutesMax).optional(),
    questions: z.array(SurveyQuestionInputSchema).max(SURVEY_LIMITS.questionsMax).optional(),
    status: SurveyStatus.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.activeFrom && v.activeTo && v.activeFrom.getTime() >= v.activeTo.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '시작 시각은 종료 시각보다 앞서야 합니다.', path: ['activeFrom'] });
    }
  });
export type UpdateSurveyDto = z.infer<typeof UpdateSurveySchema>;

export const CopySurveySchema = z.object({ name: DialogueNameSchema.optional() });
export type CopySurveyDto = z.infer<typeof CopySurveySchema>;

/* ------------------------------------------------------------------------------------------------
 * 응답 DTO
 * ---------------------------------------------------------------------------------------------- */

export const SurveyDetailSchema = SurveySchema.and(
  z.object({
    locked: z.boolean(),
    responseCount: z.number().int().nonnegative(),
    referencingNodeCount: z.number().int().nonnegative(),
    referencingNodes: z.array(ResourceRefSchema).max(5),
  }),
);
export type SurveyDetail = z.infer<typeof SurveyDetailSchema>;

export const SurveyListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: SurveyStatus,
  activeFrom: z.coerce.date().optional(),
  activeTo: z.coerce.date().optional(),
  questionCount: z.number().int().nonnegative(),
  structureVersion: z.number().int().min(1),
  locked: z.boolean(),
  referencingNodeCount: z.number().int().nonnegative(),
  last30d: z.object({ exposed: z.number().int().nonnegative(), completed: z.number().int().nonnegative() }),
  updatedAt: z.coerce.date(),
});
export type SurveyListItem = z.infer<typeof SurveyListItemSchema>;

export const SurveyListQuerySchema = z.object({
  status: SurveyStatus.optional(),
  q: z.string().trim().max(200).optional(),
});
export type SurveyListQuery = z.infer<typeof SurveyListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * 통계 · 목록 · CSV 쿼리
 * ---------------------------------------------------------------------------------------------- */

export const SurveyStatsGranularity = z.enum(['day', 'week', 'month']);
export type SurveyStatsGranularity = z.infer<typeof SurveyStatsGranularity>;

const KstDayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식은 YYYY-MM-DD입니다.');

export const SurveyStatsQuerySchema = z.object({
  from: KstDayString,
  to: KstDayString,
  granularity: SurveyStatsGranularity.default('day'),
  channel: ChannelType.optional(),
  includeDuplicates: queryBoolean().transform((v) => v ?? false),
});
export type SurveyStatsQuery = z.infer<typeof SurveyStatsQuerySchema>;

export const SurveyStatsSummarySchema = z.object({
  surveyId: z.string().uuid(),
  period: z.object({ from: z.string(), to: z.string(), granularity: SurveyStatsGranularity }),
  generatedAt: z.coerce.date(),
  timezone: z.literal('Asia/Seoul'),
  filters: z.object({ channel: ChannelType.optional() }),
  totals: z.object({
    exposed: z.number().int().nonnegative(),
    started: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    inProgressStarted: z.number().int().nonnegative(),
    droppedAfterStart: z.number().int().nonnegative(),
    droppedBeforeStart: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    participationRate: z.number().nullable(),
    completionRate: z.number().nullable(),
    dropoutRate: z.number().nullable(),
  }),
  buckets: z.array(z.object({ key: z.string(), label: z.string(), exposed: z.number().int().nonnegative(), started: z.number().int().nonnegative(), completed: z.number().int().nonnegative() })),
  lowSample: z.boolean(),
});
export type SurveyStatsSummary = z.infer<typeof SurveyStatsSummarySchema>;

export const SurveyQuestionStatKindSchema = z.enum(['CHOICE', 'SCALE', 'TEXT']);

export const SurveyQuestionStatItemSchema = z.object({
  questionKey: z.string(),
  prompt: z.string(),
  type: SurveyQuestionType,
  kind: SurveyQuestionStatKindSchema,
  reached: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  choiceDistribution: z.array(z.object({ choiceKey: z.string(), label: z.string(), count: z.number().int().nonnegative(), ratio: z.number().nullable() })).optional(),
  multiSelectCaption: z.boolean().optional(),
  scaleDistribution: z.array(z.object({ value: z.number().int(), count: z.number().int().nonnegative() })).optional(),
  average: z.number().nullable().optional(),
  nps: z.number().nullable().optional(),
  lowSample: z.boolean(),
});
export type SurveyQuestionStatItem = z.infer<typeof SurveyQuestionStatItemSchema>;

export const SurveyQuestionStatsSchema = z.object({
  surveyId: z.string().uuid(),
  period: z.object({ from: z.string(), to: z.string() }),
  generatedAt: z.coerce.date(),
  questions: z.array(SurveyQuestionStatItemSchema),
});
export type SurveyQuestionStats = z.infer<typeof SurveyQuestionStatsSchema>;

export const SurveyResponseDisplayStatus = z.enum(['COMPLETED', 'IN_PROGRESS', 'ABANDONED', 'IDLE']);
export type SurveyResponseDisplayStatus = z.infer<typeof SurveyResponseDisplayStatus>;

export const SurveyResponseListQuerySchema = PaginationQuerySchema.extend({
  from: KstDayString,
  to: KstDayString,
  status: csvEnumArray(z.enum(['COMPLETED', 'IN_PROGRESS', 'ABANDONED', 'DUPLICATE'])),
  channel: ChannelType.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(SURVEY_LIMITS.listPageSizeMax).default(SURVEY_LIMITS.listPageSizeDefault),
  sort: SortOrder.optional(),
});
export type SurveyResponseListQuery = z.infer<typeof SurveyResponseListQuerySchema>;

export const SurveyResponseAnswerViewSchema = z.object({
  questionKey: z.string(),
  kind: z.enum(['ANSWERED', 'SKIPPED']),
  display: z.string(),
  /** [신규 No.45] 보존기간 경과로 소거된 자유 텍스트 답일 때만(true). */
  purged: z.literal(true).optional(),
});

export const SurveyResponseListItemSchema = z.object({
  responseNo: z.string(),
  exposedAt: z.coerce.date(),
  displayStatus: SurveyResponseDisplayStatus,
  endReason: SurveyEndReason.optional(),
  started: z.boolean(),
  duplicate: z.boolean(),
  channelType: ChannelType,
  completedAt: z.coerce.date().optional(),
  missingRequiredCount: z.number().int().nonnegative(),
  answers: z.array(SurveyResponseAnswerViewSchema),
});
export type SurveyResponseListItem = z.infer<typeof SurveyResponseListItemSchema>;

export const SurveyTextAnswerListQuerySchema = z.object({
  questionKey: z.string().uuid(),
  from: KstDayString,
  to: KstDayString,
  channel: ChannelType.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(SURVEY_LIMITS.listPageSizeMax).default(SURVEY_LIMITS.listPageSizeDefault),
});
export type SurveyTextAnswerListQuery = z.infer<typeof SurveyTextAnswerListQuerySchema>;

export const SurveyTextAnswerItemSchema = z.object({
  responseNo: z.string(),
  answeredAt: z.coerce.date(),
  text: z.string(),
  /** [신규 No.45] 보존기간 경과로 소거된 행일 때만(true). */
  purged: z.literal(true).optional(),
});
export type SurveyTextAnswerItem = z.infer<typeof SurveyTextAnswerItemSchema>;

export const SurveyExportKind = z.enum(['RESPONSES', 'SUMMARY']);
export type SurveyExportKind = z.infer<typeof SurveyExportKind>;

export const SurveyExportQuerySchema = z.object({
  kind: SurveyExportKind,
  from: KstDayString,
  to: KstDayString,
  channel: ChannelType.optional(),
  includeDuplicates: queryBoolean().transform((v) => v ?? false),
});
export type SurveyExportQuery = z.infer<typeof SurveyExportQuerySchema>;
