import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, paginated, queryBoolean } from './common';

/**
 * [신규 No.43] 지식베이스 자동 크롤링/동기화 — `docs/02-spec/kb-crawling-설계.md` §4 근거.
 * ADR-0044(수집·변경 감지는 `apps/api` · 적재·색인·답변은 외부 RAG · 원문 비저장 · 7번째 출구
 * `KB_CRAWL` · 첫 회 미리보기 · 자동 삭제 없음 · 슬롯 임대 전역 직렬 적재).
 * 의존 방향: `common.ts`만 참조(단방향).
 */

export const KB_SYNC_LIMITS = {
  maxSources: 50,
  nameMax: 100,
  seedUrlsMin: 1,
  seedUrlsMax: 10,
  sitemapUrlsMax: 5,
  pathPrefixesMax: 20,
  excludePatternsMax: 50,
  noisePatternsMax: 20,
  patternMax: 200,
  maxDepthMax: 5,
  defaultDepth: 3,
  defaultMaxPages: 500,
  maxPagesCapDefault: 5000,
  defaultMaxFileBytes: 20 * 1024 * 1024,
  minIntervalMsFloor: 500,
  defaultIntervalMs: 1000,
  scopeMax: 200,
  headerNameMax: 64,
} as const;

const HhMm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm 형식이어야 합니다.');
const SecretRef = z.string().regex(/^[A-Z0-9]+(_[A-Z0-9]+)*$/, '영문 대문자·숫자·밑줄만 사용할 수 있습니다.');
const HeaderName = z
  .string()
  .regex(/^[A-Za-z0-9-]{1,64}$/, '헤더 이름 형식이 올바르지 않습니다.')
  .refine((v) => !['host', 'cookie', 'content-length', 'transfer-encoding', 'connection'].includes(v.toLowerCase()) && !v.toLowerCase().startsWith('proxy-'), {
    message: '사용할 수 없는 헤더 이름입니다.',
  });

export const KbFileType = z.enum(['PDF', 'DOCX', 'XLSX', 'PPTX']);
export type KbFileType = z.infer<typeof KbFileType>;

export const KbScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MANUAL') }),
  z.object({ kind: z.literal('DAILY'), time: HhMm }),
  z.object({ kind: z.literal('WEEKLY'), weekday: z.number().int().min(0).max(6), time: HhMm }),
]);
export type KbSchedule = z.infer<typeof KbScheduleSchema>;

export const KbAuthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NONE') }),
  z.object({ kind: z.literal('STATIC_HEADER'), headerName: HeaderName, secretRef: SecretRef }),
]);
export type KbAuth = z.infer<typeof KbAuthSchema>;

const UrlListSchema = (max: number) => z.array(z.string().url()).max(max);

export const KbSourceScopeSchema = z.object({
  company: z.string().trim().min(1).max(KB_SYNC_LIMITS.scopeMax),
  category: z.string().trim().min(1).max(KB_SYNC_LIMITS.scopeMax),
  subcategory: z.string().trim().min(1).max(KB_SYNC_LIMITS.scopeMax),
});
export type KbSourceScope = z.infer<typeof KbSourceScopeSchema>;

export const KbSourceCreateSchema = z.object({
  name: z.string().trim().min(1).max(KB_SYNC_LIMITS.nameMax),
  seedUrls: UrlListSchema(KB_SYNC_LIMITS.seedUrlsMax).min(KB_SYNC_LIMITS.seedUrlsMin),
  sitemapUrls: UrlListSchema(KB_SYNC_LIMITS.sitemapUrlsMax).default([]),
  pathPrefixes: z.array(z.string().max(KB_SYNC_LIMITS.patternMax)).max(KB_SYNC_LIMITS.pathPrefixesMax).default([]),
  excludePatterns: z.array(z.string().max(KB_SYNC_LIMITS.patternMax)).max(KB_SYNC_LIMITS.excludePatternsMax).default([]),
  noisePatterns: z.array(z.string().max(KB_SYNC_LIMITS.patternMax)).max(KB_SYNC_LIMITS.noisePatternsMax).default([]),
  allowQueryUrls: z.boolean().default(false),
  maxDepth: z.number().int().min(0).max(KB_SYNC_LIMITS.maxDepthMax).default(KB_SYNC_LIMITS.defaultDepth),
  maxPages: z.number().int().min(1).default(KB_SYNC_LIMITS.defaultMaxPages),
  fileTypes: z.array(KbFileType).default([]),
  maxFileBytes: z.number().int().min(1).default(KB_SYNC_LIMITS.defaultMaxFileBytes),
  minIntervalMs: z.number().int().min(KB_SYNC_LIMITS.minIntervalMsFloor).default(KB_SYNC_LIMITS.defaultIntervalMs),
  scope: KbSourceScopeSchema,
  schedule: KbScheduleSchema,
  auth: KbAuthSchema,
  piiMask: z.boolean().default(true),
  allowRawFileIngest: z.boolean().default(false),
  rightsConfirmed: z.literal(true),
});
export type KbSourceCreateDto = z.infer<typeof KbSourceCreateSchema>;

