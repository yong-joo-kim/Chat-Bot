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
  // 통계/분석(No.14~15) 그룹 추가 — 전부 선택(기본값 있음, FR-0-38). 하나도 설정하지 않아도 기동한다(AC-X-4).
  STATS_MAX_RANGE_DAYS: z.coerce.number().int().positive().default(92),
  STATS_MAX_RANGE_WEEKS: z.coerce.number().int().positive().default(53),
  STATS_MAX_RANGE_MONTHS: z.coerce.number().int().positive().default(24),
  STATS_TIMEZONE: z.string().default('Asia/Seoul'),
  UNANSWERED_MAX_PENDING: z.coerce.number().int().positive().default(5000),
  UNANSWERED_MAX_QUESTION_LENGTH: z.coerce.number().int().positive().default(200),
  INTENT_SUGGEST_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.25),
  LEARNING_BULK_MAX_ITEMS: z.coerce.number().int().positive().default(50),
  // FAQ/의도 매칭 고도화(NLU 1단계 + RAG 2단계) 그룹 추가 — 전부 선택(기본값 있음, FR-0-46).
  // 하나도 설정하지 않으면 두 단계가 모두 비활성이고 시스템은 현행 규칙 매칭으로 정상 기동한다(AC-N4-1).
  EMBEDDING_BASE_URL: z.string().optional(),
  EMBEDDING_TIMEOUT_MS: z.coerce.number().int().positive().default(300),
  EMBEDDING_CACHE_SIZE: z.coerce.number().int().positive().default(1000),
  EMBEDDING_CACHE_TTL_MS: z.coerce.number().int().positive().default(600000),
  EMBEDDING_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  VECTOR_CACHE_MAX_BYTES: z.coerce.number().int().positive().default(268435456),
  RAG_BASE_URL: z.string().optional(),
  // 하한 120000은 코드가 강제한다(FR-N2-26, AC-N2-14) — 여기서는 형식만 검증한다.
  RAG_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  RAG_MAX_CONCURRENCY: z.coerce.number().int().positive().default(5),
  RAG_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  RAG_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().positive().default(5),
  RAG_CIRCUIT_OPEN_MS: z.coerce.number().int().positive().default(60000),
  RAG_STATUS_CACHE_MS: z.coerce.number().int().positive().default(60000),
  PENDING_ANSWER_TTL_MS: z.coerce.number().int().positive().default(300000),
  // 학습 고도화(No.16 증강 · No.23 요소분해/경량 분류기) 그룹 추가 — 전부 선택(기본값 있음, FR-0-55).
  // 하나도 설정하지 않으면 G1 규칙 증강 + 분류기 비활성 + 형태소 분석기 휴리스틱 폴백으로 정상 기동한다.
  AUGMENTATION_PROVIDER: z.enum(['rule', 'gemini', 'local', 'mock']).default('rule'),
  AUGMENTATION_GEMINI_API_KEY: z.string().optional(),
  AUGMENTATION_GEMINI_MODEL: z.string().optional(),
  AUGMENTATION_GEMINI_BASE_URL: z.string().optional(),
  AUGMENTATION_LOCAL_BASE_URL: z.string().optional(),
  AUGMENTATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AUGMENTATION_MAX_SUGGESTIONS: z.coerce.number().int().positive().default(20),
  AUGMENTATION_MAX_PENDING: z.coerce.number().int().positive().default(500),
  AUGMENTATION_SUFFICIENT_EXAMPLES: z.coerce.number().int().positive().default(10),
  AUGMENTATION_KEEP_MIN: z.coerce.number().min(0).max(1).default(0.75),
  AUGMENTATION_KEEP_MAX: z.coerce.number().min(0).max(1).default(0.97),
  AUGMENTATION_NOVELTY_MAX: z.coerce.number().min(0).max(1).default(0.95),
  AUGMENTATION_SUGGESTION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  CLASSIFIER_ENABLED: z.coerce.boolean().default(false),
  CLASSIFIER_MIN_SAMPLES: z.coerce.number().int().positive().default(20),
  CLASSIFIER_MIN_PER_CLASS: z.coerce.number().int().positive().default(3),
  CLASSIFIER_MIN_CLASSES: z.coerce.number().int().positive().default(2),
  CLASSIFIER_MAX_MODEL_BYTES: z.coerce.number().int().positive().default(8388608),
  CLASSIFIER_MIN_PROBABILITY: z.coerce.number().min(0).max(1).default(0.15),
  MORPH_ANALYZER: z.string().default('auto'),
  MORPH_DICT_PATH: z.string().optional(),
});

/** `RAG_TIMEOUT_MS`의 하한(120,000ms)을 강제한다(FR-N2-26) — 미달 시 보정 + 경고 로그(AC-N2-14). */
const RAG_TIMEOUT_MS_FLOOR = 120_000;
const RAG_TIMEOUT_MS_CEIL = 300_000;

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validate(config: Record<string, unknown>): EnvConfig {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    // eslint-disable-next-line no-console
    console.error(`환경변수 검증 실패:\n${issues}`);
    throw new Error(`환경변수 검증 실패:\n${issues}`);
  }

  if (result.data.RAG_TIMEOUT_MS < RAG_TIMEOUT_MS_FLOOR) {
    // eslint-disable-next-line no-console
    console.warn(
      `RAG_TIMEOUT_MS(${result.data.RAG_TIMEOUT_MS}ms)가 하한(${RAG_TIMEOUT_MS_FLOOR}ms) 미만이라 자동 보정합니다(FR-N2-26).`,
    );
    result.data.RAG_TIMEOUT_MS = RAG_TIMEOUT_MS_FLOOR;
  } else if (result.data.RAG_TIMEOUT_MS > RAG_TIMEOUT_MS_CEIL) {
    result.data.RAG_TIMEOUT_MS = RAG_TIMEOUT_MS_CEIL;
  }

  return result.data;
}
