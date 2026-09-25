import { z } from 'zod';
import { PaginationQuerySchema, csvEnumArray, queryBoolean } from './common';
import { RestoreBlockerSchema, RestoreWarningSchema, VersionDiffSummarySchema } from './version';
import { ChatbotStatus } from './chatbot';
import { GateEvaluationSchema, ProdSwitchWarningSchema } from './environment';

/**
 * 운영 예약 배포(No.28) — `scheduled-deploy-설계.md` §3, ADR-0032.
 * 의존: `deploy-schedule.ts → common · security(Permission) · version(RestorePreviewResponse류) ·
 * chatbot(ChatbotStatus)`(단방향). 역방향 import 없음.
 */

/* ------------------------------------------------------------------------------------------------
 * 동작·상태·결과 유니온 — 판별값 단일 소스
 * ---------------------------------------------------------------------------------------------- */

export const DeployScheduleAction = z.enum(['RESTORE_VERSION', 'PUBLISH', 'SET_WEB_CHANNEL', 'SWITCH_PROD_VERSION']);
export type DeployScheduleAction = z.infer<typeof DeployScheduleAction>;

export const DEPLOY_SCHEDULE_ACTION_LABELS: Record<DeployScheduleAction, string> = {
  RESTORE_VERSION: '버전 복원',
  PUBLISH: '공개 시작',
  SET_WEB_CHANNEL: '웹 채널 열기/닫기',
  // [신규 No.40] 환경 분리 — 운영 버전 전환.
  SWITCH_PROD_VERSION: '운영 버전 전환',
};

export const DeployScheduleStatus = z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'MISSED', 'HELD', 'CANCELLED']);
export type DeployScheduleStatus = z.infer<typeof DeployScheduleStatus>;

export const DEPLOY_SCHEDULE_STATUS_LABELS: Record<DeployScheduleStatus, string> = {
  PENDING: '대기',
  RUNNING: '실행 중',
  SUCCEEDED: '성공',
  FAILED: '실패',
  MISSED: '누락',
  HELD: '보류',
  CANCELLED: '취소',
};

/** 한도·간격·보존 보호·삭제 409 공용(§4.2 판단). */
export const DEPLOY_SCHEDULE_ACTIVE_STATUSES = ['PENDING', 'HELD', 'RUNNING'] as const;
/** "확인 필요" 배지 판정(FR-D6-2). */
export const DEPLOY_SCHEDULE_ATTENTION_STATUSES = ['FAILED', 'MISSED', 'HELD'] as const;

export const DeployScheduleOutcome = z.enum(['APPLIED', 'NOOP', 'RECOVERED']);
export type DeployScheduleOutcome = z.infer<typeof DeployScheduleOutcome>;

/** §21 D-5 — 요구사항 11종 + `BACKUP_TOO_LARGE`(복원 직전 백업 20MB 초과) = 12종. */
export const DeployScheduleFailureReason = z.enum([
  'STATE_CHANGED',
  'TARGET_VERSION_MISSING',
  'INTEGRITY_FAILED',
  'SCHEMA_UNSUPPORTED',
  'BACKUP_TOO_LARGE',
  'CHATBOT_ARCHIVED',
  'CHATBOT_NOT_FOUND',
  'INVALID_TRANSITION',
  'CREATOR_NOT_AUTHORIZED',
  'BLOCKED_TOO_LONG',
  'INTERRUPTED',
  'INTERNAL_ERROR',
  // [신규 No.40] 실행 시 차단 게이트 재평가 미달 — 영구(재시도 없음).
  'GATE_NOT_PASSED',
]);
export type DeployScheduleFailureReason = z.infer<typeof DeployScheduleFailureReason>;

export const DeployScheduleTransientReason = z.enum(['DB_BUSY', 'ACTIVE_JOB', 'RESTORE_LOCKED']);
export type DeployScheduleTransientReason = z.infer<typeof DeployScheduleTransientReason>;

