import { z } from 'zod';

/**
 * 여러 도메인이 공유하는 횡단 관심사(페이지네이션/오류봉투/정렬/안전 URL)만 이 파일에 둔다.
 * 도메인 스키마(챗봇/통계 등)는 각 도메인 파일에 둔다.
 * (`docs/02-spec/개발명세서.md` §6-9, `docs/02-spec/chatbot-operations-설계.md` §4.1)
 */

export const SortOrder = z.enum(['asc', 'desc']);
export type SortOrder = z.infer<typeof SortOrder>;

/** 목록 API 공통 페이지네이션 쿼리(FR-0-5). page는 1부터, pageSize 기본 20 · 최대 100. */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** 목록 API 공통 응답 봉투 제네릭 헬퍼(FR-0-5). */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

/** 오류 코드 전체 목록(`chatbot-operations-설계.md` §5.4). 프런트는 message가 아니라 code로 분기한다. */
export const ApiErrorCode = z.enum([
  'VALIDATION_FAILED',
  'RESERVED_SLUG',
  'INVALID_STATUS_TRANSITION',
  'INVALID_PERIOD',
  'CONFIRM_NAME_MISMATCH',
  'NOT_FOUND',
  'DUPLICATE_SLUG',
  'GROUP_NOT_EMPTY',
  'CHATBOT_ARCHIVED',
  'CHATBOT_NOT_ARCHIVED',
  'CHATBOT_HAS_CHILDREN',
  'CONFIG_ERROR',
  'AGGREGATION_TIMEOUT',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
});
export type ApiErrorDetail = z.infer<typeof ApiErrorDetailSchema>;

/** 전역 오류 봉투(FR-0-3, ADR-0003). */
export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: ApiErrorCode,
  message: z.string(),
  details: z.array(ApiErrorDetailSchema).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/**
 * `.url()`만으로는 `javascript:alert(1)` 같은 비허용 스킴을 걸러내지 못한다(NFR-S3).
 * http/https 스킴만 허용하는 refine을 추가한다.
 */
export const SafeUrlSchema = z
  .string()
  .url()
  .refine((v) => /^https?:\/\//i.test(v), {
    message: 'http 또는 https 주소만 사용할 수 있습니다.',
  });

/**
 * `?status=DRAFT,ACTIVE` 형태의 콤마 구분 단일 쿼리 파라미터를 enum 배열로 변환한다.
 * 값이 없으면 undefined(필터 미적용)를 반환한다.
 */
export function csvEnumArray<T extends [string, ...string[]]>(enumSchema: z.ZodEnum<T>) {
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
  }, z.array(enumSchema).optional());
}
