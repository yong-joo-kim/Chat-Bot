import { z } from 'zod';
import { PaginationQuerySchema, SafeUrlSchema, csvEnumArray } from './common';

/**
 * [No.26] 레거시 API 연동 — 연결 레지스트리 · 호출 로그 · 시뮬레이터 확장 계약.
 * `docs/02-spec/legacy-api-integration-설계.md` §4.4 근거. 의존 방향: `legacy-api.ts → common.ts`
 * 단방향(위젯 비유입). `conversation.ts`가 이 파일을 가져다 쓴다(`conversation.ts → legacy-api.ts`).
 */

export const ApiConnectionAuthType = z.enum(['NONE', 'API_KEY_HEADER', 'BEARER', 'BASIC']);
export type ApiConnectionAuthType = z.infer<typeof ApiConnectionAuthType>;

export const ApiHttpMethod = z.enum(['GET', 'POST']);
export type ApiHttpMethod = z.infer<typeof ApiHttpMethod>;

/** 결과 코드 18종(§7.8) — 요구사항 FR-L5-10의 16종에 `CONNECTION_MISSING`·`METHOD_NOT_ALLOWED` 2종 추가(§21 D-7). */
export const ApiCallOutcome = z.enum([
  'SUCCESS',
  'MAPPING_MISSING',
  'HTTP_ERROR',
  'TIMEOUT',
  'NETWORK_ERROR',
  'INVALID_RESPONSE',
  'RESPONSE_TOO_LARGE',
  'REDIRECT_NOT_ALLOWED',
  'BLOCKED_ADDRESS',
  'BLOCKED_URL',
  'CIRCUIT_OPEN',
  'RATE_LIMITED',
  'CONNECTION_DISABLED',
  'CONNECTION_MISSING',
  'METHOD_NOT_ALLOWED',
  'SECRET_MISSING',
  'BINDING_MISSING',
  'FEATURE_DISABLED',
  // 데이터 거버넌스(No.45) 그룹 추가(data-governance-설계.md §6.5, ADR-0040) — 18 → 19종.
  // 출구 허용 목록 밖 호스트로의 호출을 DNS 조회 전에 차단한 결과.
  'EGRESS_BLOCKED',
]);
export type ApiCallOutcome = z.infer<typeof ApiCallOutcome>;

export const ApiCallSource = z.enum(['PUBLIC', 'SIMULATION_LIVE', 'CONNECTION_TEST']);
export type ApiCallSource = z.infer<typeof ApiCallSource>;

export const ApiCallBranch = z.enum(['CONDITION', 'DEFAULT', 'FAILURE', 'NOTICE']);
export type ApiCallBranch = z.infer<typeof ApiCallBranch>;

export const ApiSecretStatus = z.enum(['NOT_REQUIRED', 'CONFIGURED', 'MISSING']);
export type ApiSecretStatus = z.infer<typeof ApiSecretStatus>;

/* ------------------------------------------------------------------------------------------------
 * 상수(§3.5 후반 · FR-L2-*)
 * ---------------------------------------------------------------------------------------------- */

export const API_CONNECTION_LIMITS = {
  nameMaxLength: 50,
  descriptionMaxLength: 300,
  samplesMax: 5,
  sampleBodyBytesMax: 16_384,
  sampleLabelMaxLength: 50,
  rateLimitMin: 1,
  rateLimitMax: 600,
  rateLimitDefault: 120,
  rateLimitPersonalDataDefault: 30,
  timeoutMsMin: 1000,
  timeoutMsMax: 10_000,
  timeoutMsDefault: 3000,
  concurrencyPerConnection: 10,
  concurrencyGlobal: 50,
  secretRefPattern: /^[A-Z0-9_]{1,40}$/,
  authHeaderNamePattern: /^[A-Za-z0-9-]{1,64}$/,
  forbiddenHeaderNames: [
    'host',
    'content-length',
    'content-type',
    'cookie',
    'set-cookie',
    'transfer-encoding',
    'connection',
    'accept',
    'user-agent',
    'te',
    'upgrade',
  ] as readonly string[],
  forbiddenHeaderPrefixes: ['proxy-', 'x-forwarded-'] as readonly string[],
} as const;

export function isForbiddenHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  if (API_CONNECTION_LIMITS.forbiddenHeaderNames.includes(lower)) return true;
  return API_CONNECTION_LIMITS.forbiddenHeaderPrefixes.some((p) => lower.startsWith(p));
}

/* ------------------------------------------------------------------------------------------------
 * 연결 CRUD — §4.4 · §12.1
 * ---------------------------------------------------------------------------------------------- */