/** `PREDECESSOR_HELD` 추가(§21 D-5) — 보류가 해제되지 않은 선행이 있는 채로 도래한 경우.
 * [신규 No.40] `ENV_MODE_CHANGED` — 모드 켜기 시 활성 RESTORE_VERSION 예약이 보류된다(C-4). */
export const DeployScheduleHeldReason = z.enum(['PREDECESSOR_FAILED', 'PREDECESSOR_MISSED', 'PREDECESSOR_CANCELLED', 'PREDECESSOR_HELD', 'ENV_MODE_CHANGED']);
export type DeployScheduleHeldReason = z.infer<typeof DeployScheduleHeldReason>;

export const DeploySchedulePreconditionReason = z.enum([
  'RESTORE_BLOCKED',
  'RESTORE_NO_CHANGES',
  'CHAIN_ORDER',
  'ORDER_CHANGE',
  'ALREADY_ACTIVE',
  'DUPLICATE_PUBLISH',
  'TEST_SET_INVALID',
  'TEST_SET_NOT_APPLICABLE',
  /**
   * [신규 No.40] 운영 전환 미리보기(`switchProd`)가 blocker를 낸 상태에서 예약을 생성하려는 경우.
   * `RESTORE_BLOCKED`와 같은 2단 구조다 — 생성 409의 `details[].message`는 항상 이 일반 코드뿐이고
   * (개별 사유를 담지 않는다), 개별 사유는 `POST .../deploy-schedules/preview` 응답의
   * `switchProd.blockers`(열거형 배열)에서 읽는다 — 콘솔은 생성 이전에 그 미리보기를 이미 렌더링해
   * 두었어야 한다(같은 화면 흐름).
   */
  'SWITCH_BLOCKED',
]);
export type DeploySchedulePreconditionReason = z.infer<typeof DeploySchedulePreconditionReason>;

/** FE/BE 공용 코드 상수 단일 소스(요구사항 §5.5 — 환경변수로 만들지 않는다). */
export const DEPLOY_SCHEDULE_LIMITS = {
  minLeadMinutes: 5,
  maxHorizonDays: 90,
  minSpacingMinutes: 1,
  maxActivePerChatbot: 5,
  memoMaxCodePoints: 200,
  longHorizonWarnDays: 30,
  listPageSizeDefault: 20,
  listPageSizeMax: 100,
} as const;

/* ------------------------------------------------------------------------------------------------
 * 동작별 params(저장 JSON 형태 = API 형태) — 식별자·불리언만(NFR-DS4)
 * ---------------------------------------------------------------------------------------------- */

export const RestoreVersionParamsSchema = z.object({ versionId: z.string().uuid() });
export type RestoreVersionParams = z.infer<typeof RestoreVersionParamsSchema>;

export const PublishParamsSchema = z.object({ enableWebChannel: z.boolean() });
export type PublishParams = z.infer<typeof PublishParamsSchema>;

export const SetWebChannelParamsSchema = z.object({ enabled: z.boolean() });
export type SetWebChannelParams = z.infer<typeof SetWebChannelParamsSchema>;

/** [신규 No.40] 저장 params = `{ targetVersionId }`만(RestoreVersionParamsSchema와 같은 패턴 — 식별자만).
 * 기준(`expectedProdVersionId`)은 생성 트랜잭션 안에서 재계산되어 `expectedContentHash` 컬럼(재사용)에
 * 저장된다 — RESTORE_VERSION이 `expectedContentHash`에 기준 해시를 저장하는 것과 같은 재사용 규약. */
export const SwitchProdVersionParamsSchema = z.object({ targetVersionId: z.string().uuid() });
export type SwitchProdVersionParams = z.infer<typeof SwitchProdVersionParamsSchema>;

export type DeployScheduleParamsOf<A extends DeployScheduleAction> = A extends 'RESTORE_VERSION'
  ? RestoreVersionParams
  : A extends 'PUBLISH'
    ? PublishParams
    : A extends 'SET_WEB_CHANNEL'
      ? SetWebChannelParams
      : SwitchProdVersionParams;

