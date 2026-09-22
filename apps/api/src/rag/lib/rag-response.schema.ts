import { z } from 'zod';

/**
 * 외부 RAG 서버 응답 계약(§9.3, API_RAG.md §6-3). 알 수 없는 필드는 strip한다.
 * 파싱 실패 = 호출 실패(`SCHEMA_INVALID`)이며 예외를 사용자에게 전파하지 않는다(FR-0-42).
 */

/** `"N/A"` 허용 필드(§6-3 경고 — 실제 응답에서 다수 필드가 `"N/A"`로 채워질 수 있다). */
const NAString = z.union([z.string(), z.literal('N/A')]);
const NANumber = z.union([z.number(), z.literal('N/A')]);

export const RagSourceSchema = z.object({
  file_path: z.string(),
  page: NANumber.optional(),
  total_pages: NANumber.optional(),
  paragraph_id: z.string().optional(),
  section_title: NAString.optional(),
  paragraph_keywords: z.array(z.string()).optional(),
  processed_at: NAString.optional(),
  processing_model: NAString.optional(),
  chunk_index: NANumber.optional(),
  highlight_text: z.string().optional(),
  // start_char/end_char는 항상 0이라 스키마에 두지 않는다(§6-3).
  content_length: z.number().optional(),
});

export const RagSourceInfoSchema = z.object({
  total_sources: z.number(),
  common_metadata: z
    .object({ company: NAString.optional(), category: NAString.optional(), subcategory: NAString.optional() })
    .partial()
    .optional(),
  sources: z.array(RagSourceSchema).default([]),
});

/** 최상위는 **정확히 4필드**다(§6-3). */
export const RagQueryResponseSchema = z.object({
  result: z.string(),
  keywords: z.array(z.string()).default([]),
  source_info: RagSourceInfoSchema.nullable(),
  retrieval_success: z.union([z.literal(0), z.literal(1)]),
});
export type RagQueryResponseRaw = z.infer<typeof RagQueryResponseSchema>;

export const RagStatusResponseSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  vllm_ready: z.boolean(),
  uptime: z.number().optional(),
  services: z
    .object({
      vllm: z.object({ status: z.string() }).passthrough().optional(),
      neo4j: z.object({ status: z.string() }).passthrough().optional(),
    })
    .partial()
    .optional(),
});
export type RagStatusResponseRaw = z.infer<typeof RagStatusResponseSchema>;

/** `GET /api/documents/metadata`는 JSON 객체가 아니라 **여러 줄 문자열**이다(§2-2). */
export const RagDocumentsMetadataResponseSchema = z.object({
  result: z.string(),
});
export type RagDocumentsMetadataResponseRaw = z.infer<typeof RagDocumentsMetadataResponseSchema>;

/** 503 두 종류를 구분하는 본문(§0-4 근거 6) — `code` 키 유무로 재시도 전략을 나눈다(FR-N2-27). */
export const RagErrorBodySchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  status: z.string().optional(),
  message: z.string().optional(),
});
export type RagErrorBody = z.infer<typeof RagErrorBodySchema>;
