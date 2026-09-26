import { z } from 'zod';
import { PaginationQuerySchema, SortOrder, SafeUrlSchema, csvEnumArray, queryBoolean, TOPIC_FILTER_COMMON } from './common';
import { parseResponsePath } from './api-mapping';

/**
 * [신규 No.22] 목록 쿼리 `topicIds` 공통 파서 — 콤마 구분, 원소 = uuid | `'common'`, 최대 51개
 * (토픽 상한 50 + 공통 1). 없는 토픽 id는 서비스가 매칭 0으로 처리한다(오류 아님, EX-TP-24).
 */
export function topicIdsFilter() {
  return z.preprocess((val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      return val
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return val;
  }, z.array(z.union([z.string().uuid(), z.literal(TOPIC_FILTER_COMMON)])).max(51).optional());
}

/**
 * 대화 설계(빌더) No.5~9 도메인 스키마.
 * `docs/02-spec/dialogue-design-설계.md` §4.2/§4.3, 요구사항 `docs/requirements/dialogue-design.md` §5.3 근거.
 */

/** 이름류 공통 규약(FR-6-3, FR-0-13) — 1~100자, 개행/탭 금지. trim은 저장 시 서버가 수행한다. */
export const DialogueNameSchema = z
  .string()
  .trim()
  .min(1, '이름을 입력해 주세요.')
  .max(100, '이름은 최대 100자까지 입력할 수 있습니다.')
  .refine((v) => !/[\n\r\t]/.test(v), { message: '이름에 줄바꿈이나 탭을 넣을 수 없습니다.' });

/** 409 `details`와 UI "바로가기"가 함께 쓰는 최소 참조 표현(FR-0-10). */
export const ResourceRefSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type ResourceRef = z.infer<typeof ResourceRefSchema>;

const ListSortField = z.enum(['name', 'createdAt', 'updatedAt']);

/* ------------------------------------------------------------------------------------------------
 * (a) 의도 (Intent) — FR-6-1~13
 * ---------------------------------------------------------------------------------------------- */

export const IntentExampleSchema = z
  .string()
  .trim()
  .min(1, '예문을 입력해 주세요.')
  .max(200, '예문은 최대 200자까지 입력할 수 있습니다.')
  .refine((v) => !/[\n\r\t]/.test(v), { message: '예문에 줄바꿈이나 탭을 넣을 수 없습니다.' });

export const IntentSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  examples: z.array(IntentExampleSchema).max(500).default([]),
  /** [신규 No.22] 값 없음 = 공통(항상 활성). */
  topicId: z.string().uuid().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Intent = z.infer<typeof IntentSchema>;

export const CreateIntentSchema = z.object({
  name: DialogueNameSchema,
  description: z.string().max(300).optional(),
  examples: z.array(IntentExampleSchema).max(500).optional(),
  /** [신규 No.22] 없거나 null = 공통. */
  topicId: z.string().uuid().nullable().optional(),
});
export type CreateIntentDto = z.infer<typeof CreateIntentSchema>;

export const UpdateIntentSchema = z.object({
  name: DialogueNameSchema.optional(),
  description: z.string().max(300).nullable().optional(),
  examples: z.array(IntentExampleSchema).max(500).optional(),
  /** [신규 No.22] null = 공통으로. 부분 수정 시맨틱(값이 없으면 불변). */
  topicId: z.string().uuid().nullable().optional(),
});
export type UpdateIntentDto = z.infer<typeof UpdateIntentSchema>;

export const IntentListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  exampleCount: z.number().int().nonnegative(),
  linkedNodeCount: z.number().int().nonnegative(),
  /** [신규 No.22] 목록 행은 항상 키가 존재한다 — null = 공통. */
  topicId: z.string().uuid().nullable(),
  updatedAt: z.coerce.date(),
});
export type IntentListItem = z.infer<typeof IntentListItemSchema>;

export const IntentDetailSchema = IntentSchema.extend({
  linkedNodes: z.array(ResourceRefSchema).default([]),
});
export type IntentDetail = z.infer<typeof IntentDetailSchema>;

export const IntentExampleMutationSchema = z.object({
  add: z.array(IntentExampleSchema).optional(),
  remove: z.array(z.string()).optional(),
});
export type IntentExampleMutationDto = z.infer<typeof IntentExampleMutationSchema>;

export const ExampleConflictSchema = z.object({
  example: z.string(),
  intentId: z.string().uuid(),
  intentName: z.string(),
  /** [신규 No.22] 상대 의도가 공통이면 없음(§7.5). */
  topicId: z.string().uuid().optional(),
  topicName: z.string().optional(),
});
export type ExampleConflict = z.infer<typeof ExampleConflictSchema>;

/** 예문 저장 응답 메타 — dedupe 건수(FR-6-5) + 교차 충돌 경고(FR-6-7). */
export const IntentMutationMetaSchema = z.object({
  deduplicatedCount: z.number().int().nonnegative().default(0),
  conflicts: z.array(ExampleConflictSchema).default([]),
});
export type IntentMutationMeta = z.infer<typeof IntentMutationMetaSchema>;

export const IntentMutationResultSchema = z.object({
  intent: IntentDetailSchema,
  meta: IntentMutationMetaSchema,
});
export type IntentMutationResult = z.infer<typeof IntentMutationResultSchema>;

export const BulkDeleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export type BulkDeleteDto = z.infer<typeof BulkDeleteSchema>;

export const IntentListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
  /** [신규 No.22] 콤마 구분 uuid | 'common' 목록. */
  topicIds: topicIdsFilter(),
});
export type IntentListQuery = z.infer<typeof IntentListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * (b) 키워드(엔티티) — FR-6-14~18
 * ---------------------------------------------------------------------------------------------- */

export const KeywordSynonymSchema = z
  .string()
  .trim()
  .min(1, '동의어를 입력해 주세요.')
  .max(100, '동의어는 최대 100자까지 입력할 수 있습니다.')
  .refine((v) => !/[\n\r\t]/.test(v), { message: '동의어에 줄바꿈이나 탭을 넣을 수 없습니다.' });

