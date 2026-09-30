import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ProdSwitchApprovalRequest as RequestRow } from '@prisma/client';
import { RoleName, hasPermission } from '@chat-bot/shared-types';
import type { ApiErrorCode } from '@chat-bot/shared-types';
import { maskPii } from '@chat-bot/pii-mask';
import type {
  ApprovalListQuery,
  ApprovalPolicyStatus,
  ApprovalSummaryResponse,
  ApproveProdSwitchDto,
  ApproveProdSwitchResponse,
  CreateProdSwitchApprovalDto,
  Paginated,
  ProdSwitchApprovalDetail,
  ProdSwitchApprovalSummary,
  ProdSwitchPreviewResponse,
  RejectProdSwitchDto,
  UpdateApprovalPolicyDto,
} from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CLOCK } from '../../common/polling/clock';
import type { Clock } from '../../common/polling/clock';
import { ApiException } from '../../common/api.exception';
import type { SessionUser } from '../../common/auth/session-context';
import { AuditLogService } from '../../audit-logs/audit-log.service';
import { BannedWordFilterService } from '../../banned-words/banned-word-filter.service';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { ProdSwitchService } from '../core/prod-switch.service';
import { EnvironmentReadService } from '../core/environment-read.service';
import { EnvironmentPointerWriter } from '../core/environment-pointer.writer';
import { SwitchApprovalStore } from './switch-approval.store';
import type { CloseData } from './switch-approval.store';
import { SwitchApprovalMapper, toApprovalAuditView } from './switch-approval.mapper';
import { computeExpiresAt, effectiveVerdict } from './lib/approval-state';
import type { EffectiveVerdict } from './lib/approval-state';

const SYSTEM_ACTOR = { id: null, email: 'system', role: null } as const;
const RECENT_LIMIT = 20;
const NOT_FOUND_REQUEST = '요청하신 승인 요청을 찾을 수 없습니다.';

function versionLabel(row: Pick<RequestRow, 'baseProdVersionNo' | 'targetVersionNo'>): string {
  return `운영 전환 요청 v${row.baseProdVersionNo} → v${row.targetVersionNo}`;
}

function codeOf(e: ApiException): string {
  return (e.getResponse() as { code?: string }).code ?? 'INTERNAL_ERROR';
}

/**
 * 운영 전환 2인 승인(ai-guardrails-설계.md §10, ADR-0048) — 정책 · 요청 · 승인 · 반려 · 취소 · 지연 만료. 운영 포인터는 이 서비스가 직접
 * 쓰지 않는다: 승인 실행은 `ProdSwitchService.switch()`(유일한 강제 지점)에 `approval` 호출 정보와 요청 선점 콜백(`claim`)을 넘겨
 * **포인터 CAS와 같은 트랜잭션**으로 실행한다. 상태 전이는 전부 `PENDING` CAS(저장소 1파일), 만료·기준 변경은 조회·변경 시점 판정(루프 0).
 */