export const KbSourceUpdateSchema = KbSourceCreateSchema.omit({ rightsConfirmed: true }).partial().extend({ enabled: z.boolean().optional() });
export type KbSourceUpdateDto = z.infer<typeof KbSourceUpdateSchema>;

export const KbRunKind = z.enum(['PREVIEW', 'SYNC', 'FULL_RESEND']);
export type KbRunKind = z.infer<typeof KbRunKind>;
export const KbRunTrigger = z.enum(['SCHEDULED', 'MANUAL', 'APPROVAL']);
export type KbRunTrigger = z.infer<typeof KbRunTrigger>;
export const KbRunStatus = z.enum(['QUEUED', 'CRAWLING', 'INGESTING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED']);
export type KbRunStatus = z.infer<typeof KbRunStatus>;
export const KbRunDisplayStatus = z.enum([...KbRunStatus.options, 'INTERRUPTED']);
export type KbRunDisplayStatus = z.infer<typeof KbRunDisplayStatus>;
export const KbRunFailureCode = z.enum([
  'ALL_SEEDS_UNREACHABLE',
  'ROBOTS_UNREACHABLE',
  'EGRESS_BLOCKED',
  'HOST_NOT_ALLOWED',
  'SECRET_MISSING',
  'RAG_NOT_CONFIGURED',
  'INGEST_NOT_ACKNOWLEDGED',
  'CANCELLED_BY_USER',
  'SOURCE_DISABLED',
  'CONFIG_CHANGED',
  // [pass 8 · PM 결정 2026-09-28] 거버넌스 모드를 켜기 전에 저장된 소스(마스킹 끔 · 원본 파일 전달 켬)의 적재가 제출 직전에 막혀 실행이 끝났다 — 저장 검증(`details[].message`)과 같은 이름.
  'GOVERNANCE_MASK_REQUIRED',
  'GOVERNANCE_RAW_FILE_NOT_ALLOWED',
]);
export type KbRunFailureCode = z.infer<typeof KbRunFailureCode>;
export const KbDemotionReason = z.enum(['NEW_RATIO', 'AUTH_WALL']);
export type KbDemotionReason = z.infer<typeof KbDemotionReason>;
export const KbDocumentState = z.enum(['ACTIVE', 'GONE', 'EXCLUDED']);
export type KbDocumentState = z.infer<typeof KbDocumentState>;
export const KbExcludeReason = z.enum([
  'ROBOTS',
  'TYPE',
  'SIZE',
  'REDIRECT_OUT_OF_SCOPE',
  'NO_BODY',
  'NOINDEX',
  'RAW_FILE_OFF',
  'ENCODING',
  'PII_IN_RAW_FILE',
  'FILE_UNSAFE',
  'FILE_ENCRYPTED',
  'AUTH_WALL',
]);
export type KbExcludeReason = z.infer<typeof KbExcludeReason>;
export const KbCleanupReason = z.enum(['GONE', 'SHRUNK', 'ROBOTS_DISALLOWED', 'SCOPE_CHANGED', 'FORMAT_CHANGED']);
export type KbCleanupReason = z.infer<typeof KbCleanupReason>;
export const KbIngestLane = z.enum(['INCREMENTAL', 'BULK']);
export type KbIngestLane = z.infer<typeof KbIngestLane>;
export const KbIngestJobStatus = z.enum(['PENDING', 'SUBMITTING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'TIMEOUT', 'CANCELLED', 'SKIPPED']);
export type KbIngestJobStatus = z.infer<typeof KbIngestJobStatus>;
export const KbIngestResultCode = z.enum([
  'OK',
  'RAG_REPORTED_FAILURE',
  'TASK_FAILED',
  'TASK_CANCELLED',
  'TASK_LOST',
  'HTTP_400',
  'RATE_LIMITED',
  'OVERLOADED',
  'UPSTREAM_ERROR',
  'NETWORK_ERROR',
  'INVALID_TASK_ID',
  'GONE_AT_INGEST',
  'EXCLUDED_AT_INGEST',
  'UNCHANGED_AT_INGEST',
  'WAIT_TIMEOUT',
  'CANCELLED_BY_USER',
  'CONFIG_CHANGED',
]);
export type KbIngestResultCode = z.infer<typeof KbIngestResultCode>;

export const KbRunCrawlCountsSchema = z.object({
  discovered: z.number().int().nonnegative(),
  visited: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  gone: z.number().int().nonnegative(),
  needsCleanup: z.number().int().nonnegative(),
  piiMasked: z.number().int().nonnegative(),
  excluded: z.record(KbExcludeReason, z.number().int()),
  outOfScopeLinks: z.number().int().nonnegative(),
});
export type KbRunCrawlCounts = z.infer<typeof KbRunCrawlCountsSchema>;

export const KbRunIngestCountsSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  inFlight: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
  timeout: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type KbRunIngestCounts = z.infer<typeof KbRunIngestCountsSchema>;

export const KbRunViewSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceName: z.string(),
  kind: KbRunKind,
  trigger: KbRunTrigger,
  status: KbRunDisplayStatus,
  crawl: KbRunCrawlCountsSchema,
  ingest: KbRunIngestCountsSchema.nullable(),
  progress: z.object({ done: z.number().int(), total: z.number().int() }).nullable(),
  etaSeconds: z.number().int().nullable(),
  waitingReason: z.enum(['RAG_NOT_READY', 'BULK_WINDOW', 'RATE_LIMIT']).nullable(),
  maxPagesReached: z.boolean(),
  demotedReason: KbDemotionReason.nullable(),
  failureCode: KbRunFailureCode.nullable(),
  resumedCount: z.number().int(),
  startedAt: z.coerce.date().nullable(),
  crawlFinishedAt: z.coerce.date().nullable(),
  finishedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type KbRunView = z.infer<typeof KbRunViewSchema>;

/** [신규 No.43 — 3차 보완 · 설계서 :1078] 저장(등록·수정) 응답 전용 스코프 경고. */
export const KbScopeWarningCode = z.enum(['SCOPE_SHARED_WITH_OTHER_SOURCE', 'SCOPE_NOT_READ_BY_ANY_CHATBOT']);
export type KbScopeWarningCode = z.infer<typeof KbScopeWarningCode>;
export const KbScopeWarningSchema = z.object({ code: KbScopeWarningCode });
export type KbScopeWarning = z.infer<typeof KbScopeWarningSchema>;

export const KbSourceResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  seedUrls: z.array(z.string()),
  sitemapUrls: z.array(z.string()),
  allowedHosts: z.array(z.string()),
  pathPrefixes: z.array(z.string()),
  excludePatterns: z.array(z.string()),
  noisePatterns: z.array(z.string()),
  allowQueryUrls: z.boolean(),
  maxDepth: z.number().int(),
  maxPages: z.number().int(),
  fileTypes: z.array(KbFileType),
  maxFileBytes: z.number().int(),
  minIntervalMs: z.number().int(),
  scope: KbSourceScopeSchema,
  schedule: KbScheduleSchema,
  authKind: z.enum(['NONE', 'STATIC_HEADER']),
  authHeaderName: z.string().nullable(),
  authSecretRef: z.string().nullable(),
  piiMask: z.boolean(),
  allowRawFileIngest: z.boolean(),
  enabled: z.boolean(),
  configVersion: z.number().int(),
  ingestApproved: z.boolean(),
  needsPreview: z.boolean(),
  reviewRequiredReason: KbDemotionReason.nullable(),
  activeRun: KbRunViewSchema.nullable(),
  lastRun: z.object({ id: z.string().uuid(), status: KbRunDisplayStatus, finishedAt: z.coerce.date().nullable() }).nullable(),
  nextRunAt: z.coerce.date().nullable(),
  needsCleanupCount: z.number().int(),
  repeatedFailureCount: z.number().int(),
  // [신규 No.43 — 3차 보완 · 설계서에 없는 추가 필드(편차 기록)] KB-9 "전체 다시 적재" 확인 문구에
  // 필요한 활성 문서 수(state=ACTIVE) — 목록 조회는 N+1 없이 groupBy 1회로 구한다.
  activeDocumentCount: z.number().int(),
  // [신규 No.43 — R1 리뷰 M-1 계약 보완 · 오케스트레이터 승인] 가장 최근에 성공한 PREVIEW 실행의
  // configVersion이 현재 configVersion과 다르면 true(재승인 없이 적재 못 함을 미리 알린다). 미리보기
  // 자체가 없으면 false(그 경우는 `needsPreview`/`PREVIEW_REQUIRED`로 따로 판단한다).
  previewStale: z.boolean(),
  rightsConfirmedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  // [신규 No.43 — 3차 보완 · 설계서 :1078] 저장(등록·수정) 응답에만 실린다(목록·단건 조회는 계산하지
  // 않는다 — 조회마다 비용을 들이지 않기 위해 `.optional()`).
  warnings: z.array(KbScopeWarningSchema).optional(),
});
export type KbSourceResponse = z.infer<typeof KbSourceResponseSchema>;