export const KeywordSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  synonyms: z.array(KeywordSynonymSchema).max(200).default([]),
  /** [신규 No.22] 값 없음 = 공통(항상 활성). */
  topicId: z.string().uuid().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Keyword = z.infer<typeof KeywordSchema>;

export const CreateKeywordSchema = z.object({
  name: DialogueNameSchema,
  description: z.string().max(300).optional(),
  synonyms: z.array(KeywordSynonymSchema).max(200).optional(),
  topicId: z.string().uuid().nullable().optional(),
});
export type CreateKeywordDto = z.infer<typeof CreateKeywordSchema>;

export const UpdateKeywordSchema = z.object({
  name: DialogueNameSchema.optional(),
  description: z.string().max(300).nullable().optional(),
  synonyms: z.array(KeywordSynonymSchema).max(200).optional(),
  topicId: z.string().uuid().nullable().optional(),
});
export type UpdateKeywordDto = z.infer<typeof UpdateKeywordSchema>;

export const KeywordListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  synonymCount: z.number().int().nonnegative(),
  linkedNodeCount: z.number().int().nonnegative(),
  topicId: z.string().uuid().nullable(),
  updatedAt: z.coerce.date(),
});
export type KeywordListItem = z.infer<typeof KeywordListItemSchema>;

export const KeywordDetailSchema = KeywordSchema.extend({
  linkedNodes: z.array(ResourceRefSchema).default([]),
});
export type KeywordDetail = z.infer<typeof KeywordDetailSchema>;

export const KeywordListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
  topicIds: topicIdsFilter(),
});
export type KeywordListQuery = z.infer<typeof KeywordListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * (c) 동음이의어/다의어 사전 — FR-7-1~11
 * ---------------------------------------------------------------------------------------------- */

export const HomonymPolicy = z.enum(['ASK', 'DEFAULT_MEANING', 'IGNORE']);
export type HomonymPolicy = z.infer<typeof HomonymPolicy>;

export const HomonymMeaningSchema = z.object({
  label: z.string().trim().min(1).max(100),
  contextHints: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  intentId: z.string().uuid().optional(),
  description: z.string().max(300).optional(),
});
export type HomonymMeaning = z.infer<typeof HomonymMeaningSchema>;

function checkHomonymMeanings(
  meanings: HomonymMeaning[],
  ctx: z.RefinementCtx,
  opts: { policy?: HomonymPolicy; defaultMeaningIndex?: number | null },
): void {
  // FR-7-4: 동일 문맥 힌트가 두 의미 이상에 중복되면 거부
  const hintOwner = new Map<string, number>();
  meanings.forEach((meaning, index) => {
    meaning.contextHints.forEach((hint) => {
      const key = hint.trim().toLowerCase();
      const owner = hintOwner.get(key);
      if (owner !== undefined && owner !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `문맥 힌트 "${hint}"가 여러 의미에 중복 등록되어 있습니다.`,
          path: ['meanings', index, 'contextHints'],
        });
      } else {
        hintOwner.set(key, index);
      }
    });
  });

  if (
    opts.policy === 'DEFAULT_MEANING' &&
    (opts.defaultMeaningIndex === undefined ||
      opts.defaultMeaningIndex === null ||
      opts.defaultMeaningIndex < 0 ||
      opts.defaultMeaningIndex >= meanings.length)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '기본 의미로 지정할 의미 순번이 올바르지 않습니다.',
      path: ['defaultMeaningIndex'],
    });
  }
}

export const HomonymDictionarySchema = z
  .object({
    id: z.string().uuid(),
    chatbotId: z.string().uuid(),
    word: z.string().trim().min(1).max(50),
    description: z.string().max(300).optional(),
    meanings: z.array(HomonymMeaningSchema).min(2, '의미는 2개 이상 등록해야 합니다.').max(10),
    policy: HomonymPolicy.default('ASK'),
    clarifyPrompt: z.string().max(200).optional(),
    defaultMeaningIndex: z.number().int().min(0).nullable().optional(),
    /** [신규 No.22] 값 없음 = 공통(항상 활성). */
    topicId: z.string().uuid().optional(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .superRefine((val, ctx) => checkHomonymMeanings(val.meanings, ctx, val));
export type HomonymDictionary = z.infer<typeof HomonymDictionarySchema>;

export const CreateHomonymSchema = z
  .object({
    word: z.string().trim().min(1).max(50),
    description: z.string().max(300).optional(),
    meanings: z.array(HomonymMeaningSchema).min(2).max(10),
    policy: HomonymPolicy.default('ASK'),
    clarifyPrompt: z.string().max(200).optional(),
    defaultMeaningIndex: z.number().int().min(0).nullable().optional(),
    topicId: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => checkHomonymMeanings(val.meanings, ctx, val));
export type CreateHomonymDto = z.infer<typeof CreateHomonymSchema>;

export const UpdateHomonymSchema = z
  .object({
    word: z.string().trim().min(1).max(50).optional(),
    description: z.string().max(300).nullable().optional(),
    meanings: z.array(HomonymMeaningSchema).min(2).max(10).optional(),
    policy: HomonymPolicy.optional(),
    clarifyPrompt: z.string().max(200).nullable().optional(),
    defaultMeaningIndex: z.number().int().min(0).nullable().optional(),
    topicId: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.meanings) checkHomonymMeanings(val.meanings, ctx, val);
  });
export type UpdateHomonymDto = z.infer<typeof UpdateHomonymSchema>;

export const HomonymListItemSchema = z.object({
  id: z.string().uuid(),
  word: z.string(),
  meaningCount: z.number().int().nonnegative(),
  policy: HomonymPolicy,
  topicId: z.string().uuid().nullable(),
  updatedAt: z.coerce.date(),
});
export type HomonymListItem = z.infer<typeof HomonymListItemSchema>;

export const HomonymListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
  topicIds: topicIdsFilter(),
});
export type HomonymListQuery = z.infer<typeof HomonymListQuerySchema>;

export const HomonymTestRequestSchema = z.object({
  text: z.string().min(1).max(1000),
});
export type HomonymTestRequestDto = z.infer<typeof HomonymTestRequestSchema>;

/* ------------------------------------------------------------------------------------------------
 * (d) 컨텍스트(멀티턴·슬롯필링) — FR-8-1~7
 * ---------------------------------------------------------------------------------------------- */

export const ContextSlotType = z.enum(['TEXT', 'NUMBER', 'DATE', 'PHONE', 'EMAIL', 'CHOICE', 'KEYWORD']);
export type ContextSlotType = z.infer<typeof ContextSlotType>;

export const SlotValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().positive().optional(),
  pattern: z.string().max(200).optional(),
  dateFormat: z.enum(['YYYY-MM-DD', 'YYYY.MM.DD', 'YYYYMMDD']).optional(),
});
export type SlotValidation = z.infer<typeof SlotValidationSchema>;

