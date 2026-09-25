import { z } from 'zod';
import { envBoolean } from './lib/env-boolean';

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
  // [K-1, 하이브리드 CS 설계서 §2.6·§3.4] 폴링 전용 IP 버킷 — 보류 답변·상담 폴링 공용. 기존
  // ip/session 버킷과 별개다(폴링이 일반 전송 버킷을 소진하지 않게 하는 것이 이 변수의 목적).
  PUBLIC_POLL_RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(600),
  TRUST_PROXY: envBoolean(false),
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
  AUTH_COOKIE_SECURE: envBoolean(false),
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
  // 배치(2건 이상) 임베딩 전용 — 재색인·TC 실행 등 관리자 경로. 대화 예산(EMBEDDING_TIMEOUT_MS)과 분리한다.
  EMBEDDING_BATCH_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
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
  CLASSIFIER_ENABLED: envBoolean(false),
  CLASSIFIER_MIN_SAMPLES: z.coerce.number().int().positive().default(20),
  CLASSIFIER_MIN_PER_CLASS: z.coerce.number().int().positive().default(3),
  CLASSIFIER_MIN_CLASSES: z.coerce.number().int().positive().default(2),
  CLASSIFIER_MAX_MODEL_BYTES: z.coerce.number().int().positive().default(8388608),
  CLASSIFIER_MIN_PROBABILITY: z.coerce.number().min(0).max(1).default(0.15),
  MORPH_ANALYZER: z.string().default('auto'),
  MORPH_DICT_PATH: z.string().optional(),
  // 검증/품질 고도화(No.19 대화검증시스템·TC테스트 / No.20 학습영향도 TEST) 그룹 추가 — 전부 선택
  // (기본값 있음, FR-0-64). 하나도 설정하지 않으면 세트 2,000 TC·챗봇 5,000 TC·배치 64·외부 RAG
  // 비활성·보존 20+pin 5로 정상 동작한다. ml-worker 변수 추가는 0건이다.
  TEST_SET_MAX_CASES: z.coerce.number().int().positive().default(2000),
  TEST_CASE_MAX_PER_CHATBOT: z.coerce.number().int().positive().default(5000),
  TEST_RUN_MAX_CASES: z.coerce.number().int().positive().default(2000),
  TEST_RUN_EMBED_BATCH_SIZE: z.coerce.number().int().positive().default(64),
  TEST_RUN_RAG_MAX_CALLS: z.coerce.number().int().positive().default(50),
  TEST_RUN_RETENTION_PER_SET: z.coerce.number().int().positive().default(20),
  TEST_RUN_PINNED_MAX: z.coerce.number().int().positive().default(5),
  TEST_RUN_PROGRESS_MIN_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  // 챗봇 복원/버전 이력관리(No.25) 그룹 추가 — 전부 선택(기본값 있음, FR-0-74). 하나도 설정하지
  // 않으면 자동 스냅샷 활성·보존 자동30/수동30/고정10·1건 20MB·챗봇당 300MB·트랜잭션 timeout 30초로
  // 정상 동작한다(AC-H4-8). ml-worker 변수 추가는 0건이다.
  VERSION_AUTO_SNAPSHOT_ENABLED: envBoolean(true),
  VERSION_RETENTION_AUTO: z.coerce.number().int().min(1).default(30),
  VERSION_RETENTION_MANUAL: z.coerce.number().int().min(1).default(30),
  VERSION_PINNED_MAX: z.coerce.number().int().min(0).default(10),
  VERSION_SNAPSHOT_MAX_BYTES: z.coerce.number().int().min(1_048_576).default(20_971_520),
  VERSION_TOTAL_MAX_BYTES_PER_CHATBOT: z.coerce.number().int().min(1_048_576).default(314_572_800),
  VERSION_TX_TIMEOUT_MS: z.coerce.number().int().min(5000).default(30000),
  // 운영 예약 배포(No.28) 그룹 추가 — 전부 선택(기본값 있음, FR-0-83). 하나도 설정하지 않아도
  // 정상 기동·동작한다(폴링 30초·유예 10분·재시도 창 15분·임대 5분). ml-worker 변수 추가는 0건이다.
  DEPLOY_SCHEDULE_ENABLED: envBoolean(true),
  DEPLOY_SCHEDULE_POLL_INTERVAL_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  DEPLOY_SCHEDULE_MISFIRE_GRACE_MINUTES: z.coerce.number().int().min(0).max(1440).default(10),
  DEPLOY_SCHEDULE_RETRY_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  DEPLOY_SCHEDULE_LEASE_MINUTES: z.coerce.number().int().min(1).default(5),
  // 레거시 API 연동(No.26) 그룹 추가 — 전부 선택(기본값 있음, FR-0-103). 하나도 설정하지 않으면
  // 활성화·타임아웃 3초(상한 10초)·응답 256KB·회로 5회/60초·사설 대역 allowlist 빈 값(구축형은
  // 운영자가 채운다)으로 정상 동작한다. 연결 시크릿 전용 환경변수(접두사 규약, `legacy-api-secret
  // .resolver.ts` 참고)는 여기에 등록하지 않는다 — zod 스키마는 알 수 없는 키를 걸러 내므로
  // 검증 대상이 될 수 없고, 그 리졸버가 `process.env`에서 직접 읽는다(정적 검사 L-1).
  LEGACY_API_ENABLED: envBoolean(true),
  LEGACY_API_PRIVATE_ALLOWLIST: z.string().default(''),
  LEGACY_API_DEFAULT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(10000).default(3000),
  LEGACY_API_MAX_TIMEOUT_MS: z.coerce.number().int().min(1000).max(10000).default(10000),
  LEGACY_API_MAX_RESPONSE_BYTES: z.coerce.number().int().min(1024).max(1048576).default(262144),
  LEGACY_API_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).default(5),
  LEGACY_API_CIRCUIT_OPEN_MS: z.coerce.number().int().min(1000).default(60000),
  // 하이브리드 CS(No.24) 그룹 추가 — 전부 선택(기본값 있음, FR-0-128). 기동 조건 아님(ADR-0036 §3.4).
  // 원문 절대 상한(HANDOFF_RAW_TEXT_MAX_AGE_MS)·정리 루프 주기·보류 답변 키 버킷 상한은 코드
  // 상수다(환경변수 아님 — 설계서 §3.4).
  PUBLIC_HANDOFF_POLL_RATE_LIMIT_SESSION_PER_MIN: z.coerce.number().int().positive().default(40),
  HANDOFF_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  HANDOFF_WATCH_WINDOW_MS: z.coerce.number().int().positive().default(180000),
  HANDOFF_WATCH_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  // [코드리뷰 2회차 M-1] 정리 루프(60초) 자동 기동 스위치 — `DEPLOY_SCHEDULE_ENABLED` 선례와 동일한
  // 형식. 운영 기본값은 true, 시험 기본값은 jest.isolate-env.js가 false로 고정한다.
  HANDOFF_SWEEPER_ENABLED: envBoolean(true),
  // 피드백 기반 개선 루프(No.44) 그룹 추가 — 전부 선택(기본값 있음, FR-0-148). 기동 조건 아님.
  // 기능 스위치는 환경변수가 아니라 챗봇별 WEB 채널 설정이다(기본 꺼짐, §5).
  PUBLIC_FEEDBACK_RATE_LIMIT_IP_PER_MIN: z.coerce.number().int().positive().default(120),
  PUBLIC_FEEDBACK_RATE_LIMIT_MESSAGE_PER_MIN: z.coerce.number().int().positive().default(10),
  FEEDBACK_CHANGE_WINDOW_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  FEEDBACK_MAX_CHANGES: z.coerce.number().int().min(0).max(20).default(5),
  FEEDBACK_QUEUE_MAX_PENDING: z.coerce.number().int().positive().default(2000),
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

  // No.25 §15 — 총량 상한이 1건 상한보다 작으면 기동은 계속하되 경고만 남긴다(기동 실패 아님).
  if (result.data.VERSION_TOTAL_MAX_BYTES_PER_CHATBOT < result.data.VERSION_SNAPSHOT_MAX_BYTES) {
    // eslint-disable-next-line no-console
    console.warn('VERSION_TOTAL_MAX_BYTES_PER_CHATBOT이 VERSION_SNAPSHOT_MAX_BYTES보다 작습니다. 값을 다시 확인해 주세요.');
  }

  // 운영 예약 배포(No.28) §7.8 — 임대(lease)는 실행 최장 시간(준비 + 복원 트랜잭션 2×timeout + 여유
  // 60초)보다 길어야 한다. 미달이면 기동 실패로 만들지 않고 하한으로 상향 보정한다(경고만).
  const leaseFloorMs = 2 * result.data.VERSION_TX_TIMEOUT_MS + 60_000;
  if (result.data.DEPLOY_SCHEDULE_LEASE_MINUTES * 60_000 < leaseFloorMs) {
    const floorMinutes = Math.ceil(leaseFloorMs / 60_000);
    // eslint-disable-next-line no-console
    console.warn(
      `DEPLOY_SCHEDULE_LEASE_MINUTES(${result.data.DEPLOY_SCHEDULE_LEASE_MINUTES}분)가 실행 최장 시간 기준 하한(${floorMinutes}분) 미만이라 자동 보정합니다.`,
    );
    result.data.DEPLOY_SCHEDULE_LEASE_MINUTES = floorMinutes;
  }

  // 운영 예약 배포(No.28) J-12 — STATS_TIMEZONE이 Intl이 거부하는 값이면 기동 실패가 아니라 경고만
  // 남긴다. 예약 표시는 요청 시점에 'Asia/Seoul'로 폴백한다(GET /deploy-schedules/meta.timezoneFallback).
  try {
    Intl.DateTimeFormat(undefined, { timeZone: result.data.STATS_TIMEZONE });
  } catch {
    // eslint-disable-next-line no-console
    console.warn(`STATS_TIMEZONE(${result.data.STATS_TIMEZONE})이 유효한 IANA 시간대가 아닙니다. 예약 표시는 Asia/Seoul로 대체됩니다.`);
  }

  return result.data;
}
