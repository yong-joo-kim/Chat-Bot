import { z } from 'zod';

/** 기능요구사항.md No.6 의도(Intent)·키워드(Entity) 관리 */
export const IntentSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string().min(1).max(100),
  examples: z.array(z.string().min(1)).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Intent = z.infer<typeof IntentSchema>;

export const KeywordSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string().min(1).max(100),
  synonyms: z.array(z.string().min(1)).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Keyword = z.infer<typeof KeywordSchema>;

/** No.7 동음이의어/다의어 사전 */
export const HomonymMeaningSchema = z.object({
  meaning: z.string().min(1).max(100),
  contextHint: z.string().max(200).optional(),
});
export const HomonymDictionarySchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  word: z.string().min(1).max(50),
  meanings: z.array(HomonymMeaningSchema).min(2),
  createdAt: z.coerce.date(),
});
export type HomonymDictionary = z.infer<typeof HomonymDictionarySchema>;

/** 대화그래프 아웃풋 12종(기능요구사항.md No.5) */
export const DialogOutputType = z.enum([
  'TEXT',
  'CARD',
  'IMAGE',
  'BUTTON',
  'SCENARIO',
  'SURVEY',
  'PAUSE',
  'LINK',
  'PHONE_CALL',
  'CONTEXT_FORM',
  'DIALOG_MOVE',
  'API_CONDITION',
]);
export type DialogOutputType = z.infer<typeof DialogOutputType>;

export const DialogOutputSchema = z.object({
  type: DialogOutputType,
  /** 타입별 payload(텍스트 문구, 카드 데이터, API 조건 등) — Phase1은 자유 JSON, 이후 타입별 세분화 */
  payload: z.record(z.unknown()).default({}),
});
export type DialogOutput = z.infer<typeof DialogOutputSchema>;

/** No.5 대화 그래프(시나리오) 빌더 */
export const DialogNodeSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string().min(1).max(100),
  /** 인풋 조건: 의도/키워드/컨텍스트 ID 참조 */
  intentIds: z.array(z.string().uuid()).default([]),
  keywordIds: z.array(z.string().uuid()).default([]),
  contextVariableId: z.string().uuid().optional(),
  outputs: z.array(DialogOutputSchema).default([]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type DialogNode = z.infer<typeof DialogNodeSchema>;

/** No.8 컨텍스트(멀티턴·슬롯필링) 관리 */
export const ContextSlotSchema = z.object({
  name: z.string().min(1).max(50),
  prompt: z.string().min(1).max(200),
  exampleValue: z.string().max(100).optional(),
});
export const ContextVariableSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  name: z.string().min(1).max(100),
  slots: z.array(ContextSlotSchema).min(1),
  createdAt: z.coerce.date(),
});
export type ContextVariable = z.infer<typeof ContextVariableSchema>;

/** No.9 FAQ 관리 */
export const FaqCategory = z.enum(['FAQ', 'SMALL_TALK', 'SELF_SERVICE', 'ERROR_RESPONSE']);
export type FaqCategory = z.infer<typeof FaqCategory>;

export const FaqEntrySchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  category: FaqCategory,
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(2000),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type FaqEntry = z.infer<typeof FaqEntrySchema>;

/** No.10 응답 테스트/시뮬레이션 결과 */
export const SimulateResultSchema = z.object({
  input: z.string(),
  matchedIntentId: z.string().uuid().optional(),
  matchedFaqId: z.string().uuid().optional(),
  response: z.string(),
});
export type SimulateResult = z.infer<typeof SimulateResultSchema>;