export const ContextSlotSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Za-z0-9_]{1,50}$/, '슬롯명은 영문/숫자/언더스코어 1~50자만 사용할 수 있습니다.'),
    label: z.string().trim().min(1).max(50),
    prompt: z.string().min(1).max(200),
    type: ContextSlotType,
    required: z.boolean().default(true),
    choices: z.array(z.string().trim().min(1).max(50)).min(2).max(20).optional(),
    keywordId: z.string().uuid().optional(),
    validation: SlotValidationSchema.optional(),
    errorPrompt: z.string().max(200).optional(),
    maxRetry: z.number().int().min(0).max(5).default(2),
    exampleValue: z.string().max(100).optional(),
  })
  .superRefine((slot, ctx) => {
    if (slot.type === 'CHOICE' && (!slot.choices || slot.choices.length < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '선택형 슬롯은 선택지를 2개 이상 등록해야 합니다.',
        path: ['choices'],
      });
    }
    if (slot.type === 'KEYWORD' && !slot.keywordId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '키워드형 슬롯은 연결할 키워드를 선택해야 합니다.',
        path: ['keywordId'],
      });
    }
  });
export type ContextSlot = z.infer<typeof ContextSlotSchema>;

function checkSlotNamesUnique(slots: ContextSlot[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  slots.forEach((slot, index) => {
    if (seen.has(slot.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `슬롯명 "${slot.name}"이(가) 폼 내에서 중복됩니다.`,
        path: ['slots', index, 'name'],
      });
    }
    seen.add(slot.name);
  });
}

export const ContextVariableSchema = z
  .object({
    id: z.string().uuid(),
    chatbotId: z.string().uuid(),
    name: z.string().min(1).max(100),
    description: z.string().max(300).optional(),
    slots: z.array(ContextSlotSchema).min(1, '슬롯은 1개 이상 등록해야 합니다.').max(20),
    completionMessage: z.string().max(500).optional(),
    cancelKeywords: z.array(z.string().trim().min(1).max(50)).max(10).default(['취소', '그만', '처음으로']),
    sessionTimeoutMinutes: z.number().int().min(1).max(180).default(30),
    /** [신규 No.22] 값 없음 = 공통(항상 활성). */
    topicId: z.string().uuid().optional(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .superRefine((val, ctx) => checkSlotNamesUnique(val.slots, ctx));
export type ContextVariable = z.infer<typeof ContextVariableSchema>;

export const CreateContextSchema = z
  .object({
    name: DialogueNameSchema,
    description: z.string().max(300).optional(),
    slots: z.array(ContextSlotSchema).min(1).max(20),
    completionMessage: z.string().max(500).optional(),
    cancelKeywords: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
    sessionTimeoutMinutes: z.number().int().min(1).max(180).optional(),
    topicId: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => checkSlotNamesUnique(val.slots, ctx));
export type CreateContextDto = z.infer<typeof CreateContextSchema>;

export const UpdateContextSchema = z
  .object({
    name: DialogueNameSchema.optional(),
    description: z.string().max(300).nullable().optional(),
    slots: z.array(ContextSlotSchema).min(1).max(20).optional(),
    completionMessage: z.string().max(500).nullable().optional(),
    cancelKeywords: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
    sessionTimeoutMinutes: z.number().int().min(1).max(180).optional(),
    topicId: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.slots) checkSlotNamesUnique(val.slots, ctx);
  });
export type UpdateContextDto = z.infer<typeof UpdateContextSchema>;

export const ContextListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  slotCount: z.number().int().nonnegative(),
  topicId: z.string().uuid().nullable(),
  updatedAt: z.coerce.date(),
});
export type ContextListItem = z.infer<typeof ContextListItemSchema>;

export const ContextListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
  topicIds: topicIdsFilter(),
});
export type ContextListQuery = z.infer<typeof ContextListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * (f) 아웃풋 12종 — FR-5-13, FR-5-14 (판별 유니온) — 노드 스키마보다 먼저 선언
 * ---------------------------------------------------------------------------------------------- */

export const DialogOutputType = z.enum([
  'TEXT',
  'CARD',
  'IMAGE',
  'BUTTON',
  'LINK',
  'PAUSE',
  'PHONE_CALL',
  'CONTEXT_FORM',
  'DIALOG_MOVE',
  'SCENARIO',
  'SURVEY',
  'API_CONDITION',
  // [신규 No.41] 업무 자동화 워크플로우 — "업무 요청 보내기"(비종결·사용자에게 보이지 않음).
  'WORKFLOW',
]);
export type DialogOutputType = z.infer<typeof DialogOutputType>;

/**
 * [No.27에서 축소] 정의·저장까지만 지원하고 실행하지 않는 아웃풋 "타입"(FR-5-15, FR-E-7, FR-L1-1, FR-SV1-1).
 * `API_CONDITION`·`SURVEY`는 더 이상 타입만으로 미지원 여부가 갈리지 않는다 — **형태**(v1/v2)로 판정한다.
 * 실행 미지원 여부를 판정할 때는 타입 상수를 직접 보지 말고 `isUnsupportedOutput()`을 쓴다.
 */
export const UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO'] as const;