/* ------------------------------------------------------------------------------------------------
 * 시각 · 메모 — 공용 입력 스키마(J-12, J-13)
 * ---------------------------------------------------------------------------------------------- */

function truncateToMinute(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCSeconds(0, 0);
  return d;
}

/** 오프셋 포함 ISO 8601만 허용(`…Z` 또는 `…±HH:mm`) — FR-D2-9, AC-D1-6. 초·밀리초는 0으로 정규화한다. */
export const OffsetDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .transform((s) => truncateToMinute(new Date(s)));

/** 코드 포인트 기준 200자(EX-D-13) — 제어문자 금지. */
export const MemoSchema = z
  .string()
  .trim()
  .min(1)
  .refine((v) => Array.from(v).length <= DEPLOY_SCHEDULE_LIMITS.memoMaxCodePoints, {
    message: `메모는 최대 ${DEPLOY_SCHEDULE_LIMITS.memoMaxCodePoints}자까지 입력할 수 있습니다.`,
  })
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), {
    message: '메모에 제어 문자를 포함할 수 없습니다.',
  });

/* ------------------------------------------------------------------------------------------------
 * 생성 · 미리보기 · 수정 · 재개
 * ---------------------------------------------------------------------------------------------- */

const RestoreVersionCreateFields = z.object({
  action: z.literal('RESTORE_VERSION'),
  versionId: z.string().uuid(),
  previewedContentHash: z.string().regex(/^[0-9a-f]{64}$/, '기준 해시 형식이 올바르지 않습니다.'),
  acknowledgeActive: z.boolean().optional(),
});
const PublishCreateFields = z.object({
  action: z.literal('PUBLISH'),
  enableWebChannel: z.boolean(),
});
const SetWebChannelCreateFields = z.object({
  action: z.literal('SET_WEB_CHANNEL'),
  enabled: z.boolean(),
});

/** [신규 No.40] `previewedProdVersionId` — 미리보기 시점의 기준(현재 운영 버전) 확인용(RESTORE_VERSION의
 * `previewedContentHash`와 같은 역할). 경고가 있으면 `acknowledgeWarnings` 필수(§11.2). */
const SwitchProdVersionCreateFields = z.object({
  action: z.literal('SWITCH_PROD_VERSION'),
  targetVersionId: z.string().uuid(),
  previewedProdVersionId: z.string().uuid(),
  acknowledgeWarnings: z.boolean().optional(),
});

const CommonCreateFields = z.object({
  scheduledAt: OffsetDateTimeSchema,
  memo: MemoSchema.optional(),
  postRunTestSetId: z.string().uuid().optional(),
});

export const CreateDeployScheduleSchema = z.discriminatedUnion('action', [
  RestoreVersionCreateFields.merge(CommonCreateFields),
  PublishCreateFields.merge(CommonCreateFields),
  SetWebChannelCreateFields.merge(CommonCreateFields),
  SwitchProdVersionCreateFields.merge(CommonCreateFields),
]);
export type CreateDeployScheduleDto = z.infer<typeof CreateDeployScheduleSchema>;

/**
 * §6.1 — 생성 전 미리보기. `previewedContentHash`·`memo`는 제외한다(아직 결정되지 않았으므로).
 * `excludeScheduleId`(선택) — 재개(HELD→PENDING) 미리보기 전용(code-review 2라운드 H-1). 지정하면
 * 서버가 활성 형제 집합(체인 기준·SPACING·한도 판정 전부)에서 그 예약을 제외한다 — 재개 대상 자신을
 * "선행 예약"으로 인식해 대상 해시가 자기 자신의 기준 해시와 같아져 `RESTORE_NO_CHANGES` 차단으로
 * `creatable:false`가 되는 자기충돌을 막는다. `resume()` 쓰기 경로(`id:{not:scheduleId}`)와 같은 규칙이다.
 */
