import { z } from 'zod';

/**
 * 부팅 시 필수 환경변수를 검증한다(NFR-M1, EX-4-3).
 * 배포형태(구축형/구독형) 중립을 위해 위젯/공개 API base URL은 반드시 환경변수로만 주입하며,
 * 누락 시 런타임 500이 아니라 기동 실패로 즉시 드러나야 한다.
 */
const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL이 설정되지 않았습니다.'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  WIDGET_BASE_URL: z
    .string()
    .min(1, 'WIDGET_BASE_URL이 설정되지 않았습니다.')
    .refine((v) => /^https?:\/\//i.test(v), 'WIDGET_BASE_URL은 http 또는 https로 시작해야 합니다.'),
  PUBLIC_API_BASE_URL: z
    .string()
    .min(1, 'PUBLIC_API_BASE_URL이 설정되지 않았습니다.')
    .refine((v) => /^https?:\/\//i.test(v), 'PUBLIC_API_BASE_URL은 http 또는 https로 시작해야 합니다.'),
  // 품질/채널(No.10~11) 그룹 추가 — 전부 선택(기본값 있음), 기동 실패 조건을 늘리지 않는다(NFR-M6).
  PUBLIC_RATE_LIMIT_SESSION_PER_MIN: z.coerce.number().int().positive().default(30),
  PUBLIC_RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(120),
  TRUST_PROXY: z.coerce.boolean().default(false),
  DIALOGUE_BUNDLE_CACHE_TTL_MS: z.coerce.number().int().positive().default(60000),
  // 보안/이력(No.12~13) 그룹 추가 — 전부 선택(기본값 있음, FR-0-30). 부트스트랩 계정 변수는
  // seed 전용이라 이 스키마 대상이 아니다(API 기동 조건이 되어서는 안 된다).
  SESSION_IDLE_TIMEOUT_MIN: z.coerce.number().int().positive().default(120),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(12),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MIN: z.coerce.number().int().positive().default(15),
  LOGIN_RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(20),
  AUDIT_QUERY_MAX_RANGE_DAYS: z.coerce.number().int().positive().default(90),
  BANNED_WORD_CACHE_TTL_MS: z.coerce.number().int().positive().default(60000),
  AUTH_COOKIE_SECURE: z.coerce.boolean().default(false),
  ADMIN_WEB_ORIGIN: z.string().optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validate(config: Record<string, unknown>): EnvConfig {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`환경변수 검증 실패:\n${issues}`);
    throw new Error(`환경변수 검증 실패:\n${issues}`);
  }
  return result.data;
}