export const ButtonItemSchema = z
  .object({
    label: z.string().trim().min(1).max(40),
    action: z.enum(['MESSAGE', 'LINK', 'NODE']),
    value: z.string().min(1),
  })
  .superRefine((btn, ctx) => {
    if (btn.action === 'LINK' && !SafeUrlSchema.safeParse(btn.value).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'http 또는 https 주소만 사용할 수 있습니다.', path: ['value'] });
    }
    if (btn.action === 'NODE' && !z.string().uuid().safeParse(btn.value).success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '이동할 노드를 선택해 주세요.', path: ['value'] });
    }
    if (btn.action === 'MESSAGE' && btn.value.length > 200) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '버튼 메시지는 최대 200자까지 입력할 수 있습니다.', path: ['value'] });
    }
  });
export type ButtonItem = z.infer<typeof ButtonItemSchema>;

export const TextOutputPayloadSchema = z.object({ text: z.string().min(1).max(1000) });

export const CardOutputPayloadSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().max(500).optional(),
    imageUrl: SafeUrlSchema.optional(),
    altText: z.string().max(200).optional(),
    buttons: z.array(ButtonItemSchema).max(5).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.imageUrl && !val.altText) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '이미지에는 대체 텍스트가 필요합니다.', path: ['altText'] });
    }
  });

export const ImageOutputPayloadSchema = z.object({
  imageUrl: SafeUrlSchema,
  altText: z.string().min(1, '이미지 대체 텍스트는 필수입니다.').max(200),
});

export const ButtonOutputPayloadSchema = z.object({
  text: z.string().max(500).optional(),
  buttons: z.array(ButtonItemSchema).min(1).max(5),
});

export const LinkOutputPayloadSchema = z.object({
  label: z.string().trim().min(1).max(40),
  url: SafeUrlSchema,
  openInNewTab: z.boolean().default(true),
});

export const PauseOutputPayloadSchema = z.object({
  durationMs: z.number().int().min(100).max(5000),
});

export const PhoneCallOutputPayloadSchema = z.object({
  label: z.string().trim().min(1).max(40),
  phoneNumber: z.string().regex(/^[0-9+\-() ]{5,20}$/, '전화번호 형식을 확인해 주세요.'),
});

export const ContextFormOutputPayloadSchema = z.object({
  contextVariableId: z.string().uuid(),
});

export const DialogMoveOutputPayloadSchema = z.object({
  targetNodeId: z.string().uuid(),
});

export const ScenarioOutputPayloadSchema = z.object({
  scenarioKey: z.string().trim().min(1).max(100),
  params: z.record(z.string()).optional(),
});

/** [No.5 원형 — 읽기 호환 전용] 자유 문자열 키. 새로 저장할 수 없다(서비스가 400 SURVEY_OUTPUT_LEGACY_FORMAT).
 * 실행하지 않는다. @deprecated 설문을 선택해 v2로 전환하세요. */
export const SurveyOutputPayloadV1Schema = z.object({ surveyId: z.string().trim().min(1).max(100) });
export type SurveyOutputPayloadV1 = z.infer<typeof SurveyOutputPayloadV1Schema>;

/** [No.27] 같은 챗봇 `Survey` 참조형. */
export const SurveyOutputPayloadV2Schema = z.object({
  version: z.literal(2),
  surveyId: z.string().uuid(),
  /** 완료 직후 이어서 실행할 노드 — 이탈·건너뜀에는 쓰지 않는다. */
  onCompleteNodeId: z.string().uuid().optional(),
});
export type SurveyOutputPayloadV2 = z.infer<typeof SurveyOutputPayloadV2Schema>;

/** 읽기 스키마 = v2 ∪ v1(v2 먼저). 이름은 기존 export를 유지하되 의미가 "합집합"으로 넓어진다. */
export const SurveyOutputPayloadSchema = z.union([SurveyOutputPayloadV2Schema, SurveyOutputPayloadV1Schema]);
export type SurveyOutputPayload = z.infer<typeof SurveyOutputPayloadSchema>;

/** `p.version === 2`로 판별한다. v1의 `surveyId`가 우연히 UUID 형식이어도 v1이다(자동 연결 금지, P-15). */
export function isSurveyV2(p: SurveyOutputPayload): p is SurveyOutputPayloadV2 {
  return (p as { version?: number }).version === 2;
}

export const ApiConditionItemSchema = z.object({
  path: z.string().min(1).max(200),
  operator: z.enum(['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'CONTAINS', 'EXISTS']),
  value: z.string().max(500).optional(),
  nextNodeId: z.string().uuid(),
});
/** frontend-implementer 추가: API 조건분기(⑫) 조건 아이템 편집기에서 쓰는 편의 타입(순수 추가, 계약 변경 없음). */
export type ApiConditionItem = z.infer<typeof ApiConditionItemSchema>;

/**
 * [No.5 원형 — 읽기 호환 전용] 새로 저장할 수 없다(서비스가 `400 API_OUTPUT_LEGACY_FORMAT`으로 거부).
 * ⚠ `url`은 형식(SafeUrl)만 검증한다. `headers`는 평문 저장돼 있다 — VIEWER의 열람은 응답 가림
 * (`redactLegacyApiOutputs`)으로 해소한다(No.26, FR-L1-6). @deprecated 연결 방식(v2)으로 전환하세요.
 */
export const ApiConditionOutputPayloadV1Schema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: SafeUrlSchema,
  headers: z.record(z.string()).optional(),
  bodyTemplate: z.string().max(4000).optional(),
  conditions: z.array(ApiConditionItemSchema).min(1).max(10),
});
export type ApiConditionOutputPayloadV1 = z.infer<typeof ApiConditionOutputPayloadV1Schema>;

/* ------------------------------------------------------------------------------------------------
 * [No.26 신설] API 조건분기 v2 — 전역 `ApiConnection` 참조형. 헤더·URL·자유 본문 템플릿 필드가
 * 존재하지 않는다(NFR-LS6 ⑦). `docs/02-spec/legacy-api-integration-설계.md` §4.1 근거.
 * ---------------------------------------------------------------------------------------------- */

export const API_CONDITION_LIMITS = {
  pathMaxLength: 300,
  pathParamsMax: 5,
  queryMax: 20,
  bodyMax: 30,
  bodyFieldDepthMax: 3,
  mappingsMax: 20,
  mappingMaxLengthDefault: 200,
  mappingMaxLengthMax: 500,
  conditionsMin: 1,
  conditionsMax: 10,
  responsePathMaxLength: 200,
  responsePathDepthMax: 10,
  constValueMax: 500,
} as const;