export const ApiSampleResponseSchema = z
  .object({
    label: z.string().trim().min(1, '라벨을 입력해 주세요.').max(API_CONNECTION_LIMITS.sampleLabelMaxLength),
    httpStatus: z.number().int().min(100).max(599),
    body: z.unknown(),
  })
  .superRefine((val, ctx) => {
    if (typeof val.body !== 'object' || val.body === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '샘플 본문은 JSON 객체 또는 배열이어야 합니다.', path: ['body'] });
      return;
    }
    let bytes = 0;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(val.body)).length;
    } catch {
      bytes = Number.POSITIVE_INFINITY;
    }
    if (bytes > API_CONNECTION_LIMITS.sampleBodyBytesMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `샘플 본문은 최대 ${API_CONNECTION_LIMITS.sampleBodyBytesMax}바이트까지 입력할 수 있습니다.`,
        path: ['body'],
      });
    }
  });
export type ApiSampleResponse = z.infer<typeof ApiSampleResponseSchema>;

/** `baseUrl` 저장 규칙 — 사용자정보·쿼리·프래그먼트 금지(§7.2). 스킴은 http도 허용하되 서비스가 `insecureHttp`로 경고한다. */
export const ApiConnectionBaseUrlSchema = SafeUrlSchema.superRefine((v, ctx) => {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '올바른 URL 형식이 아닙니다.' });
    return;
  }
  if (u.username || u.password) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL에 사용자 정보를 포함할 수 없습니다.' });
  }
  if (u.search) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL에 쿼리 문자열을 포함할 수 없습니다.' });
  }
  if (u.hash) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'URL에 프래그먼트를 포함할 수 없습니다.' });
  }
  const lowerPath = u.pathname.toLowerCase();
  if (lowerPath.includes('%2e') || lowerPath.includes('..') || lowerPath.includes('//')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '기준 경로에 상대 경로 이탈 문자를 포함할 수 없습니다.' });
  }
});

function checkConnectionMethodsAuth(
  val: {
    allowedMethods: ApiHttpMethod[];
    authType: ApiConnectionAuthType;
    authHeaderName?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (new Set(val.allowedMethods).size !== val.allowedMethods.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '허용 메서드가 중복됩니다.', path: ['allowedMethods'] });
  }
  if (val.authType === 'API_KEY_HEADER' && !val.authHeaderName) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'API 키 헤더 방식은 헤더 이름이 필요합니다.', path: ['authHeaderName'] });
  }
  if (val.authHeaderName && isForbiddenHeaderName(val.authHeaderName)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '사용할 수 없는 헤더 이름입니다.', path: ['authHeaderName'] });
  }
}

export const CreateApiConnectionSchema = z
  .object({
    name: z.string().trim().min(1, '이름을 입력해 주세요.').max(API_CONNECTION_LIMITS.nameMaxLength),
    description: z.string().max(API_CONNECTION_LIMITS.descriptionMaxLength).optional(),
    baseUrl: ApiConnectionBaseUrlSchema,
    allowedMethods: z.array(ApiHttpMethod).min(1).max(2),
    authType: ApiConnectionAuthType.default('NONE'),
    authHeaderName: z.string().regex(API_CONNECTION_LIMITS.authHeaderNamePattern).optional(),
    secretRef: z.string().regex(API_CONNECTION_LIMITS.secretRefPattern).optional(),
    timeoutMs: z.number().int().min(API_CONNECTION_LIMITS.timeoutMsMin).max(API_CONNECTION_LIMITS.timeoutMsMax).optional(),
    rateLimitPerMin: z.number().int().min(API_CONNECTION_LIMITS.rateLimitMin).max(API_CONNECTION_LIMITS.rateLimitMax).optional(),
    allowRawPersonalData: z.boolean().default(false),
    personalDataLookup: z.boolean().default(false),
    sampleResponses: z.array(ApiSampleResponseSchema).max(API_CONNECTION_LIMITS.samplesMax).default([]),
    enabled: z.boolean().default(true),
    /** `allowRawPersonalData=true`로 생성할 때만 연결 이름 재입력이 필요하다(서비스가 `CONFIRM_NAME_MISMATCH`로 검사). */
    confirmRawPersonalData: z.string().max(200).optional(),
  })
  .superRefine((val, ctx) => {
    checkConnectionMethodsAuth(val, ctx);
    if (val.authType !== 'NONE' && !val.secretRef) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '인증 방식을 사용하려면 시크릿 참조 이름이 필요합니다.', path: ['secretRef'] });
    }
  });
export type CreateApiConnectionDto = z.infer<typeof CreateApiConnectionSchema>;