export const PreviewDeployScheduleSchema = z.discriminatedUnion('action', [
  RestoreVersionCreateFields.omit({ previewedContentHash: true }).extend({ scheduledAt: OffsetDateTimeSchema, excludeScheduleId: z.string().uuid().optional() }),
  PublishCreateFields.extend({ scheduledAt: OffsetDateTimeSchema, excludeScheduleId: z.string().uuid().optional() }),
  SetWebChannelCreateFields.extend({ scheduledAt: OffsetDateTimeSchema, excludeScheduleId: z.string().uuid().optional() }),
  SwitchProdVersionCreateFields.omit({ previewedProdVersionId: true }).extend({ scheduledAt: OffsetDateTimeSchema, excludeScheduleId: z.string().uuid().optional() }),
]);
export type PreviewDeployScheduleDto = z.infer<typeof PreviewDeployScheduleSchema>;

export const UpdateDeployScheduleSchema = z
  .object({
    scheduledAt: OffsetDateTimeSchema.optional(),
    memo: MemoSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => v.scheduledAt !== undefined || v.memo !== undefined, {
    message: '변경할 값을 1개 이상 지정해 주세요.',
  });
export type UpdateDeployScheduleDto = z.infer<typeof UpdateDeployScheduleSchema>;

export const ResumeDeployScheduleSchema = z.object({
  scheduledAt: OffsetDateTimeSchema,
  previewedContentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type ResumeDeployScheduleDto = z.infer<typeof ResumeDeployScheduleSchema>;

/* ------------------------------------------------------------------------------------------------
 * 목록 쿼리
 * ---------------------------------------------------------------------------------------------- */

export const DeployScheduleListQuerySchema = PaginationQuerySchema.extend({
  pageSize: z.coerce.number().int().min(1).max(DEPLOY_SCHEDULE_LIMITS.listPageSizeMax).default(DEPLOY_SCHEDULE_LIMITS.listPageSizeDefault),
  status: csvEnumArray(DeployScheduleStatus),
  action: csvEnumArray(DeployScheduleAction),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  needsAttention: queryBoolean().optional(),
  /** 전역 목록(`/deploy-schedules`)에서만 사용된다. */
  chatbotId: z.string().uuid().optional(),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type DeployScheduleListQuery = z.infer<typeof DeployScheduleListQuerySchema>;

/* ------------------------------------------------------------------------------------------------
 * 결과 요약 · G3 결과 · 준비도 경고
 * ---------------------------------------------------------------------------------------------- */

export const VersionAssetCountsSchema = z.record(
  z.string(),
  z.object({ added: z.number().int().nonnegative(), removed: z.number().int().nonnegative(), modified: z.number().int().nonnegative() }),
);

export const PostRunTestOutcomeSchema = z.object({
  status: z.enum(['STARTED', 'SKIPPED', 'REJECTED']),
  testRunId: z.string().uuid().optional(),
  reason: z.enum(['CREATOR_NOT_AUTHORIZED', 'TEST_SET_MISSING', 'TEST_SET_EMPTY', 'TEST_RUN_IN_PROGRESS']).optional(),
});
export type PostRunTestOutcome = z.infer<typeof PostRunTestOutcomeSchema>;

export const DeployScheduleResultSummarySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('RESTORE'),
    // NOOP(§7.6 — 이미 대상과 동일해 아무것도 쓰지 않음)에는 백업이 없다. 자리표시값(0/'')으로
    // "무결성을 위반하는 값"을 만드는 대신 필드 자체를 생략한다(code-review 1라운드 M2) — FE는
    // 세 필드의 부재를 "APPLIED/RECOVERED가 아님"의 신호로 쓸 수 있다(sibling `outcome` 필드와 함께).
    fromVersionNo: z.number().int().positive().optional(),
    backupVersionNo: z.number().int().positive().optional(),
    backupVersionId: z.string().uuid().optional(),
    counts: VersionAssetCountsSchema,
    reindexWasRunning: z.boolean(),
    classifierDeleted: z.boolean(),
    postRunTest: PostRunTestOutcomeSchema.optional(),
  }),
  z.object({
    kind: z.literal('PUBLISH'),
    statusBefore: ChatbotStatus,
    statusAfter: ChatbotStatus,
    channelBefore: z.boolean().nullable(),
    channelAfter: z.boolean().nullable(),
    postRunTest: PostRunTestOutcomeSchema.optional(),
  }),
  z.object({
    kind: z.literal('SET_WEB_CHANNEL'),
    channelBefore: z.boolean().nullable(),
    channelAfter: z.boolean(),
  }),
  // [신규 No.40] 환경 분리 — 운영 버전 전환.
  z.object({
    kind: z.literal('SWITCH_PROD'),
    fromVersionNo: z.number().int().positive(),
    toVersionNo: z.number().int().positive(),
    postRunTest: PostRunTestOutcomeSchema.optional(),
  }),
]);
export type DeployScheduleResultSummary = z.infer<typeof DeployScheduleResultSummarySchema>;

export const ReadinessWarningSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('EMBEDDING_INDEX_INCOMPLETE'), pendingCount: z.number().int().nonnegative(), failedCount: z.number().int().nonnegative() }),
  z.object({ code: z.literal('LAST_TEST_RUN'), setName: z.string(), passRate: z.number().min(0).max(1), ranAt: z.coerce.date() }),
  z.object({ code: z.literal('NO_RECENT_TEST_RUN') }),
  z.object({
    code: z.literal('ACTIVE_JOB'),
    jobs: z.array(z.object({ source: z.enum(['TRAINING_JOB', 'TEST_RUN']), kind: z.string(), status: z.string(), progress: z.number().int().min(0).max(100) })),
  }),
  z.object({ code: z.literal('RESTORE_WARNINGS'), warnings: z.array(RestoreWarningSchema) }),
  z.object({ code: z.literal('WEB_CHANNEL_NOT_CONFIGURED') }),
  z.object({ code: z.literal('PUBLISHED_BUT_CHANNEL_CLOSED') }),
  z.object({ code: z.literal('LONG_HORIZON'), days: z.number().int().positive() }),
  z.object({ code: z.literal('PREDECESSOR_HELD'), heldScheduleId: z.string().uuid() }),
  z.object({ code: z.literal('ENGINE_DISABLED_ON_THIS_INSTANCE') }),
  // [신규 No.40] 모드 켜진 챗봇의 RESTORE_VERSION 예약 — "초안에만 적용됩니다. 운영은 바뀌지 않습니다".
  z.object({ code: z.literal('ENV_DRAFT_ONLY') }),
]);
export type ReadinessWarning = z.infer<typeof ReadinessWarningSchema>;

