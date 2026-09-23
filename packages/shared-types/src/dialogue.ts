import { z } from 'zod';
import { PaginationQuerySchema, SortOrder, SafeUrlSchema, csvEnumArray, queryBoolean } from './common';

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
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Intent = z.infer<typeof IntentSchema>;

export const CreateIntentSchema = z.object({
  name: DialogueNameSchema,
  description: z.string().max(300).optional(),
  examples: z.array(IntentExampleSchema).max(500).optional(),
});
export type CreateIntentDto = z.infer<typeof CreateIntentSchema>;

export const UpdateIntentSchema = z.object({
  name: DialogueNameSchema.optional(),
  description: z.string().max(300).nullable().optional(),
  examples: z.array(IntentExampleSchema).max(500).optional(),
});
export type UpdateIntentDto = z.infer<typeof UpdateIntentSchema>;

export const IntentListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  exampleCount: z.number().int().nonnegative(),
  linkedNodeCount: z.number().int().nonnegative(),
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
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Keyword = z.infer<typeof KeywordSchema>;

export const CreateKeywordSchema = z.object({
  name: DialogueNameSchema,
  description: z.string().max(300).optional(),
  synonyms: z.array(KeywordSynonymSchema).max(200).optional(),
});
export type CreateKeywordDto = z.infer<typeof CreateKeywordSchema>;

export const UpdateKeywordSchema = z.object({
  name: DialogueNameSchema.optional(),
  description: z.string().max(300).nullable().optional(),
  synonyms: z.array(KeywordSynonymSchema).max(200).optional(),
});
export type UpdateKeywordDto = z.infer<typeof UpdateKeywordSchema>;

export const KeywordListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  synonymCount: z.number().int().nonnegative(),
  linkedNodeCount: z.number().int().nonnegative(),
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
  updatedAt: z.coerce.date(),
});
export type HomonymListItem = z.infer<typeof HomonymListItemSchema>;

export const HomonymListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
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
  updatedAt: z.coerce.date(),
});
export type ContextListItem = z.infer<typeof ContextListItemSchema>;

export const ContextListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
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
]);
export type DialogOutputType = z.infer<typeof DialogOutputType>;

/** 이번 Phase에서 정의·저장까지만 지원하고 실행하지 않는 아웃풋 타입(FR-5-15, FR-E-7). */
export const UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO', 'SURVEY', 'API_CONDITION'] as const;

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

export const SurveyOutputPayloadSchema = z.object({
  surveyId: z.string().trim().min(1).max(100),
});

export const ApiConditionItemSchema = z.object({
  path: z.string().min(1).max(200),
  operator: z.enum(['EQ', 'NEQ', 'GT', 'GTE', 'LT', 'LTE', 'CONTAINS', 'EXISTS']),
  value: z.string().max(500).optional(),
  nextNodeId: z.string().uuid(),
});
/** frontend-implementer 추가: API 조건분기(⑫) 조건 아이템 편집기에서 쓰는 편의 타입(순수 추가, 계약 변경 없음). */
export type ApiConditionItem = z.infer<typeof ApiConditionItemSchema>;

/**
 * ⚠ `url`은 형식(SafeUrl)만 검증한다. SSRF 방어(사설 IP 대역 차단)는 실행 Phase(No.26)의 책임이다(NFR-S4).
 * `headers`는 평문 저장된다 — 암호화는 No.26/No.45 과제(NFR-S5).
 */
export const ApiConditionOutputPayloadSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: SafeUrlSchema,
  headers: z.record(z.string()).optional(),
  bodyTemplate: z.string().max(4000).optional(),
  conditions: z.array(ApiConditionItemSchema).min(1).max(10),
});

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
]);
export type DialogOutput = z.infer<typeof DialogOutputSchema>;

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
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const DialogNodeSchema = DialogNodeBaseSchema.superRefine((val, ctx) => checkNodeConditionsAndOutputs(val, ctx));
export type DialogNode = z.infer<typeof DialogNodeSchema>;

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
});
export type CreateFaqDto = z.infer<typeof CreateFaqSchema>;

export const UpdateFaqSchema = z.object({
  category: FaqCategory.optional(),
  question: z.string().trim().min(1).max(300).optional(),
  answer: z.string().min(1).max(2000).optional(),
  altQuestions: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateFaqDto = z.infer<typeof UpdateFaqSchema>;

export const FaqListQuerySchema = PaginationQuerySchema.extend({
  q: z.string().max(200).optional(),
  category: csvEnumArray(FaqCategory),
  enabled: queryBoolean().optional(),
  sort: ListSortField.default('updatedAt'),
  order: SortOrder.default('desc'),
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
