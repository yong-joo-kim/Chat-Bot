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
  // 대화 설계(No.5~9) 그룹 추가(dialogue-design-설계.md §4.1)
  'DUPLICATE_NAME',
  'DUPLICATE_FAQ',
  'SYNONYM_CONFLICT',
  'INVALID_REFERENCE',
  'INTENT_IN_USE',
  'KEYWORD_IN_USE',
  'CONTEXT_IN_USE',
  'NODE_IN_USE',
  'START_NODE_EXISTS',
  'FALLBACK_NODE_EXISTS',
  'OUTPUT_PAYLOAD_INVALID',
  'LIMIT_EXCEEDED',
  'IMPORT_TOO_LARGE',
  'IMPORT_FILE_INVALID',
  'IMPORT_TOKEN_EXPIRED',
  'IMPORT_ABORTED',
  // 품질/채널(No.10~11) 그룹 추가(quality-channel-설계.md §5.5)
  'CHANNEL_NOT_IMPLEMENTED',
  'CHANNEL_DISABLED',
  'CHATBOT_NOT_PUBLISHED',
  'ORIGIN_NOT_ALLOWED',
  'RATE_LIMITED',
  'OVERLAY_INVALID',
  'NO_CHANGES_TO_COMPARE',
  // 보안/이력(No.12~13) 그룹 추가(security-audit-설계.md §4.3, FR-0-28)
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'ACCOUNT_DISABLED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'PASSWORD_POLICY',
  'LAST_ADMIN',
  'SELF_MODIFICATION',
  'DUPLICATE_EMAIL',
  'BANNED_WORD_BLOCKED',
  'AUDIT_RANGE_TOO_WIDE',
  // 통계/분석(No.14~15) 그룹 추가(stats-learning-설계.md §4.4, DD-65)
  'STATS_RANGE_TOO_WIDE',
  'INVALID_GRANULARITY',
  'ALREADY_RESOLVED',
  'BULK_SIZE_EXCEEDED',
  // FAQ/의도 매칭 고도화(NLU 1단계 + RAG 2단계) 그룹 추가(nlu-rag-answering-설계.md §10.3, FR-0-45)
  'RAG_NOT_CONFIGURED',
  'RAG_UPSTREAM_UNAVAILABLE',
  'RAG_DISABLED',
  'EMBEDDING_UNAVAILABLE',
  'REINDEX_IN_PROGRESS',
  'PENDING_ANSWER_NOT_FOUND',
  'INVALID_THRESHOLD',
  // 학습 고도화(No.16 증강 · No.23 요소분해/경량 분류기) 그룹 추가(learning-augmentation-설계.md §8, FR-0-57)
  'AUGMENTATION_UNAVAILABLE',
  'AUGMENTATION_IN_PROGRESS',
  'SUGGESTION_EXPIRED',
  'CLASSIFIER_INSUFFICIENT_DATA',
  'CLASSIFIER_NOT_TRAINED',
  'CLASSIFIER_STALE_MODEL',
  // 검증/품질 고도화(No.19 대화검증시스템·TC테스트 / No.20 학습영향도 TEST) 그룹 추가(FR-0-65, ADR-0029)
  'TEST_RUN_IN_PROGRESS',
  'TEST_RUN_NOT_COMPARABLE',
  'TEST_SET_EMPTY',
  'TEST_CASE_LIMIT_EXCEEDED',
  'TEST_RUN_CANCELLED',
  // 챗봇 복원/버전 이력관리(No.25) 그룹 추가(version-history-설계.md §10.3, FR-0-75) — 9종
  'VERSION_SNAPSHOT_TOO_LARGE',
  'VERSION_SCHEMA_UNSUPPORTED',
  'VERSION_INTEGRITY_FAILED',
  'VERSION_PINNED_LIMIT_EXCEEDED',
  'VERSION_PINNED',
  'RESTORE_PREVIEW_STALE',
  'RESTORE_BLOCKED_BY_ACTIVE_JOB',
  'RESTORE_IN_PROGRESS',
  'RESTORE_NO_CHANGES',
  // 운영 예약 배포(No.28) 그룹 추가(scheduled-deploy-설계.md §13.4, FR-0-84) — 6종.
  'DEPLOY_SCHEDULE_INVALID_TIME',
  'DEPLOY_SCHEDULE_LIMIT_EXCEEDED',
  'DEPLOY_SCHEDULE_NOT_MODIFIABLE',
  'DEPLOY_SCHEDULE_PRECONDITION_FAILED',
  'VERSION_REFERENCED_BY_SCHEDULE',
  'RESTORE_BUSY',
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
/**
 * 텍스트 비교·중복 판정·매칭의 유일한 정규화 규칙(FR-0-12, ADR-0006).
 * `NFKC`(전각/반각 통일) → `trim` → 소문자 → 연속 공백 1칸 축약.
 * ⚠ 변경 시 전 도메인(의도/키워드/컨텍스트/노드/동음이의어/FAQ)의 유일성 의미가 바뀐다.
 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * KST(Asia/Seoul) 버킷 변환의 단일 소스(FR-0-31, ADR-0017). 대한민국은 서머타임이 없어
 * 고정 오프셋(540분)으로 충분하다. `apps/api`(적재·집계) · `prisma/scripts`(백필) ·
 * `prisma/seed.ts` · `apps/web`(표기) 네 소비자가 공유하는 횡단 관심사다.
 * ⚠ `apps/api/src/stats/lib/dashboard-period.ts`의 KST 헬퍼와는 **의도적으로 분리**되어 있다
 * (J-4 — 대시보드 코드 무변경). 두 구현의 동일성은 AC-14A-9로 고정한다.
 */