const FORBIDDEN_BODY_FIELD_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const API_BODY_FIELD_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,49}$/;

/** 노드에 저장하는 상대 경로(§7.2) — 쿼리는 이 필드에 담지 않는다(`query` 배열로만). */
export const ApiRelativePathSchema = z
  .string()
  .min(1, '경로를 입력해 주세요.')
  .max(API_CONDITION_LIMITS.pathMaxLength, `경로는 최대 ${API_CONDITION_LIMITS.pathMaxLength}자까지 입력할 수 있습니다.`)
  .refine((v) => v.startsWith('/'), { message: '경로는 "/"로 시작해야 합니다.' })
  .refine((v) => /^[A-Za-z0-9\-._~/!$&'()*+,;=:@{}]*$/.test(v), {
    message: '경로에 허용되지 않는 문자가 포함되어 있습니다.',
  })
  .refine((v) => !v.includes('//'), { message: '경로에 연속된 슬래시(//)를 사용할 수 없습니다.' })
  .refine((v) => !v.includes('\\'), { message: '경로에 역슬래시를 사용할 수 없습니다.' })
  .refine((v) => !v.split('/').some((seg) => seg === '..'), { message: '경로에 상위 경로(..)를 사용할 수 없습니다.' })
  .refine(
    (v) => {
      const matches = v.match(/\{[^}]*\}/g) ?? [];
      return matches.every((m) => /^\{[0-4]\}$/.test(m));
    },
    { message: '경로 자리표시자는 {0}~{4}만 사용할 수 있습니다.' },
  );
export type ApiRelativePath = z.infer<typeof ApiRelativePathSchema>;

/** 응답 JSON 추출 경로(§4.5) — `parseResponsePath()`가 통과하는 문법만 허용한다. */
export const ApiResponsePathSchema = z
  .string()
  .min(1, '경로를 입력해 주세요.')
  .max(API_CONDITION_LIMITS.responsePathMaxLength)
  .refine((v) => parseResponsePath(v) !== null, { message: '응답 경로 형식이 올바르지 않습니다.' });
export type ApiResponsePath = z.infer<typeof ApiResponsePathSchema>;

/** POST 본문 필드 경로 — 세그먼트 `^[A-Za-z_][A-Za-z0-9_]{0,49}$`, 깊이 ≤3, 금지 키. */
export const ApiBodyFieldSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (v) => {
      const segments = v.split('.');
      if (segments.length === 0 || segments.length > API_CONDITION_LIMITS.bodyFieldDepthMax) return false;
      return segments.every((seg) => API_BODY_FIELD_SEGMENT_RE.test(seg) && !FORBIDDEN_BODY_FIELD_SEGMENTS.has(seg));
    },
    { message: '본문 필드명 형식이 올바르지 않습니다.' },
  );
export type ApiBodyField = z.infer<typeof ApiBodyFieldSchema>;

/** 구조적 바인딩 — 관리자 작성 상수 또는 같은 턴에 완료된 폼의 슬롯 값. */
export const ApiBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CONST'), value: z.string().max(API_CONDITION_LIMITS.constValueMax) }),
  z.object({ kind: z.literal('SLOT'), contextVariableId: z.string().uuid(), slotName: z.string().min(1).max(50) }),
]);
export type ApiBinding = z.infer<typeof ApiBindingSchema>;

export const ApiResponseMappingSchema = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,29}$/, '매핑 이름은 영문으로 시작하는 영문/숫자/언더스코어 30자 이내여야 합니다.'),
  path: ApiResponsePathSchema,
  required: z.boolean().default(false),
  maxLength: z
    .number()
    .int()
    .min(1)
    .max(API_CONDITION_LIMITS.mappingMaxLengthMax)
    .default(API_CONDITION_LIMITS.mappingMaxLengthDefault),
});
export type ApiResponseMapping = z.infer<typeof ApiResponseMappingSchema>;

/** v2 조건 아이템 — v1과 동일한 판정 연산자를 쓰되 경로는 응답 경로 문법을 따른다. */
export const ApiConditionItemV2Schema = ApiConditionItemSchema.extend({ path: ApiResponsePathSchema });
export type ApiConditionItemV2 = z.infer<typeof ApiConditionItemV2Schema>;

function countPathPlaceholders(path: string): number {
  return (path.match(/\{[0-4]\}/g) ?? []).length;
}

/** [No.26] 연결 참조형. 헤더·URL·자유 본문 템플릿 필드가 **존재하지 않는다**(NFR-LS6 ⑦). */
export const ApiConditionOutputPayloadV2Schema = z
  .object({
    version: z.literal(2),
    connectionId: z.string().uuid(),
    method: z.enum(['GET', 'POST']),
    path: ApiRelativePathSchema,
    pathParams: z.array(ApiBindingSchema).max(API_CONDITION_LIMITS.pathParamsMax).default([]),
    query: z
      .array(z.object({ name: z.string().regex(/^[A-Za-z0-9_.\-]{1,50}$/), value: ApiBindingSchema }))
      .max(API_CONDITION_LIMITS.queryMax)
      .default([]),
    body: z
      .array(z.object({ field: ApiBodyFieldSchema, value: ApiBindingSchema }))
      .max(API_CONDITION_LIMITS.bodyMax)
      .default([]),
    responseMappings: z.array(ApiResponseMappingSchema).max(API_CONDITION_LIMITS.mappingsMax).default([]),
    conditions: z.array(ApiConditionItemV2Schema).min(API_CONDITION_LIMITS.conditionsMin).max(API_CONDITION_LIMITS.conditionsMax),
    defaultNodeId: z.string().uuid().optional(),
    failureNodeId: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    const placeholderCount = countPathPlaceholders(val.path);
    if (placeholderCount !== val.pathParams.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `경로 자리표시자 수(${placeholderCount})와 경로 값 수(${val.pathParams.length})가 일치해야 합니다.`,
        path: ['pathParams'],
      });
    }
    if (val.method === 'GET' && val.body.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'GET 요청에는 본문을 지정할 수 없습니다.', path: ['body'] });
    }
    const mappingNames = new Set<string>();
    val.responseMappings.forEach((m, i) => {
      if (mappingNames.has(m.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `매핑 이름 "${m.name}"이(가) 중복됩니다.`, path: ['responseMappings', i, 'name'] });
      }
      mappingNames.add(m.name);
    });
    const queryNames = new Set<string>();
    val.query.forEach((q, i) => {
      if (queryNames.has(q.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `쿼리 이름 "${q.name}"이(가) 중복됩니다.`, path: ['query', i, 'name'] });
      }
      queryNames.add(q.name);
    });
    const bodyFields = val.body.map((b) => b.field);
    const bodyFieldSet = new Set<string>();
    val.body.forEach((b, i) => {
      if (bodyFieldSet.has(b.field)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `본문 필드 "${b.field}"이(가) 중복됩니다.`, path: ['body', i, 'field'] });
      }
      bodyFieldSet.add(b.field);
      const hasPrefixCollision = bodyFields.some(
        (other) => other !== b.field && (other.startsWith(`${b.field}.`) || b.field.startsWith(`${other}.`)),
      );
      if (hasPrefixCollision) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `본문 필드 "${b.field}"이(가) 다른 필드와 상위/하위 관계로 충돌합니다.`,
          path: ['body', i, 'field'],
        });
      }
    });
  });