export const UpdateApiConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(API_CONNECTION_LIMITS.nameMaxLength).optional(),
    description: z.string().max(API_CONNECTION_LIMITS.descriptionMaxLength).nullable().optional(),
    baseUrl: ApiConnectionBaseUrlSchema.optional(),
    allowedMethods: z.array(ApiHttpMethod).min(1).max(2).optional(),
    authType: ApiConnectionAuthType.optional(),
    authHeaderName: z.string().regex(API_CONNECTION_LIMITS.authHeaderNamePattern).nullable().optional(),
    secretRef: z.string().regex(API_CONNECTION_LIMITS.secretRefPattern).nullable().optional(),
    timeoutMs: z.number().int().min(API_CONNECTION_LIMITS.timeoutMsMin).max(API_CONNECTION_LIMITS.timeoutMsMax).optional(),
    rateLimitPerMin: z.number().int().min(API_CONNECTION_LIMITS.rateLimitMin).max(API_CONNECTION_LIMITS.rateLimitMax).optional(),
    allowRawPersonalData: z.boolean().optional(),
    personalDataLookup: z.boolean().optional(),
    sampleResponses: z.array(ApiSampleResponseSchema).max(API_CONNECTION_LIMITS.samplesMax).optional(),
    enabled: z.boolean().optional(),
    confirmRawPersonalData: z.string().max(200).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.authHeaderName && isForbiddenHeaderName(val.authHeaderName)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '사용할 수 없는 헤더 이름입니다.', path: ['authHeaderName'] });
    }
    if (val.allowedMethods && new Set(val.allowedMethods).size !== val.allowedMethods.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '허용 메서드가 중복됩니다.', path: ['allowedMethods'] });
    }
  });
export type UpdateApiConnectionDto = z.infer<typeof UpdateApiConnectionSchema>;

export const ApiConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  baseUrl: z.string(),
  allowedMethods: z.array(ApiHttpMethod),
  authType: ApiConnectionAuthType,
  authHeaderName: z.string().nullable(),
  secretRef: z.string().nullable(),
  timeoutMs: z.number().int(),
  rateLimitPerMin: z.number().int(),
  allowRawPersonalData: z.boolean(),
  personalDataLookup: z.boolean(),
  sampleResponses: z.array(ApiSampleResponseSchema),
  enabled: z.boolean(),
  secretStatus: ApiSecretStatus,
  insecureHttp: z.boolean(),
  circuitOpen: z.boolean(),
  referencingNodeCount: z.number().int().nonnegative(),
  stats24h: z.object({ calls: z.number().int().nonnegative(), failures: z.number().int().nonnegative() }),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ApiConnection = z.infer<typeof ApiConnectionSchema>;

export const ApiConnectionListItemSchema = ApiConnectionSchema.omit({ sampleResponses: true }).extend({
  sampleCount: z.number().int().nonnegative(),
  baseUrlHost: z.string(),
});
export type ApiConnectionListItem = z.infer<typeof ApiConnectionListItemSchema>;

export const ApiConnectionListResponseSchema = z.object({ items: z.array(ApiConnectionListItemSchema) });
export type ApiConnectionListResponse = z.infer<typeof ApiConnectionListResponseSchema>;

/** URL·시크릿 참조·인증 방식을 포함하지 않는다(FR-L2-1) — 편집기 선택 목록·시뮬레이터 목 원천용. */
export const ApiConnectionPickerItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  allowedMethods: z.array(ApiHttpMethod),
  enabled: z.boolean(),
  personalDataLookup: z.boolean(),
  allowRawPersonalData: z.boolean(),
  sampleLabels: z.array(z.string()),
});
export type ApiConnectionPickerItem = z.infer<typeof ApiConnectionPickerItemSchema>;

export const ApiConnectionPickerResponseSchema = z.object({ items: z.array(ApiConnectionPickerItemSchema) });
export type ApiConnectionPickerResponse = z.infer<typeof ApiConnectionPickerResponseSchema>;

export const ApiConnectionSamplesResponseSchema = z.object({ items: z.array(ApiSampleResponseSchema) });
export type ApiConnectionSamplesResponse = z.infer<typeof ApiConnectionSamplesResponseSchema>;

/* ------------------------------------------------------------------------------------------------
 * 연결 테스트 — §7.9
 * ---------------------------------------------------------------------------------------------- */