/* ------------------------------------------------------------------------------------------------
 * 목록 · 상세 · 미리보기 응답 · 상태 점검 · notice · summary · meta(§13)
 * ---------------------------------------------------------------------------------------------- */

export const DeployScheduleListItemSchema = z.object({
  id: z.string().uuid(),
  chatbotId: z.string().uuid(),
  chatbotName: z.string().optional(),
  action: DeployScheduleAction,
  status: DeployScheduleStatus,
  scheduledAt: z.coerce.date(),
  /** RESTORE_VERSION·SWITCH_PROD_VERSION일 때만 채워진다(그 외 null) — "지금 다시 예약" 진입점이
   * 상세를 추가 조회하지 않고 목록만으로 버전을 알 수 있게 한다(code-review 2라운드 Low). */
  targetVersionId: z.string().uuid().nullable(),
  targetVersionNo: z.number().int().positive().nullable(),
  enableWebChannel: z.boolean().nullable(),
  channelEnabled: z.boolean().nullable(),
  memo: z.string().nullable(),
  createdByEmail: z.string(),
  createdAt: z.coerce.date(),
  attemptCount: z.number().int().nonnegative(),
  lastTransientReason: DeployScheduleTransientReason.nullable(),
  delaySeconds: z.number().int().nullable(),
  finishedAt: z.coerce.date().nullable(),
  outcome: DeployScheduleOutcome.nullable(),
  failureReason: DeployScheduleFailureReason.nullable(),
  heldReason: DeployScheduleHeldReason.nullable(),
  needsAttention: z.boolean(),
});
export type DeployScheduleListItem = z.infer<typeof DeployScheduleListItemSchema>;