export type ApiConditionOutputPayloadV2 = z.infer<typeof ApiConditionOutputPayloadV2Schema>;

/** 읽기 스키마 = v2 ∪ v1(v2 먼저). 엔진 파싱·번들·스냅샷 복원 검증·응답 DTO가 v1을 계속 읽어야 한다. */
export const ApiConditionOutputPayloadSchema = z.union([ApiConditionOutputPayloadV2Schema, ApiConditionOutputPayloadV1Schema]);
export type ApiConditionOutputPayload = z.infer<typeof ApiConditionOutputPayloadSchema>;

/** `p.version === 2`로 판별한다. */
export function isApiConditionV2(p: ApiConditionOutputPayload): p is ApiConditionOutputPayloadV2 {
  return (p as { version?: number }).version === 2;
}

/** v1(이전 형식) 아웃풋의 위치 — 쓰기 거부·복사 제외 공용(규칙 1벌, FR-SV1-5 일반화). */
export function findLegacyOutputIndexes(outputs: readonly DialogOutput[]): Array<{ index: number; type: 'API_CONDITION' | 'SURVEY' }> {
  const result: Array<{ index: number; type: 'API_CONDITION' | 'SURVEY' }> = [];
  outputs.forEach((o, index) => {
    if (o.type === 'API_CONDITION' && !isApiConditionV2(o.payload)) result.push({ index, type: 'API_CONDITION' });
    if (o.type === 'SURVEY' && !isSurveyV2(o.payload)) result.push({ index, type: 'SURVEY' });
  });
  return result;
}

/** v1 `API_CONDITION` 아웃풋의 인덱스(기존 export 유지 — 호출부 무변경, 내부는 `findLegacyOutputIndexes` 위임). */
export function findLegacyApiOutputIndexes(outputs: readonly DialogOutput[]): number[] {
  return findLegacyOutputIndexes(outputs)
    .filter((r) => r.type === 'API_CONDITION')
    .map((r) => r.index);
}

/** v1 `SURVEY` 아웃풋의 인덱스(쓰기 거부·복사 제외 공용, FR-SV1-5). */
export function findLegacySurveyOutputIndexes(outputs: readonly DialogOutput[]): number[] {
  return findLegacyOutputIndexes(outputs)
    .filter((r) => r.type === 'SURVEY')
    .map((r) => r.index);
}

/* ------------------------------------------------------------------------------------------------
 * [신규 No.41] 업무 자동화 워크플로우 — "업무 요청 보내기" 아웃풋. 바인딩은 No.26 `ApiBindingSchema`
 * (`kind: CONST｜SLOT`)를 그대로 재사용한다(요구사항 초안의 `source` 키 대신 — R-1).
 * ---------------------------------------------------------------------------------------------- */

export const WORKFLOW_OUTPUT_LIMITS = {
  perNode: 3,
  fieldsMax: 20,
  fieldNameMax: 40,
  constValueMax: 500,
  actionKeyPattern: /^[a-z0-9._-]{1,60}$/,
} as const;

/** [No.41] "업무 요청 보내기" — 사용자에게 보이지 않는 비종결 아웃풋. 바인딩은 No.26 `ApiBindingSchema` 그대로. */
export const WorkflowOutputPayloadV1Schema = z
  .object({
    version: z.literal(1),
    targetId: z.string().uuid(),
    actionKey: z
      .string()
      .regex(WORKFLOW_OUTPUT_LIMITS.actionKeyPattern, '동작 키는 영문 소문자·숫자·.·_·- 60자 이내입니다.'),
    fields: z
      .array(
        z.object({
          name: z.string().regex(/^[A-Za-z0-9_]{1,40}$/),
          value: ApiBindingSchema,
        }),
      )
      .max(WORKFLOW_OUTPUT_LIMITS.fieldsMax)
      .default([]),
  })
  .superRefine((val, ctx) => {
    const seen = new Set<string>();
    val.fields.forEach((f, i) => {
      if (seen.has(f.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `필드 이름 "${f.name}"이(가) 중복됩니다.`, path: ['fields', i, 'name'] });
      }
      seen.add(f.name);
    });
  });
export type WorkflowOutputPayloadV1 = z.infer<typeof WorkflowOutputPayloadV1Schema>;

