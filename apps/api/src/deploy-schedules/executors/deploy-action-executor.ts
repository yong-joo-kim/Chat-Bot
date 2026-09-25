import type { Prisma } from '@prisma/client';
import type { ZodType } from 'zod';
import type {
  ChatbotStatus,
  DeploySchedulePreconditionReason,
  DeploySchedulePreviewResponse,
  DeployScheduleParamsOf,
  DeployScheduleAction,
  DeployScheduleResultSummary,
  Permission,
} from '@chat-bot/shared-types';
import type { ClassifiedError } from '../lib/outcome-classifier';

/** 체인 판정에 필요한 "같은 챗봇의 활성 RESTORE_VERSION 형제 예약" — 호출자(preview/create 서비스)가 1회 조회해 넘긴다. */
export interface ActiveRestoreSibling {
  id: string;
  scheduledAt: Date;
  targetContentHash: string | null;
}

/** [신규 No.40 — §11.2] "같은 챗봇의 활성 SWITCH_PROD_VERSION 형제 예약" — RESTORE_VERSION 체인과
 * 같은 규칙(뒤에만 붙는다)을 쓴다. 기준은 content hash가 아니라 대상 버전 id다. */
export interface ActiveSwitchSibling {
  id: string;
  scheduledAt: Date;
  targetVersionId: string | null;
}

export interface PreviewContext<A extends DeployScheduleAction> {
  chatbotId: string;
  chatbotStatus: ChatbotStatus;
  scheduledAt: Date;
  params: DeployScheduleParamsOf<A>;
  now: Date;
  activeRestoreSiblings: readonly ActiveRestoreSibling[];
  /** [신규 No.40] SWITCH_PROD_VERSION 체인 기준 판정용(§11.2). */
  activeSwitchSiblings: readonly ActiveSwitchSibling[];
  /** RESTORE_VERSION 전용(FR-D2-4) — 이 예약보다 이른 활성 PUBLISH 예약 존재 여부. */
  earlierActivePublishExists: boolean;
  /** PUBLISH 전용(R7) — 같은 챗봇의 다른 활성 예약 동작 목록(자기 자신 제외). */
  activeSiblingActions: readonly DeployScheduleAction[];
}

export interface ActionPreviewResult {
  preconditionFailures: Array<{ code: DeploySchedulePreconditionReason; message?: string }>;
  restore?: NonNullable<DeploySchedulePreviewResponse['restore']>;
  publish?: NonNullable<DeploySchedulePreviewResponse['publish']>;
  setWebChannel?: NonNullable<DeploySchedulePreviewResponse['setWebChannel']>;
  /** [신규 No.40] SWITCH_PROD_VERSION 전용. */
  switchProd?: NonNullable<DeploySchedulePreviewResponse['switchProd']>;
}

export interface InsertContext<A extends DeployScheduleAction> {
  chatbotId: string;
  scheduledAt: Date;
  params: DeployScheduleParamsOf<A>;
  /** RESTORE_VERSION 생성 요청의 `previewedContentHash`(R4 재확인용). */
  previewedContentHash?: string;
  now: Date;
  activeRestoreSiblings: readonly ActiveRestoreSibling[];
  /** [신규 No.40] §11.2. */
  activeSwitchSiblings: readonly ActiveSwitchSibling[];
  activeSiblingActions: readonly DeployScheduleAction[];
}

export interface DerivedFields {
  targetVersionId?: string | null;
  targetVersionNo?: number | null;
  targetContentHash?: string | null;
  expectedContentHash?: string | null;
  predecessorScheduleId?: string | null;
}

export interface ExecutionContext<A extends DeployScheduleAction> {
  deployScheduleId: string;
  chatbotId: string;
  params: DeployScheduleParamsOf<A>;
  expectedContentHash: string | null;
  acknowledgeActive: boolean;
  actor: { id: string; email: string; role: string };
  auditSummaryPrefix: string;
}

export type ExecutionOutcome = { kind: 'APPLIED'; summary: DeployScheduleResultSummary } | { kind: 'NOOP'; summary: DeployScheduleResultSummary } | ClassifiedError;

export interface RecoveryContext<A extends DeployScheduleAction> {
  deployScheduleId: string;
  chatbotId: string;
  params: DeployScheduleParamsOf<A>;
  targetContentHash: string | null;
  claimedAt: Date;
}

export type RecoveryVerdictOutcome = { kind: 'RECOVERED' | 'NOOP'; summary: DeployScheduleResultSummary } | { kind: 'INTERRUPTED' };

/**
 * [신규 2026-09-23 No.28] 동작 실행기 전략 인터페이스(§5.1). 동작 추가 = 파일 1개 + 레지스트리 1줄.
 * `execute()`는 절대 throw하지 않는다 — 모든 결과를 `ExecutionOutcome`으로 분류해 반환한다(§7.6).
 */
export interface DeployActionExecutor<A extends DeployScheduleAction> {
  readonly action: A;
  readonly paramsSchema: ZodType<DeployScheduleParamsOf<A>>;

  requiredPermissions(params: DeployScheduleParamsOf<A>): Permission[];

  /** 생성 전 미리보기 — 쓰기 0. */
  preview(ctx: PreviewContext<A>): Promise<ActionPreviewResult>;

  /** 생성·재개 쓰기 트랜잭션 안에서 호출 — 저장할 파생 필드를 확정하거나 ApiException(409 등)을 던진다. */
  resolveForInsert(tx: Prisma.TransactionClient, ctx: InsertContext<A>): Promise<DerivedFields>;

  /** 실행 — 절대 throw하지 않는다. */
  execute(ctx: ExecutionContext<A>): Promise<ExecutionOutcome>;

  /** 임대 만료 RUNNING의 실제 상태 판정(§7.8). */
  judgeRecovery(ctx: RecoveryContext<A>): Promise<RecoveryVerdictOutcome>;
}