export const KbSourceListItemSchema = KbSourceResponseSchema.omit({ seedUrls: true, sitemapUrls: true, pathPrefixes: true, excludePatterns: true, noisePatterns: true });
export type KbSourceListItem = z.infer<typeof KbSourceListItemSchema>;

export const KbSourceListResponseSchema = paginated(KbSourceListItemSchema);
export type KbSourceListResponse = z.infer<typeof KbSourceListResponseSchema>;

export const KbDocumentViewSchema = z.object({
  id: z.string().uuid(),
  displayUrl: z.string(),
  kind: z.string(),
  state: KbDocumentState,
  excludeReason: KbExcludeReason.nullable(),
  cleanupReason: KbCleanupReason.nullable(),
  observedChange: z.enum(['NEW', 'CHANGED', 'UNCHANGED']).nullable(),
  title: z.string().nullable(),
  lastIngestedAt: z.coerce.date().nullable(),
  lastSeenAt: z.coerce.date(),
  consecutiveIngestFailures: z.number().int(),
  externalFileName: z.string().nullable(),
});
export type KbDocumentView = z.infer<typeof KbDocumentViewSchema>;

export const KbRunCreateSchema = z.object({ kind: KbRunKind, acknowledgeCleanup: z.boolean().optional() });
export type KbRunCreateDto = z.infer<typeof KbRunCreateSchema>;