export const DialogOutputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), payload: TextOutputPayloadSchema }),
  z.object({ type: z.literal('CARD'), payload: CardOutputPayloadSchema }),
  z.object({ type: z.literal('IMAGE'), payload: ImageOutputPayloadSchema }),
  z.object({ type: z.literal('BUTTON'), payload: ButtonOutputPayloadSchema }),
  z.object({ type: z.literal('LINK'), payload: LinkOutputPayloadSchema }),
  z.object({ type: z.literal('PAUSE'), payload: PauseOutputPayloadSchema }),
  z.object({ type: z.literal('PHONE_CALL'), payload: PhoneCallOutputPayloadSchema }),
  z.object({ type: z.literal('CONTEXT_FORM'), payload: ContextFormOutputPayloadSchema }),
  z.object({ type: z.literal('DIALOG_MOVE'), payload: DialogMoveOutputPayloadSchema }),
  z.object({ type: z.literal('SCENARIO'), payload: ScenarioOutputPayloadSchema }),
  z.object({ type: z.literal('SURVEY'), payload: SurveyOutputPayloadSchema }),
  z.object({ type: z.literal('API_CONDITION'), payload: ApiConditionOutputPayloadSchema }),
  z.object({ type: z.literal('WORKFLOW'), payload: WorkflowOutputPayloadV1Schema }),
]);
export type DialogOutput = z.infer<typeof DialogOutputSchema>;

/** 실행 미지원 = `SCENARIO`·v1 `SURVEY`·v1 `API_CONDITION`. 엔진·설계 점검·웹 배지가 공용으로 쓴다(FR-L1-5, FR-SV1-3). */
export function isUnsupportedOutput(o: DialogOutput): boolean {
  if ((UNSUPPORTED_OUTPUT_TYPES as readonly string[]).includes(o.type)) return true;
  if (o.type === 'API_CONDITION' && !isApiConditionV2(o.payload)) return true;
  if (o.type === 'SURVEY' && !isSurveyV2(o.payload)) return true;
  return false;
}

export const LEGACY_REDACTED_VALUE = '[비공개]';

/**
 * v1 `API_CONDITION`만 변환한다: `url` → origin + "/" · `headers`의 모든 값 → `LEGACY_REDACTED_VALUE`
 * (키는 유지) · `bodyTemplate`(있으면) → `LEGACY_REDACTED_VALUE`. v2·그 외 아웃풋은 그대로 반환한다.
 * 결과는 여전히 v1 스키마를 통과한다(FR-L1-6 · FR-L8-3 · AC-L1-4).
 */
export function redactLegacyApiOutputs(outputs: readonly DialogOutput[]): DialogOutput[] {
  return outputs.map((o) => {
    if (o.type !== 'API_CONDITION' || isApiConditionV2(o.payload)) return o;
    const v1 = o.payload;
    let redactedUrl = v1.url;
    try {
      const u = new URL(v1.url);
      redactedUrl = `${u.protocol}//${u.host}/`;
    } catch {
      // 저장 시점에 SafeUrlSchema가 이미 검증했으므로 실무상 도달하지 않는다 — 원본을 그대로 둔다.
    }
    const redactedHeaders = v1.headers
      ? Object.fromEntries(Object.keys(v1.headers).map((k) => [k, LEGACY_REDACTED_VALUE]))
      : v1.headers;
    return {
      type: 'API_CONDITION',
      payload: {
        ...v1,
        url: redactedUrl,
        headers: redactedHeaders,
        bodyTemplate: v1.bodyTemplate !== undefined ? LEGACY_REDACTED_VALUE : v1.bodyTemplate,
      },
    };
  });
}

/* ------------------------------------------------------------------------------------------------
 * (e) 대화 노드 — FR-5-1~11
 * ---------------------------------------------------------------------------------------------- */

export const DialogNodeType = z.enum(['NORMAL', 'START', 'FALLBACK']);
export type DialogNodeType = z.infer<typeof DialogNodeType>;

export const DialogMatchMode = z.enum(['ANY', 'ALL']);
export type DialogMatchMode = z.infer<typeof DialogMatchMode>;

function checkNodeConditionsAndOutputs(val: {
  nodeType: DialogNodeType;
  enabled: boolean;
  intentIds: string[];
  keywordIds: string[];
  contextVariableId?: string;
  outputs: DialogOutput[];
}, ctx: z.RefinementCtx): void {
  const conditionCount = val.intentIds.length + val.keywordIds.length + (val.contextVariableId ? 1 : 0);
  if (val.nodeType === 'NORMAL' && conditionCount === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '조건을 1개 이상 지정하거나 시작/폴백 노드로 지정해 주세요.',
      path: ['intentIds'],
    });
  }
  if (val.enabled && val.outputs.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '활성화된 노드는 아웃풋을 1개 이상 등록해야 합니다.',
      path: ['outputs'],
    });
  }
}

const DialogNodeBaseSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string().min(1).max(100),
  description: z.string().max(300).optional(),
  nodeType: DialogNodeType.default('NORMAL'),
  matchMode: DialogMatchMode.default('ANY'),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(-1000).max(1000).default(100),
  intentIds: z.array(z.string().uuid()).default([]),
  keywordIds: z.array(z.string().uuid()).default([]),
  contextVariableId: z.string().uuid().optional(),
  outputs: z.array(DialogOutputSchema).max(10).default([]),
  /** [신규 No.22] 값 없음 = 공통(항상 활성). START/FALLBACK은 항상 없음(서비스 검사). */
  topicId: z.string().uuid().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const DialogNodeSchema = DialogNodeBaseSchema.superRefine((val, ctx) => checkNodeConditionsAndOutputs(val, ctx));
export type DialogNode = z.infer<typeof DialogNodeSchema>;

/** 노드 복사 응답(No.26·No.27) — v1 `API_CONDITION`·v1 `SURVEY`는 복사에서 제외되며 그 개수를 함께 돌려준다. */
export const DialogNodeCopyResponseSchema = DialogNodeBaseSchema.extend({
  excludedLegacyApiOutputCount: z.number().int().nonnegative(),
  excludedLegacySurveyOutputCount: z.number().int().nonnegative(),
});
export type DialogNodeCopyResponse = z.infer<typeof DialogNodeCopyResponseSchema>;