@Injectable()
export class SwitchApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: SwitchApprovalStore,
    private readonly mapper: SwitchApprovalMapper,
    private readonly prodSwitch: ProdSwitchService,
    private readonly environmentRead: EnvironmentReadService,
    private readonly writer: EnvironmentPointerWriter,
    private readonly auditLog: AuditLogService,
    private readonly bannedWords: BannedWordFilterService,
    private readonly scope: ChatbotScopeService,
    private readonly config: ConfigService,
    // 시계 포트 — 예약 실행기와 같은 시계를 쓴다(시험은 `CLOCK` 오버라이드 1곳으로 두 쪽을 함께 옮긴다).
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private now(): Date {
    return this.clock.now();
  }

  /* ── 조회 ── */

  async getStatus(chatbotId: string, user: SessionUser): Promise<ApprovalPolicyStatus> {
    await this.scope.assertReadable(chatbotId);
    const pointer = await this.environmentRead.getPointerStatus(chatbotId);

    // 지연 종결 수행 후 목록을 다시 읽는다(만료·기준 변경이 조회에서 확정된다).
    await this.sweep(await this.store.listRecent(chatbotId, RECENT_LIMIT));
    const recentRows = await this.store.listRecent(chatbotId, RECENT_LIMIT);
    const summaries = await this.mapper.toSummaries(recentRows, user.id);
    const pending = summaries.find((s) => s.status === 'PENDING') ?? null;

    const eligible = await this.countApprovers();
    const actorEligible = user.status === 'ACTIVE' && hasPermission(user.role, 'chatbot:deploy');
    return {
      policy: { required: pointer.approval.required, ttlHours: pointer.approval.ttlHours },
      envModeOn: pointer.prodVersionId !== null,
      eligibleApproverCount: eligible,
      otherApproverCount: Math.max(0, eligible - (actorEligible ? 1 : 0)),
      offLocked: this.config.get<boolean>('ENV_APPROVAL_OFF_LOCKED') ?? false,
      pending,
      recent: summaries,
    };
  }

  async getRequest(chatbotId: string, requestId: string, user: SessionUser): Promise<ProdSwitchApprovalDetail> {
    await this.scope.assertReadable(chatbotId);
    const row = (await this.sweep([await this.findOrThrow(chatbotId, requestId)]))[0];
    const [summary] = await this.mapper.toSummaries([row], user.id);

    let livePreview: ProdSwitchPreviewResponse | null = null;
    if (row.status === 'PENDING') {
      try {
        livePreview = await this.prodSwitch.preview(chatbotId, { kind: row.action === 'PROD_ROLLBACK' ? 'ROLLBACK' : 'SWITCH', targetVersionId: row.targetVersionId });
      } catch {
        livePreview = null;
      }
    }
    return { ...summary, livePreview };
  }

  /** 전역 대기 목록 — 지연 종결 수행. `canApprove` = 대기 ∧ 요청자가 내가 아님. */
  async listGlobal(query: ApprovalListQuery, user: SessionUser): Promise<Paginated<ProdSwitchApprovalSummary>> {
    await this.sweep(await this.store.listAllPending());
    const { rows, total } = await this.store.listPage(query.status, (query.page - 1) * query.pageSize, query.pageSize);
    const items = await this.mapper.toSummaries(rows, user.id);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async summary(user: SessionUser): Promise<ApprovalSummaryResponse> {
    const pending = await this.sweep(await this.store.listAllPending());
    const live = pending.filter((r) => r.status === 'PENDING');
    return { pendingTotal: live.length, pendingForMe: live.filter((r) => r.requestedById !== user.id).length };
  }

  /* ── 정책 ── */

  async updatePolicy(chatbotId: string, dto: UpdateApprovalPolicyDto, user: SessionUser): Promise<ApprovalPolicyStatus> {
    await this.scope.assertWritable(chatbotId);
    const pointer = await this.environmentRead.getPointerStatus(chatbotId);
    const before = pointer.approval;

    if (dto.required && !before.required) {
      if (pointer.prodVersionId === null) {
        throw new ApiException('APPROVAL_POLICY_UNAVAILABLE', 409, '환경 분리가 꺼져 있어 2인 승인을 쓸 수 없습니다.', [{ field: 'reason', message: 'ENV_MODE_DISABLED' }]);
      }
      if ((await this.countApprovers()) < 2) {
        throw new ApiException('APPROVAL_POLICY_UNAVAILABLE', 409, '활성 상태의 관리자가 2명 이상이어야 켤 수 있습니다.', [{ field: 'reason', message: 'NOT_ENOUGH_APPROVERS' }]);
      }
    }
    if (!dto.required && before.required && (this.config.get<boolean>('ENV_APPROVAL_OFF_LOCKED') ?? false)) {
      throw new ApiException('APPROVAL_POLICY_UNAVAILABLE', 409, '서버 설정으로 2인 승인 끄기가 잠겨 있습니다. 서버 관리자에게 문의해 주세요.', [{ field: 'reason', message: 'OFF_LOCKED' }]);
    }

    const changed = before.required !== dto.required || before.ttlHours !== dto.ttlHours;
    let cancelledIds: string[] = [];
    if (changed) {
      // 끄기 = 정책 갱신과 대기 요청 취소가 한 트랜잭션(자동 실행 0 — FR-AG5-8).
      cancelledIds = await this.prisma.$transaction(async (tx) => {
        await this.writer.updateApprovalPolicy(tx, chatbotId, { required: dto.required, ttlHours: dto.ttlHours });
        if (!dto.required && before.required) return this.store.cancelPendingForChatbot(chatbotId, { status: 'CANCELLED', closedReason: 'POLICY_OFF' }, tx);
        return [];
      });

      await this.auditLog.record({
        action: 'UPDATE',
        targetType: 'ChatbotEnvironment',
        targetId: chatbotId,
        chatbotId,
        before: { approvalRequired: before.required, approvalTtlHours: before.ttlHours },
        after: { approvalRequired: dto.required, approvalTtlHours: dto.ttlHours },
        summary: `운영 전환 2인 승인 ${before.required !== dto.required ? (dto.required ? '켜기' : '끄기') : '만료 시간 변경'}`,
      });
      for (const id of cancelledIds) {
        const row = await this.store.find(id);
        if (row) await this.auditTransition(row, 'PENDING', { actor: undefined, summary: '정책 끔으로 대기 요청 취소' });
      }
    }
    return this.getStatus(chatbotId, user);
  }

  /* ── 요청 생성 ── */

  async createRequest(chatbotId: string, dto: CreateProdSwitchApprovalDto, user: SessionUser): Promise<ProdSwitchApprovalSummary> {
    await this.scope.assertWritable(chatbotId);
    const pointer = await this.environmentRead.getPointerStatus(chatbotId);
    if (!pointer.prodVersionId) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');
    if (!pointer.approval.required) {
      throw new ApiException('APPROVAL_POLICY_UNAVAILABLE', 409, '이 챗봇은 2인 승인이 꺼져 있어 승인 요청이 필요하지 않습니다.', [{ field: 'reason', message: 'NOT_REQUIRED' }]);
    }

    // 지연 종결 — 만료·기준 변경된 옛 대기 요청이 새 요청을 막지 않게 한다.
    const existing = await this.store.findPending(chatbotId);
    if (existing) await this.sweep([existing]);

    const now = this.now();
    const reason = dto.reason ? await this.maskMemo(dto.reason) : null;
    const base = { chatbotId, reason, requestedById: user.id, requestedByEmail: user.email };

    let data;
    if (dto.action === 'SCHEDULED_PROD_SWITCH') {
      data = await this.buildScheduledRequest(chatbotId, dto.deployScheduleId, user, now, pointer.approval.ttlHours);
    } else {
      const kind = dto.action === 'PROD_ROLLBACK' ? 'ROLLBACK' : 'SWITCH';
      const preview = await this.prodSwitch.preview(chatbotId, { kind, targetVersionId: dto.targetVersionId });
      this.assertPreviewUsable(preview);
      if (preview.expectedProdVersionId !== dto.expectedProdVersionId) {
        throw new ApiException('ENV_POINTER_STALE', 409, '미리보기 이후 운영 버전이 바뀌었습니다. 다시 확인해 주세요.');
      }
      if (preview.outcome === 'NOOP') {
        throw new ApiException('VALIDATION_FAILED', 400, '입력값을 확인해 주세요.', [{ field: 'targetVersionId', message: '대상 버전이 현재 운영 버전과 같습니다.' }]);
      }
      if (preview.warnings.length > 0 && dto.acknowledgeWarnings !== true) {
        throw new ApiException('VALIDATION_FAILED', 400, '경고 사항을 확인했는지 체크해 주세요.', [{ field: 'acknowledgeWarnings', message: '확인이 필요합니다.' }]);
      }
      data = {
        action: dto.action,
        targetVersionId: preview.target.versionId,
        targetVersionNo: preview.target.versionNo,
        baseProdVersionId: preview.current.versionId,
        baseProdVersionNo: preview.current.versionNo,
        deployScheduleId: null,
        gateSnapshot: JSON.stringify(preview.gate),
        warningCodes: JSON.stringify(preview.warnings.map((w) => w.code)),
        diffChangedCount: preview.diffSummary.totalChanged,
        expiresAt: computeExpiresAt(now, pointer.approval.ttlHours),
      };
    }

    const row = await this.store.create({ ...base, ...data });
    await this.auditLog.record({
      action: 'CREATE',
      targetType: 'ProdSwitchApprovalRequest',
      targetId: row.id,
      targetName: versionLabel(row),
      chatbotId,
      after: toApprovalAuditView(row),
      summary: `${versionLabel(row)} 승인 요청(${row.action})`,
    });
    return (await this.mapper.toSummaries([row], user.id))[0];
  }

  /* ── 승인 · 반려 · 취소 ── */

  async approve(chatbotId: string, requestId: string, dto: ApproveProdSwitchDto, user: SessionUser): Promise<ApproveProdSwitchResponse> {
    await this.scope.assertReadable(chatbotId);
    let row = (await this.sweep([await this.findOrThrow(chatbotId, requestId)]))[0];
    if (row.status !== 'PENDING') throw this.notPendingError(row);

    if (row.requestedById === user.id) {
      await this.auditSelfAttempt(user, 'approve');
      throw new ApiException('APPROVAL_SELF_FORBIDDEN', 403, '본인이 요청한 건은 승인할 수 없습니다. 다른 관리자에게 승인을 요청해 주세요.');
    }
    const before = row;
    const now = this.now();

    // 예약 요청 — 선점만 한다(전환은 예약 시각에 실행기가 `switch()`에서 승인 확인 뒤 수행).
    if (row.action === 'SCHEDULED_PROD_SWITCH') {
      const count = await this.store.close(row.id, { status: 'APPROVED', outcome: 'SCHEDULED', decidedById: user.id, decidedByEmail: user.email, decidedAt: now });
      row = (await this.store.find(row.id)) ?? row;
      if (count === 0) throw this.notPendingError(row);
      await this.auditTransition(row, before.status, { actor: user, summary: `${versionLabel(row)} 예약 전환 승인` });
      return { request: (await this.mapper.toSummaries([row], user.id))[0], switch: null };
    }

    let result: ApproveProdSwitchResponse['switch'];
    const id = row.id;
    try {
      result = await this.prodSwitch.switch(
        chatbotId,
        { targetVersionId: row.targetVersionId, expectedProdVersionId: row.baseProdVersionId, acknowledgeWarnings: dto.acknowledgeWarnings, reason: row.reason ?? undefined },
        row.action === 'PROD_ROLLBACK' ? 'ROLLBACK' : 'SWITCH',
        {
          actor: { id: user.id, email: user.email, role: user.role },
          auditSummaryPrefix: `[2인 승인 · 요청 ${row.requestedByEmail}]`,
          now,
          approval: { requestId: id, approverId: user.id, claim: (tx) => this.store.claimApplied(tx, id, { id: user.id, email: user.email }, now) },
        },
      );
    } catch (e) {
      throw await this.classifyApplyFailure(e, row, user, now);
    }

    row = (await this.store.find(row.id)) ?? row;
    await this.auditTransition(row, before.status, { actor: user, summary: `${versionLabel(row)} 승인 · 운영 전환 실행` });
    return { request: (await this.mapper.toSummaries([row], user.id))[0], switch: result };
  }

  async reject(chatbotId: string, requestId: string, dto: RejectProdSwitchDto, user: SessionUser): Promise<ProdSwitchApprovalSummary> {
    await this.scope.assertReadable(chatbotId);
    let row = (await this.sweep([await this.findOrThrow(chatbotId, requestId)]))[0];
    if (row.status !== 'PENDING') throw this.notPendingError(row);
    if (row.requestedById === user.id) {
      await this.auditSelfAttempt(user, 'reject');
      throw new ApiException('APPROVAL_SELF_FORBIDDEN', 403, '본인이 요청한 건은 반려할 수 없습니다. 취소는 요청 취소를 사용해 주세요.');
    }
    const before = row;
    const note = dto.note ? await this.maskMemo(dto.note) : null;
    const count = await this.store.close(row.id, { status: 'REJECTED', decisionNote: note, decidedById: user.id, decidedByEmail: user.email, decidedAt: this.now() });
    row = (await this.store.find(row.id)) ?? row;
    if (count === 0) throw this.notPendingError(row);
    await this.auditTransition(row, before.status, { actor: user, summary: `${versionLabel(row)} 반려` });
    return (await this.mapper.toSummaries([row], user.id))[0];
  }

  async cancel(chatbotId: string, requestId: string, user: SessionUser): Promise<ProdSwitchApprovalSummary> {
    await this.scope.assertReadable(chatbotId);
    let row = (await this.sweep([await this.findOrThrow(chatbotId, requestId)]))[0];
    if (row.requestedById !== user.id) throw new ApiException('FORBIDDEN', 403, '요청한 사람만 취소할 수 있습니다.');
    if (row.status !== 'PENDING') throw this.notPendingError(row);
    const before = row;
    const count = await this.store.close(row.id, { status: 'CANCELLED', closedReason: 'REQUESTER', decidedById: user.id, decidedByEmail: user.email, decidedAt: this.now() });
    row = (await this.store.find(row.id)) ?? row;
    if (count === 0) throw this.notPendingError(row);
    await this.auditTransition(row, before.status, { actor: user, summary: `${versionLabel(row)} 요청 취소` });
    return (await this.mapper.toSummaries([row], user.id))[0];
  }

  /* ── 내부 ── */

  private async findOrThrow(chatbotId: string, requestId: string): Promise<RequestRow> {
    const row = await this.store.find(requestId);
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_REQUEST);
    return row;
  }

  private async countApprovers(): Promise<number> {
    const roles = RoleName.options.filter((r) => hasPermission(r, 'chatbot:deploy'));
    return this.prisma.user.count({ where: { status: 'ACTIVE', role: { in: roles } } });
  }

  /** 사유·메모 — 금지어 마스킹 → PII 마스킹본만 저장한다(≤200, 로그 금지). */
  private async maskMemo(text: string): Promise<string> {
    return maskPii(await this.bannedWords.maskPlainText(text)).maskedText;
  }

  private notPendingError(row: RequestRow): ApiException {
    if (row.status === 'CANCELLED' && (row.closedReason === 'BASE_CHANGED' || row.closedReason === 'SCHEDULE_INACTIVE')) {
      return new ApiException('APPROVAL_BASE_CHANGED', 409, '요청한 뒤 운영 버전(또는 예약)이 바뀌어 이 요청은 종료되었습니다. 최신 상태에서 새로 요청해 주세요.');
    }
    return new ApiException('APPROVAL_NOT_PENDING', 409, '이미 처리되었거나 만료된 승인 요청입니다.', [{ field: 'status', message: row.status }]);
  }

  private assertPreviewUsable(preview: ProdSwitchPreviewResponse): void {
    const b = preview.blockers;
    if (b.includes('CHATBOT_ARCHIVED')) throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다.');
    if (b.includes('ENV_MODE_DISABLED')) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');
    if (b.includes('TARGET_NOT_ALLOWED')) throw new ApiException('ENV_TARGET_NOT_STAGING', 409, '전환 대상은 현재 스테이징 또는 운영 이력 버전만 가능합니다.');
    if (b.includes('GATE_BLOCKED')) throw new ApiException('ENV_GATE_NOT_PASSED', 409, '차단 게이트 기준을 충족하지 못해 전환할 수 없습니다.');
    if (b.length > 0) throw new ApiException('NOT_FOUND', 404, '요청하신 버전을 찾을 수 없습니다.');
  }

  private async buildScheduledRequest(chatbotId: string, scheduleId: string, user: SessionUser, now: Date, ttlHours: number) {
    const schedule = await this.prisma.deploySchedule.findUnique({ where: { id: scheduleId } });
    if (!schedule || schedule.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 예약을 찾을 수 없습니다.');
    // 승인자가 예약 작성자가 되는 우회 차단 — 요청자 = 예약 작성자.
    if (schedule.createdById !== user.id) throw new ApiException('FORBIDDEN', 403, '예약을 만든 사람만 승인 요청을 보낼 수 있습니다.');
    if (
      schedule.action !== 'SWITCH_PROD_VERSION' ||
      (schedule.status !== 'PENDING' && schedule.status !== 'HELD') ||
      schedule.scheduledAt.getTime() <= now.getTime() ||
      !schedule.targetVersionId ||
      !schedule.expectedContentHash
    ) {
      throw new ApiException('VALIDATION_FAILED', 400, '입력값을 확인해 주세요.', [{ field: 'deployScheduleId', message: '승인 요청을 보낼 수 있는 운영 전환 예약이 아닙니다.' }]);
    }

    const preview = await this.prodSwitch.preview(chatbotId, { kind: 'SWITCH', targetVersionId: schedule.targetVersionId });
    if (preview.blockers.includes('CHATBOT_ARCHIVED')) throw new ApiException('CHATBOT_ARCHIVED', 409, '보관된 챗봇은 수정할 수 없습니다.');
    if (preview.blockers.includes('ENV_MODE_DISABLED')) throw new ApiException('ENV_MODE_DISABLED', 409, '환경 분리 모드가 꺼져 있습니다.');

    const baseVersion = await this.prisma.chatbotVersion.findUnique({ where: { id: schedule.expectedContentHash }, select: { versionNo: true } });
    return {
      action: 'SCHEDULED_PROD_SWITCH' as const,
      targetVersionId: schedule.targetVersionId,
      targetVersionNo: schedule.targetVersionNo ?? preview.target.versionNo,
      baseProdVersionId: schedule.expectedContentHash,
      baseProdVersionNo: baseVersion?.versionNo ?? preview.current.versionNo,
      deployScheduleId: schedule.id,
      gateSnapshot: JSON.stringify(preview.gate),
      warningCodes: JSON.stringify(preview.warnings.map((w) => w.code)),
      diffChangedCount: preview.diffSummary.totalChanged,
      expiresAt: computeExpiresAt(now, ttlHours, schedule.scheduledAt),
    };
  }

  /**
   * 대기 요청의 지연 종결(§10.3) — 유효 상태가 종결이면 그 자리에서 `PENDING` CAS로 종결하고 감사 1건(주체 system)을 남긴다.
   * 종결된 행은 최신으로 다시 읽어 돌려준다. 이미 종결된 행은 그대로.
   */
  private async sweep(rows: readonly RequestRow[]): Promise<RequestRow[]> {
    const pending = rows.filter((r) => r.status === 'PENDING');
    if (pending.length === 0) return [...rows];

    const chatbotIds = [...new Set(pending.map((r) => r.chatbotId))];
    const scheduleIds = [...new Set(pending.map((r) => r.deployScheduleId).filter((id): id is string => !!id))];
    const [chatbots, envs, schedules] = await Promise.all([
      this.prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, prodVersionId: true } }),
      this.prisma.chatbotEnvironment.findMany({ where: { chatbotId: { in: chatbotIds } }, select: { chatbotId: true, approvalRequired: true } }),
      scheduleIds.length > 0 ? this.prisma.deploySchedule.findMany({ where: { id: { in: scheduleIds } } }) : Promise.resolve([]),
    ]);
    const prodOf = new Map(chatbots.map((c) => [c.id, c.prodVersionId]));
    const policyOf = new Map(envs.map((e) => [e.chatbotId, e.approvalRequired]));
    const scheduleOf = new Map(schedules.map((s) => [s.id, s]));
    const now = this.now();

    const out: RequestRow[] = [];
    for (const row of rows) {
      if (row.status !== 'PENDING') {
        out.push(row);
        continue;
      }
      const schedule = row.deployScheduleId ? scheduleOf.get(row.deployScheduleId) : undefined;
      const verdict: EffectiveVerdict = effectiveVerdict(row, now, {
        policyRequired: policyOf.get(row.chatbotId) ?? false,
        currentProdVersionId: prodOf.get(row.chatbotId) ?? null,
        schedule: schedule
          ? { status: schedule.status, scheduledAt: schedule.scheduledAt, targetVersionId: schedule.targetVersionId, expectedProdVersionId: schedule.expectedContentHash }
          : null,
      });
      if (verdict.kind === 'PENDING') {
        out.push(row);
        continue;
      }
      const data: CloseData = verdict.kind === 'EXPIRED' ? { status: 'EXPIRED' } : { status: 'CANCELLED', closedReason: verdict.closedReason };
      const count = await this.store.close(row.id, data);
      const fresh = (await this.store.find(row.id)) ?? row;
      if (count > 0) await this.auditTransition(fresh, 'PENDING', { actor: undefined, summary: `${versionLabel(fresh)} 자동 종결` });
      out.push(fresh);
    }
    return out;
  }

  /** 승인 실행 실패 분류(§10.5 표) — 대기 유지 · 기준 변경 종결 · 승인 기록 + 적용 실패. */
  private async classifyApplyFailure(e: unknown, row: RequestRow, user: SessionUser, now: Date): Promise<unknown> {
    if (!(e instanceof ApiException)) return e;
    const code = codeOf(e);

    if (code === 'ENV_POINTER_STALE') {
      const count = await this.store.close(row.id, { status: 'CANCELLED', closedReason: 'BASE_CHANGED' });
      if (count > 0) {
        const fresh = (await this.store.find(row.id)) ?? row;
        await this.auditTransition(fresh, 'PENDING', { actor: user, summary: `${versionLabel(fresh)} 승인 시도 중 기준 변경으로 종료` });
      }
      return new ApiException('APPROVAL_BASE_CHANGED', 409, '요청한 뒤 운영 버전이 바뀌어 이 요청은 종료되었습니다. 최신 상태에서 새로 요청해 주세요.');
    }

    const applyFailure = ['ENV_GATE_NOT_PASSED', 'ENV_TARGET_NOT_STAGING', 'NOT_FOUND', 'CHATBOT_ARCHIVED', 'ENV_MODE_DISABLED'];
    if (applyFailure.includes(code)) {
      const count = await this.store.close(row.id, { status: 'APPROVED', outcome: 'FAILED', failureCode: code, decidedById: user.id, decidedByEmail: user.email, decidedAt: now });
      if (count > 0) {
        const fresh = (await this.store.find(row.id)) ?? row;
        await this.auditTransition(fresh, 'PENDING', { actor: user, summary: `${versionLabel(fresh)} 승인 기록 · 적용 실패(${code})` });
      }
      const body = e.getResponse() as { message?: string; details?: Array<{ field: string; message: string }> };
      return new ApiException(code as ApiErrorCode, e.getStatus(), body.message ?? '적용하지 못했습니다.', [
        ...(body.details ?? []),
        { field: 'requestStatus', message: 'APPROVED' },
        { field: 'outcome', message: 'FAILED' },
      ]);
    }
    // VALIDATION_FAILED(경고 미확인) · ENV_SWITCH_BUSY · APPROVAL_* — 대기 유지, 그대로 전달.
    return e;
  }

  private async auditTransition(row: RequestRow, beforeStatus: string, opts: { actor: SessionUser | undefined; summary: string }): Promise<void> {
    await this.auditLog.record({
      action: 'STATUS_CHANGE',
      targetType: 'ProdSwitchApprovalRequest',
      targetId: row.id,
      targetName: versionLabel(row),
      chatbotId: row.chatbotId,
      before: { ...toApprovalAuditView(row), status: beforeStatus, outcome: null, failureCode: null, closedReason: null },
      after: toApprovalAuditView(row),
      summary: opts.summary,
      actorOverride: opts.actor ? { id: opts.actor.id, email: opts.actor.email, role: opts.actor.role } : { ...SYSTEM_ACTOR },
    });
  }

  private async auditSelfAttempt(user: SessionUser, verb: 'approve' | 'reject'): Promise<void> {
    await this.auditLog.record({
      action: 'PERMISSION_DENIED',
      targetType: 'Session',
      targetId: user.id,
      summary: `본인이 요청한 운영 전환 승인 요청을 ${verb === 'approve' ? '승인' : '반려'}하려는 시도`,
      actorOverride: { id: user.id, email: user.email, role: user.role },
    });
  }
}