export const DeployScheduleDetailSchema = DeployScheduleListItemSchema.extend({
  params: z.union([RestoreVersionParamsSchema, PublishParamsSchema, SetWebChannelParamsSchema, SwitchProdVersionParamsSchema]),
  acknowledgeActive: z.boolean(),
  expectedContentHash: z.string().nullable(),
  targetContentHash: z.string().nullable(),
  predecessor: z.object({ id: z.string().uuid(), scheduledAt: z.coerce.date(), status: DeployScheduleStatus, targetVersionNo: z.number().int().positive().nullable() }).nullable(),
  heldBy: z.object({ id: z.string().uuid(), scheduledAt: z.coerce.date(), status: DeployScheduleStatus, action: DeployScheduleAction }).nullable(),
  resultSummary: DeployScheduleResultSummarySchema.nullable(),
  revert: z.object({ backupVersionId: z.string().uuid(), backupVersionNo: z.number().int().positive() }).nullable(),
  postRunTestSetId: z.string().uuid().nullable(),
  testRunId: z.string().uuid().nullable(),
  cancelledByEmail: z.string().nullable(),
  cancelledAt: z.coerce.date().nullable(),
  acknowledgedByEmail: z.string().nullable(),
  acknowledgedAt: z.coerce.date().nullable(),
  readinessWarnings: z.array(ReadinessWarningSchema),
});
export type DeployScheduleDetail = z.infer<typeof DeployScheduleDetailSchema>;

export const DeploySchedulePreviewResponseSchema = z.object({
  creatable: z.boolean(),
  preconditionFailures: z.array(z.object({ code: DeploySchedulePreconditionReason, message: z.string().optional() })),
  timeViolations: z.array(z.object({ rule: z.enum(['LEAD', 'HORIZON', 'SPACING']) })),
  readinessWarnings: z.array(ReadinessWarningSchema),
  restore: z
    .object({
      base: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('CURRENT'), contentHash: z.string() }),
        z.object({ kind: z.literal('SCHEDULE'), scheduleId: z.string().uuid(), scheduledAt: z.coerce.date(), versionId: z.string().uuid(), versionNo: z.number().int().positive(), contentHash: z.string() }),
      ]),
      targetVersion: z.object({ id: z.string().uuid(), versionNo: z.number().int().positive() }),
      targetContentHash: z.string(),
      diffSummary: VersionDiffSummarySchema,
      blockers: z.array(RestoreBlockerSchema),
      requiresAcknowledgeActive: z.boolean(),
    })
    .optional(),
  publish: z.object({ currentStatus: ChatbotStatus, webChannelConfigured: z.boolean(), webChannelEnabled: z.boolean() }).optional(),
  setWebChannel: z.object({ currentEnabled: z.boolean() }).optional(),
  // [신규 No.40] 환경 분리 — 운영 버전 전환 예약 미리보기.
  switchProd: z
    .object({
      base: z.enum(['CURRENT', 'SCHEDULE']),
      /**
       * [신규 No.40 — 2026-09-25 프론트 계약 보강] 이 예약이 "실제 실행 시" 비교할 기준 운영 버전
       * id — `base==='SCHEDULE'`이면 앞선(체인) 예약의 대상 버전 id, `base==='CURRENT'`면 지금의
       * 실제 운영 버전 id다. 생성 요청(`POST .../deploy-schedules`)의 `previewedProdVersionId`에
       * **이 값을 그대로** 보내야 한다 — 체인일 때 현재 운영 버전 id를 보내면 서버가 트랜잭션에서
       * 다시 계산한 기준과 달라 `409 ENV_POINTER_STALE`를 반환한다(§11.2).
       */
      expectedProdVersionId: z.string().uuid(),
      targetVersion: z.object({ id: z.string().uuid(), versionNo: z.number().int().positive() }),
      gate: GateEvaluationSchema,
      blockers: z.array(z.enum(['TARGET_NOT_ALLOWED', 'GATE_BLOCKED', 'GATE_CONFIG_ERROR', 'TARGET_UNREADABLE', 'CHATBOT_ARCHIVED', 'ENV_MODE_DISABLED'])),
      warnings: z.array(ProdSwitchWarningSchema),
    })
    .optional(),
});
export type DeploySchedulePreviewResponse = z.infer<typeof DeploySchedulePreviewResponseSchema>;