export const ApiConnectionTestRequestSchema = z.object({
  path: z
    .string()
    .max(300)
    .default('/')
    .refine((v) => v.startsWith('/'), { message: '경로는 "/"로 시작해야 합니다.' })
    .refine((v) => !v.includes('{') && !v.includes('}'), { message: '연결 테스트 경로에는 자리표시자를 사용할 수 없습니다.' })
    .refine((v) => /^[A-Za-z0-9\-._~/!$&'()*+,;=:@]*$/.test(v), { message: '경로에 허용되지 않는 문자가 포함되어 있습니다.' })
    .refine((v) => !v.includes('//'), { message: '경로에 연속된 슬래시를 사용할 수 없습니다.' })
    .refine((v) => !v.split('/').some((seg) => seg === '..'), { message: '경로에 상위 경로(..)를 사용할 수 없습니다.' }),
});
export type ApiConnectionTestRequestDto = z.infer<typeof ApiConnectionTestRequestSchema>;

export const ApiConnectionTestResultSchema = z.object({
  outcome: ApiCallOutcome,
  httpStatus: z.number().int().optional(),
  latencyMs: z.number().int().nonnegative(),
  contentType: z.string().optional(),
  bytes: z.number().int().nonnegative().optional(),
  jsonParsable: z.boolean(),
  blockedAddress: z.string().optional(),
  guidance: z.string(),
});
export type ApiConnectionTestResult = z.infer<typeof ApiConnectionTestResultSchema>;

/* ------------------------------------------------------------------------------------------------
 * 엔진 입력 — ApiCallResult(zod 무의존 TS 타입, §5.1)
 * ---------------------------------------------------------------------------------------------- */

export type ApiCallResult =
  | { kind: 'SUCCESS'; httpStatus: number; json: unknown }
  | { kind: 'FAILURE'; outcome: Exclude<ApiCallOutcome, 'SUCCESS' | 'MAPPING_MISSING'>; httpStatus?: number };

/* ------------------------------------------------------------------------------------------------
 * 호출 로그 — §9.2 · §12.2
 * ---------------------------------------------------------------------------------------------- */

export const ApiCallLogItemSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.coerce.date(),
  connectionId: z.string().uuid(),
  connectionName: z.string(),
  nodeId: z.string().uuid().nullable().optional(),
  conversationLogId: z.string().uuid().nullable().optional(),
  source: ApiCallSource,
  method: ApiHttpMethod,
  pathTemplate: z.string(),
  outcome: ApiCallOutcome,
  httpStatus: z.number().int().nullable().optional(),
  latencyMs: z.number().int().nonnegative(),
  responseBytes: z.number().int().nonnegative().nullable().optional(),
  branch: ApiCallBranch.nullable().optional(),
  conditionIndex: z.number().int().nullable().optional(),
  personalDataMasked: z.boolean(),
});
export type ApiCallLogItem = z.infer<typeof ApiCallLogItemSchema>;

export const ApiCallLogListQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'from은 YYYY-MM-DD 형식이어야 합니다.')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'to는 YYYY-MM-DD 형식이어야 합니다.')
    .optional(),
  connectionId: z.string().uuid().optional(),
  outcome: csvEnumArray(ApiCallOutcome),
  source: csvEnumArray(ApiCallSource),
});
export type ApiCallLogListQuery = z.infer<typeof ApiCallLogListQuerySchema>;

export const ApiCallLogSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  byOutcome: z.record(ApiCallOutcome, z.number().int().nonnegative()),
  p95LatencyMs: z.number().int().nonnegative(),
  byConnection: z.array(
    z.object({
      connectionId: z.string().uuid(),
      connectionName: z.string(),
      total: z.number().int().nonnegative(),
      failures: z.number().int().nonnegative(),
    }),
  ),
});
export type ApiCallLogSummary = z.infer<typeof ApiCallLogSummarySchema>;

export const API_CALL_LOG_LIMITS = { maxRangeDays: 92 } as const;

/* ------------------------------------------------------------------------------------------------
 * 시뮬레이터 확장 — §6.2, `conversation.ts`가 재사용
 * ---------------------------------------------------------------------------------------------- */

export const SimulateApiMode = z.enum(['MOCK', 'LIVE']);
export type SimulateApiMode = z.infer<typeof SimulateApiMode>;

export const SimulateMockResponseSchema = z.union([
  z.object({ sampleLabel: z.string().min(1).max(API_CONNECTION_LIMITS.sampleLabelMaxLength) }),
  z.object({ httpStatus: z.number().int().min(100).max(599), body: z.unknown() }),
  z.object({ failure: ApiCallOutcome }),
]);
export type SimulateMockResponse = z.infer<typeof SimulateMockResponseSchema>;

export const ApiStepVariableSchema = z.object({ name: z.string(), value: z.string() });

export const ApiStepViewSchema = z.object({
  mode: SimulateApiMode,
  downgradeReason: z.string().optional(),
  connectionId: z.string().uuid(),
  connectionName: z.string(),
  method: ApiHttpMethod,
  pathTemplate: z.string(),
  outcome: ApiCallOutcome,
  httpStatus: z.number().int().optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  branch: ApiCallBranch,
  conditionIndex: z.number().int().optional(),
  sampleLabel: z.string().optional(),
  /** MOCK에서 요청한 라벨의 샘플이 연결에 없어 실패 분기를 재현했을 때 true. */
  noSample: z.boolean().optional(),
  variables: z.array(ApiStepVariableSchema),
});
export type ApiStepView = z.infer<typeof ApiStepViewSchema>;