export const CreateDialogNodeSchema = z
  .object({
    name: DialogueNameSchema,
    description: z.string().max(300).optional(),
    nodeType: DialogNodeType.default('NORMAL'),
    matchMode: DialogMatchMode.default('ANY'),
    enabled: z.boolean().default(true),
    priority: z.number().int().min(-1000).max(1000).default(100),
    intentIds: z.array(z.string().uuid()).default([]),
    keywordIds: z.array(z.string().uuid()).default([]),
    contextVariableId: z.string().uuid().optional(),
    outputs: z.array(DialogOutputSchema).max(10).default([]),
    topicId: z.string().uuid().nullable().optional(),
  })
  .superRefine((val, ctx) => checkNodeConditionsAndOutputs(val, ctx));
export type CreateDialogNodeDto = z.infer<typeof CreateDialogNodeSchema>;

export const UpdateDialogNodeSchema = z.object({
  name: DialogueNameSchema.optional(),
  description: z.string().max(300).nullable().optional(),
  nodeType: DialogNodeType.optional(),
  matchMode: DialogMatchMode.optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  intentIds: z.array(z.string().uuid()).optional(),
  keywordIds: z.array(z.string().uuid()).optional(),
  contextVariableId: z.string().uuid().nullable().optional(),
  outputs: z.array(DialogOutputSchema).max(10).optional(),
  topicId: z.string().uuid().nullable().optional(),
});
export type UpdateDialogNodeDto = z.infer<typeof UpdateDialogNodeSchema>;

export const ConditionSummarySchema = z.object({
  intents: z.array(ResourceRefSchema).default([]),
  keywords: z.array(ResourceRefSchema).default([]),
  context: ResourceRefSchema.optional(),
});
export type ConditionSummary = z.infer<typeof ConditionSummarySchema>;

export const DialogNodeListItemSchema = DialogNodeBaseSchema.extend({
  conditionSummary: ConditionSummarySchema,
  outputTypes: z.array(DialogOutputType),
  incomingCount: z.number().int().nonnegative(),
  /** [신규 No.22] 목록 행은 항상 키가 존재한다 — null = 공통(부모 스키마의 optional 재정의). */
  topicId: z.string().uuid().nullable(),
  /** [신규 No.22 — FR-TP4-5] 이 노드에서 나가 다른 토픽(공통 제외)을 향하는 교차 참조 간선 수.
   * `collectAssetRefs()`의 `CROSS_TOPIC_REFERENCE` 조건을 만족하는 간선 수 — 추가 쿼리 0(§5.3). */
  crossTopicRefCount: z.number().int().nonnegative(),
});
export type DialogNodeListItem = z.infer<typeof DialogNodeListItemSchema>;

export const CopyDialogNodeSchema = z.object({
  name: DialogueNameSchema.optional(),
});
export type CopyDialogNodeDto = z.infer<typeof CopyDialogNodeSchema>;

export const DialogNodeListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: z.enum(['name', 'createdAt', 'updatedAt', 'priority']).default('updatedAt'),
  order: SortOrder.default('desc'),
  nodeType: csvEnumArray(DialogNodeType),
  enabled: queryBoolean().optional(),
  topicIds: topicIdsFilter(),
});
export type DialogNodeListQuery = z.infer<typeof DialogNodeListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * (g) FAQ — FR-9-1~12
 * ---------------------------------------------------------------------------------------------- */

export const FaqCategory = z.enum(['FAQ', 'SMALL_TALK', 'SELF_SERVICE', 'ERROR_RESPONSE']);
export type FaqCategory = z.infer<typeof FaqCategory>;

export const FaqEntrySchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  category: FaqCategory,
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(2000),
  altQuestions: z.array(z.string().min(1).max(300)).max(30).default([]),
  enabled: z.boolean().default(true),
  /** [신규 No.22] 값 없음 = 공통(항상 활성). */
  topicId: z.string().uuid().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type FaqEntry = z.infer<typeof FaqEntrySchema>;

export const CreateFaqSchema = z.object({
  category: FaqCategory,
  question: z.string().trim().min(1).max(300),
  answer: z.string().min(1).max(2000),
  altQuestions: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  enabled: z.boolean().default(true),
  topicId: z.string().uuid().nullable().optional(),
});
export type CreateFaqDto = z.infer<typeof CreateFaqSchema>;

export const UpdateFaqSchema = z.object({
  category: FaqCategory.optional(),
  question: z.string().trim().min(1).max(300).optional(),
  answer: z.string().min(1).max(2000).optional(),
  altQuestions: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  enabled: z.boolean().optional(),
  topicId: z.string().uuid().nullable().optional(),
});
export type UpdateFaqDto = z.infer<typeof UpdateFaqSchema>;

export const FaqListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  category: csvEnumArray(FaqCategory),
  enabled: queryBoolean().optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
  topicIds: topicIdsFilter(),
});
export type FaqListQuery = z.infer<typeof FaqListQuerySchema>;

export const FaqListResponseSchema = z.object({
  items: z.array(FaqEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  counts: z.record(FaqCategory, z.number().int().nonnegative()),
});
export type FaqListResponse = z.infer<typeof FaqListResponseSchema>;

export const FaqSuggestQuerySchema = z.object({
  q: z.string().min(1).max(300),
  mode: z.enum(['admin', 'public']).default('admin'),
  limit: z.coerce.number().int().min(1).max(5).default(5),
});
export type FaqSuggestQuery = z.infer<typeof FaqSuggestQuerySchema>;

export const FaqSuggestionSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
  category: FaqCategory,
  score: z.number().min(0).max(1),
  matchedBy: z.enum(['PREFIX', 'CONTAINS', 'TOKEN']),
});
export type FaqSuggestion = z.infer<typeof FaqSuggestionSchema>;

export const FaqPublicSuggestionSchema = z.object({
  id: z.string().uuid(),
  question: z.string(),
});
export type FaqPublicSuggestion = z.infer<typeof FaqPublicSuggestionSchema>;

/* ------------------------------------------------------------------------------------------------
 * No.10 응답 테스트/시뮬레이션 결과 — 하위호환 유지(ADR-0008)
 * ---------------------------------------------------------------------------------------------- */

export const SimulateResultSchema = z.object({
  input: z.string(),
  matchedIntentId: z.string().uuid().optional(),
  matchedFaqId: z.string().uuid().optional(),
  response: z.string(),
});
export type SimulateResult = z.infer<typeof SimulateResultSchema>;