export const DeployScheduleStateCheckSchema = z.object({
  applicable: z.boolean(),
  basis: z.enum(['CURRENT', 'CHAIN_HEAD']),
  headScheduleId: z.string().uuid().optional(),
  currentContentHash: z.string().optional(),
  expectedContentHash: z.string().optional(),
  matches: z.boolean(),
  checkedAt: z.coerce.date(),
});
export type DeployScheduleStateCheck = z.infer<typeof DeployScheduleStateCheckSchema>;

export const DeployScheduleNoticeSchema = z.object({
  upcomingRestore: z
    .object({
      scheduleId: z.string().uuid(),
      scheduledAt: z.coerce.date(),
      status: z.enum(['PENDING', 'HELD']),
      targetVersionNo: z.number().int().positive().nullable(),
      chainLength: z.number().int().positive(),
    })
    .nullable(),
  activeCount: z.number().int().nonnegative(),
});
export type DeployScheduleNotice = z.infer<typeof DeployScheduleNoticeSchema>;

export const DeployScheduleSummarySchema = z.object({
  needsAttention: z.object({
    total: z.number().int().nonnegative(),
    byChatbot: z.array(z.object({ chatbotId: z.string().uuid(), chatbotName: z.string(), count: z.number().int().positive() })),
  }),
  last24h: z.object({ succeeded: z.number().int().nonnegative(), failed: z.number().int().nonnegative(), missed: z.number().int().nonnegative() }),
  generatedAt: z.coerce.date(),
});
export type DeployScheduleSummary = z.infer<typeof DeployScheduleSummarySchema>;

export const DeployScheduleMetaSchema = z.object({
  timezone: z.string(),
  timezoneFallback: z.boolean(),
  engine: z.object({
    enabledOnThisInstance: z.boolean(),
    pollIntervalMs: z.number().int().positive(),
    misfireGraceMinutes: z.number().int().nonnegative(),
    retryWindowMinutes: z.number().int().positive(),
    leaseMinutes: z.number().int().positive(),
    overduePendingCount: z.number().int().nonnegative(),
  }),
  limits: z.object({
    minLeadMinutes: z.number(),
    maxHorizonDays: z.number(),
    minSpacingMinutes: z.number(),
    maxActivePerChatbot: z.number(),
    memoMaxCodePoints: z.number(),
    longHorizonWarnDays: z.number(),
    listPageSizeDefault: z.number(),
    listPageSizeMax: z.number(),
  }),
});
export type DeployScheduleMeta = z.infer<typeof DeployScheduleMetaSchema>;

/* ------------------------------------------------------------------------------------------------
 * 순수 함수 — FE/BE 공용(시각 규칙·시간대 변환). now를 인자로 받는다.
 * (동작→권한 매핑 `requiredPermissions`는 BE 전용이라 `apps/api/src/deploy-schedules/lib/`에 둔다 — §2.1)
 * ---------------------------------------------------------------------------------------------- */

export interface TimeRuleViolation {
  rule: 'LEAD' | 'HORIZON' | 'SPACING';
}