export const KbApproveIngestSchema = z.object({ previewRunId: z.string().uuid() });
export type KbApproveIngestDto = z.infer<typeof KbApproveIngestSchema>;

export const KbDocumentListQuerySchema = PaginationQuerySchema.extend({
  state: csvEnumArray(KbDocumentState),
  cleanupOnly: queryBoolean(),
  runId: z.string().uuid().optional(),
  observedChange: csvEnumArray(z.enum(['NEW', 'CHANGED', 'UNCHANGED'])),
  excludeReason: csvEnumArray(KbExcludeReason),
});
export type KbDocumentListQuery = z.infer<typeof KbDocumentListQuerySchema>;

export const KbDocumentListResponseSchema = paginated(KbDocumentViewSchema);
export type KbDocumentListResponse = z.infer<typeof KbDocumentListResponseSchema>;

export const KbRunListQuerySchema = PaginationQuerySchema;
export type KbRunListQuery = z.infer<typeof KbRunListQuerySchema>;
export const KbRunListResponseSchema = paginated(KbRunViewSchema);
export type KbRunListResponse = z.infer<typeof KbRunListResponseSchema>;

export const KbMetaResponseSchema = z.object({
  enabled: z.literal(true),
  ragConfigured: z.boolean(),
  ingestAck: z.enum(['INTERNAL_NETWORK', 'AUTHENTICATED', 'TLS']).nullable(),
  ragReady: z.boolean().nullable(),
  ragCheckedAt: z.coerce.date().nullable(),
  htmlFormat: z.enum(['DOCX', 'TXT', 'HTML']),
  caps: z.object({ maxPages: z.number().int(), maxFileBytes: z.number().int() }),
  privateAllowlistConfigured: z.boolean(),
  governanceMode: z.enum(['OFF', 'ON']),
  rawFileIngestAllowedByServer: z.boolean(),
  bulkWindow: z.string().nullable(),
  failedSourceCount: z.number().int(),
  needsCleanupSourceCount: z.number().int(),
});
export type KbMetaResponse = z.infer<typeof KbMetaResponseSchema>;

export const ChatbotKbStatusResponseSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      lastRunStatus: KbRunDisplayStatus.nullable(),
      lastSyncedAt: z.coerce.date().nullable(),
      needsCleanupCount: z.number().int(),
    }),
  ),
  environmentModeOn: z.boolean(),
});
export type ChatbotKbStatusResponse = z.infer<typeof ChatbotKbStatusResponseSchema>;

/** 감사 스냅샷·목록 화면 라벨(값 비밀 필드 없음 — §13). */
export const KB_SOURCE_AUDIT_FIELDS = [
  'name',
  'seedUrls',
  'sitemapUrls',
  'pathPrefixes',
  'excludePatterns',
  'noisePatterns',
  'allowQueryUrls',
  'maxDepth',
  'maxPages',
  'fileTypes',
  'maxFileBytes',
  'minIntervalMs',
  'scopeCompany',
  'scopeCategory',
  'scopeSubcategory',
  'scheduleKind',
  'scheduleTime',
  'scheduleWeekday',
  'authKind',
  'authHeaderName',
  'authSecretRef',
  'piiMask',
  'allowRawFileIngest',
  'enabled',
  'configVersion',
] as const;