export const KST_OFFSET_MINUTES = 540;

/** UTC `Date` → KST 기준 `YYYY-MM-DD` 문자열(적재 시점 확정, EX-14-7/EX-14-12). */
export function toKstDayBucket(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** UTC `Date` → KST 기준 시(0~23). 시간대 분포(FR-14-28, DD-59) 전용. */
export function toKstHourOfDay(date: Date): number {
  const kst = new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  return kst.getUTCHours();
}

/**
 * `dayBucket`(`YYYY-MM-DD`) 문자열만으로 요일을 파생한다(0=월 ~ 6=일, ISO-8601, FR-14-29).
 * `Date` 타임존 함수에 의존하지 않아 서버 TZ와 무관하게 결정적이다(ADR-0017).
 */
export function toKstWeekday(dayBucket: string): number {
  const [y, m, d] = dayBucket.split('-').map(Number);
  const jsDay = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay(); // 0=일 ~ 6=토
  return (jsDay + 6) % 7; // 0=월 ~ 6=일로 변환
}

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

/**
 * 문자열 boolean 명시 파서 — `z.coerce.boolean()` 대체. `Boolean("false") === true`라서 coerce는
 * `?enabled=false`·`X=false`를 `true`로 만든다. 허용: `true|false|1|0`(앞뒤 공백·대소문자 무시).
 * 빈 문자열·null은 "미지정"(undefined), 그 외 문자열은 그대로 넘겨 `z.boolean()`이 거부하게 한다.
 * 쿼리(`queryBoolean`)와 API 환경변수(`apps/api/src/config/lib/env-boolean.ts`)가 같은 규칙을 쓴다.
 */
export function parseBooleanString(val: unknown): unknown {
  if (val === undefined || val === null) return undefined;
  if (typeof val !== 'string') return val;
  const s = val.trim().toLowerCase();
  if (s === '') return undefined;
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return val;
}

/** 목록 쿼리용 boolean. 기본값이 필요하면 `.default(false)`를 붙인다. */
export function queryBoolean() {
  return z.preprocess(parseBooleanString, z.boolean().optional());
}