/** §6.3 — 서버 `now`가 권위. FE는 즉시 안내용으로 재사용한다. `scheduledAt`·`otherActiveTimes`는 분 단위로 정규화되어 있다고 가정한다. */
export function checkScheduleTimeRules(input: { scheduledAt: Date; now: Date; otherActiveTimes: readonly Date[] }): TimeRuleViolation[] {
  const violations: TimeRuleViolation[] = [];
  const leadMs = DEPLOY_SCHEDULE_LIMITS.minLeadMinutes * 60_000;
  const horizonMs = DEPLOY_SCHEDULE_LIMITS.maxHorizonDays * 86_400_000;
  const scheduledMs = input.scheduledAt.getTime();
  const nowMs = input.now.getTime();
  if (scheduledMs < nowMs + leadMs) violations.push({ rule: 'LEAD' });
  if (scheduledMs > nowMs + horizonMs) violations.push({ rule: 'HORIZON' });
  if (input.otherActiveTimes.some((t) => t.getTime() === scheduledMs)) violations.push({ rule: 'SPACING' });
  return violations;
}

/** 지정 인스턴트를 지정 시간대의 벽시계 성분으로 취급했을 때의 분 단위 오프셋(동쪽이 양수). */
function offsetMinutesAt(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = map.hour === '24' ? 0 : Number(map.hour);
  const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return Math.round((asUTC - utcMs) / 60_000);
}

export type ZonedLocalToInstantResult =
  | { kind: 'OK'; instant: Date }
  | { kind: 'NONEXISTENT' }
  | { kind: 'AMBIGUOUS'; earlier: Date; later: Date };

/** DST 안전 지역시각 → 순간 변환(§14). 존재하지 않는/중복되는 현지 시각을 판별한다. */
export function zonedLocalToInstant(local: { date: string; time: string }, timeZone: string): ZonedLocalToInstantResult {
  const [y, m, d] = local.date.split('-').map(Number);
  const [hh, mm] = local.time.split(':').map(Number);
  const wallAsUTC = Date.UTC(y, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0, 0, 0);

  const offsetBefore = offsetMinutesAt(wallAsUTC - 24 * 3_600_000, timeZone);
  const offsetAfter = offsetMinutesAt(wallAsUTC + 24 * 3_600_000, timeZone);

  const candidates = Array.from(new Set([offsetBefore, offsetAfter]));
  const valid: number[] = [];
  for (const off of candidates) {
    const instant = wallAsUTC - off * 60_000;
    const back = offsetMinutesAt(instant, timeZone);
    if (instant + back * 60_000 === wallAsUTC) valid.push(instant);
  }
  const unique = Array.from(new Set(valid)).sort((a, b) => a - b);

  if (unique.length === 0) return { kind: 'NONEXISTENT' };
  if (unique.length >= 2) return { kind: 'AMBIGUOUS', earlier: new Date(unique[0]), later: new Date(unique[unique.length - 1]) };
  return { kind: 'OK', instant: new Date(unique[0]) };
}

const KNOWN_TIMEZONE_ABBREVIATIONS: Record<string, string> = { 'Asia/Seoul': 'KST' };

export interface FormattedInstant {
  date: string;
  time: string;
  offsetLabel: string;
  abbreviation?: string;
}

/** 순간 → 지정 시간대 표시(§14). 오프셋은 해당 순간 기준으로 계산한다(DST 안전). */
export function formatInstantInZone(instant: Date, timeZone: string): FormattedInstant {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const date = `${map.year}-${map.month}-${map.day}`;
  const time = `${map.hour === '24' ? '00' : map.hour}:${map.minute}`;

  const offsetMin = offsetMinutesAt(instant.getTime(), timeZone);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const oh = Math.floor(abs / 60);
  const om = abs % 60;
  const offsetLabel = `UTC${sign}${oh}${om !== 0 ? ':' + String(om).padStart(2, '0') : ''}`;

  return { date, time, offsetLabel, abbreviation: KNOWN_TIMEZONE_ABBREVIATIONS[timeZone] };
}
