import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ChatbotRetentionUpdateDto,
  GlobalRetentionUpdateDto,
  PaginationQuery,
  RetentionKindView,
  RetentionOverrideItem,
  RetentionOverrideListResponse,
  RetentionPolicyResponse,
  RetentionPreviewRequestDto,
  RetentionPreviewResponse,
  RetentionTargetKind,
} from '@chat-bot/shared-types';
import { CONVERSATION_RETENTION_KINDS, RetentionTargetKind as RetentionTargetKindEnum } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ApiException } from '../common/api.exception';
import { AuditLogService } from '../audit-logs/audit-log.service';
import type { ChatbotRetentionDaysMap, RetentionBounds, RetentionDaysMap, RetentionPendingMap } from './lib/retention-policy';
import { computeCutoff, judgeShorten, resolveChatbotStoredDays, resolveEffectiveDays, resolveGlobalStoredDays, validateRange } from './lib/retention-policy';
import { nextWindowStart as computeNextWindowStart } from './lib/retention-window';

const ALL_KINDS = RetentionTargetKindEnum.options;
const CHATBOT_NOT_FOUND_MESSAGE = '요청하신 챗봇을 찾을 수 없습니다.';

function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * ★ 보존 정책 쓰기 유일 파일(No.45 §8.3) — `RetentionPolicy` 전역 1행(`scopeKey='GLOBAL'`) +
 * 챗봇 재정의 N행(`scopeKey=chatbotId`)을 함께 관리한다. 챗봇 재정의는 대화 원천 4종만(§8.5) —
 * `ChatbotRetentionController`가 이 서비스의 `*Chatbot*` 메서드를 호출한다. `ARCHIVED` 챗봇도
 * 재정의 조회·저장을 허용한다(거버넌스 설정은 자산이 아니다 — EX-DG-18, §8.3) — `ChatbotScopeService
 * .assertWritable()`(ARCHIVED 409)을 쓰지 않고 존재만 확인한다.
 */
@Injectable()
export class RetentionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  bounds(): RetentionBounds {
    return {
      minConversationDays: this.config.get<number>('RETENTION_MIN_DAYS_CONVERSATION') ?? 7,
      minAuditDays: this.config.get<number>('RETENTION_MIN_DAYS_AUDIT') ?? 365,
      maxDays: this.config.get<number>('RETENTION_MAX_DAYS') ?? 3650,
      shortenGraceDays: this.config.get<number>('RETENTION_SHORTEN_GRACE_DAYS') ?? 7,
    };
  }

  private retentionWindow(): string {
    return this.config.get<string>('DATA_RETENTION_WINDOW') ?? '02:00-05:00';
  }

  private async loadGlobalRow() {
    return this.prisma.retentionPolicy.findUnique({ where: { scopeKey: 'GLOBAL' } });
  }

  private async loadChatbotRow(chatbotId: string) {
    return this.prisma.retentionPolicy.findUnique({ where: { scopeKey: chatbotId } });
  }

  private async assertChatbotExists(chatbotId: string): Promise<{ id: string; name: string; status: string }> {
    const row = await this.prisma.chatbot.findUnique({ where: { id: chatbotId }, select: { id: true, name: true, status: true } });
    if (!row) throw new ApiException('NOT_FOUND', 404, CHATBOT_NOT_FOUND_MESSAGE);
    return row;
  }

  async getGlobal(): Promise<RetentionPolicyResponse> {
    const row = await this.loadGlobalRow();
    const bounds = this.bounds();
    const days: RetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    const pending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};
    const now = new Date();

    const kinds: RetentionKindView[] = ALL_KINDS.map((kind) => {
      const resolved = resolveGlobalStoredDays(kind, days, pending, now);
      const p = pending[kind];
      const pendingUnapplied = p && new Date(p.effectiveAt).getTime() > now.getTime() ? p : undefined;
      const min = kind === 'AUDIT_LOGS' ? bounds.minAuditDays : bounds.minConversationDays;
      return {
        kind,
        days: resolved,
        source: days[kind] !== undefined || pendingUnapplied ? 'GLOBAL' : 'DEFAULT',
        ...(pendingUnapplied ? { pending: { days: pendingUnapplied.days === 'GLOBAL' ? null : pendingUnapplied.days, effectiveAt: new Date(pendingUnapplied.effectiveAt) } } : {}),
        ...(resolved !== null && resolved < min ? { belowServerMinimum: true as const } : {}),
      };
    });

    return {
      scope: 'GLOBAL',
      kinds,
      bounds,
      updatedAt: row?.updatedAt ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  }

  async updateGlobal(dto: GlobalRetentionUpdateDto): Promise<RetentionPolicyResponse> {
    const bounds = this.bounds();
    const now = new Date();
    const row = await this.loadGlobalRow();
    const currentDays: RetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    const currentPending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};

    // 도래한 pending을 흡수한다.
    const absorbedDays: RetentionDaysMap = { ...currentDays };
    const nextPending: RetentionPendingMap = {};
    for (const kind of ALL_KINDS) {
      const p = currentPending[kind];
      if (p) {
        if (new Date(p.effectiveAt).getTime() <= now.getTime()) {
          absorbedDays[kind] = p.days === 'GLOBAL' ? null : p.days;
        } else {
          nextPending[kind] = p;
        }
      }
    }

    let anyShorten = false;
    const appliedNow: RetentionTargetKind[] = [];
    const pendingKinds: RetentionTargetKind[] = [];

    for (const kind of ALL_KINDS) {
      const newDays = dto.days[kind];
      const rangeError = validateRange(kind, newDays, bounds);
      if (rangeError) throw new ApiException('RETENTION_OUT_OF_RANGE', 400, rangeError, [{ field: kind, message: rangeError }]);

      const currentEffective = resolveGlobalStoredDays(kind, absorbedDays, {}, now);
      const judgement = judgeShorten(currentEffective, newDays, now, bounds.shortenGraceDays);
      if (judgement.shortening) {
        anyShorten = true;
        nextPending[kind] = { days: newDays, effectiveAt: judgement.effectiveAt.toISOString() };
        pendingKinds.push(kind);
      } else {
        absorbedDays[kind] = newDays;
        delete nextPending[kind];
        appliedNow.push(kind);
      }
    }

    if (anyShorten && dto.confirmText !== '보존기간 단축') {
      throw new ApiException('CONFIRM_NAME_MISMATCH', 400, '보존기간을 단축하려면 "보존기간 단축"을 정확히 입력해야 합니다.');
    }

    await this.prisma.retentionPolicy.upsert({
      where: { scopeKey: 'GLOBAL' },
      create: {
        scopeKey: 'GLOBAL',
        days: JSON.stringify(absorbedDays),
        pending: JSON.stringify(nextPending),
        updatedById: this.auditLog.currentActorSnapshot()?.id ?? null,
        updatedByEmail: this.auditLog.currentActorSnapshot()?.email ?? null,
      },
      update: {
        days: JSON.stringify(absorbedDays),
        pending: JSON.stringify(nextPending),
        updatedById: this.auditLog.currentActorSnapshot()?.id ?? null,
        updatedByEmail: this.auditLog.currentActorSnapshot()?.email ?? null,
      },
    });

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'RetentionPolicy',
      targetId: 'GLOBAL',
      summary: `보존기간 변경(단축 ${pendingKinds.length}종 유예 · 즉시 ${appliedNow.length}종)`,
      before: this.toAuditSnapshot(currentDays, currentPending),
      after: this.toAuditSnapshot(absorbedDays, nextPending),
    });

    return this.getGlobal();
  }

  private toAuditSnapshot(days: Record<string, number | null | 'GLOBAL' | undefined>, pending: RetentionPendingMap): Record<string, unknown> {
    return {
      conversationTextDays: days.CONVERSATION_TEXT ?? null,
      unansweredClosedDays: days.UNANSWERED_CLOSED ?? null,
      surveyFreeTextDays: days.SURVEY_FREE_TEXT ?? null,
      handoffTextDays: days.HANDOFF_TEXT ?? null,
      callLogsDays: days.CALL_LOGS ?? null,
      auditLogsDays: days.AUDIT_LOGS ?? null,
      pendingKinds: Object.keys(pending),
      pendingEffectiveAt: Object.values(pending)[0]?.effectiveAt ?? null,
    };
  }

  async cancelPending(): Promise<RetentionPolicyResponse> {
    const row = await this.loadGlobalRow();
    const pending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};
    if (Object.keys(pending).length === 0) throw new ApiException('NOT_FOUND', 404, '취소할 보존기간 단축 예약이 없습니다.');

    const currentDays: RetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    await this.prisma.retentionPolicy.update({ where: { scopeKey: 'GLOBAL' }, data: { pending: JSON.stringify({}) } });

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'RetentionPolicy',
      targetId: 'GLOBAL',
      summary: '보존기간 단축 예약 취소',
      before: this.toAuditSnapshot(currentDays, pending),
      after: this.toAuditSnapshot(currentDays, {}),
    });

    return this.getGlobal();
  }

  async preview(dto: RetentionPreviewRequestDto): Promise<RetentionPreviewResponse> {
    const bounds = this.bounds();
    const now = new Date();
    const row = await this.loadGlobalRow();
    const currentDays: RetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    const currentPending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};

    const items = await Promise.all(
      ALL_KINDS.filter((k) => dto.days[k] !== undefined).map(async (kind) => {
        const newDaysRaw = dto.days[kind] as number | null | 'GLOBAL';
        const newDays = newDaysRaw === 'GLOBAL' ? null : newDaysRaw;
        const currentEffective = resolveGlobalStoredDays(kind, currentDays, currentPending, now);
        const judgement = judgeShorten(currentEffective, newDays, now, bounds.shortenGraceDays);
        const affectedCount = newDays === null ? null : await this.countAffected(kind, computeCutoff(Math.max(newDays, kind === 'AUDIT_LOGS' ? bounds.minAuditDays : bounds.minConversationDays), now));
        return {
          kind,
          currentDays: currentEffective,
          newDays,
          shortening: judgement.shortening,
          affectedCount,
          firstPurgeAt: judgement.shortening ? judgement.effectiveAt : newDays !== null ? computeNextWindowStart(now, this.retentionWindow()) : null,
        };
      }),
    );

    const requiresConfirm = items.some((i) => i.shortening);
    return { items, requiresConfirm, ...(requiresConfirm ? { confirmHint: '보존기간 단축' } : {}) };
  }

  private async countAffected(kind: RetentionTargetKind, cutoff: Date): Promise<number> {
    if (kind === 'CONVERSATION_TEXT') return this.prisma.conversationLog.count({ where: { textPurgedAt: null, createdAt: { lt: cutoff } } });
    if (kind === 'UNANSWERED_CLOSED') return this.prisma.unansweredQuestion.count({ where: { status: { in: ['RESOLVED', 'IGNORED'] }, textPurgedAt: null, lastOccurredAt: { lt: cutoff } } });
    if (kind === 'SURVEY_FREE_TEXT') return this.prisma.surveyAnswer.count({ where: { textPurgedAt: null, textValue: { not: null }, answeredAt: { lt: cutoff } } });
    if (kind === 'HANDOFF_TEXT') return this.prisma.handoffMessage.count({ where: { textPurgedAt: null, createdAt: { lt: cutoff }, handoffSession: { status: 'ENDED' } } });
    if (kind === 'CALL_LOGS') {
      const [rag, api, workflow] = await Promise.all([
        this.prisma.ragCallLog.count({ where: { createdAt: { lt: cutoff } } }),
        this.prisma.apiCallLog.count({ where: { createdAt: { lt: cutoff } } }),
        // [신규 No.41] 업무 자동화 실행 이력 — 종단 상태만(대기·보류·발송 중 제외, §10.3).
        this.prisma.workflowRun.count({
          where: { createdAt: { lt: cutoff }, status: { in: ['SUCCEEDED', 'FAILED', 'SKIPPED', 'CANCELLED', 'EXPIRED'] } },
        }),
      ]);
      return rag + api + workflow;
    }
    // AUDIT_LOGS
    return this.prisma.auditLog.count({ where: { createdAt: { lt: cutoff } } });
  }

  // ── 챗봇별 재정의(§8.5, 대화 원천 4종만) ──

  async getChatbot(chatbotId: string): Promise<RetentionPolicyResponse> {
    await this.assertChatbotExists(chatbotId);
    const bounds = this.bounds();
    const now = new Date();
    const { globalDays, globalPending } = await this.loadGlobalForResolve();
    const row = await this.loadChatbotRow(chatbotId);
    const days: ChatbotRetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    const pending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};

    const kinds: RetentionKindView[] = CONVERSATION_RETENTION_KINDS.map((kind) =>
      this.buildChatbotKindView(kind, days, pending, globalDays, globalPending, bounds, now),
    );

    return { scope: 'CHATBOT', chatbotId, kinds, bounds, updatedAt: row?.updatedAt ?? null, updatedByEmail: row?.updatedByEmail ?? null };
  }

  async updateChatbot(chatbotId: string, dto: ChatbotRetentionUpdateDto): Promise<RetentionPolicyResponse> {
    const chatbot = await this.assertChatbotExists(chatbotId);
    const bounds = this.bounds();
    const now = new Date();
    const { globalDays, globalPending } = await this.loadGlobalForResolve();

    const row = await this.loadChatbotRow(chatbotId);
    const currentDays: ChatbotRetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    const currentPending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};

    const absorbedDays: ChatbotRetentionDaysMap = { ...currentDays };
    const nextPending: RetentionPendingMap = {};
    for (const kind of CONVERSATION_RETENTION_KINDS) {
      const p = currentPending[kind];
      if (p) {
        if (new Date(p.effectiveAt).getTime() <= now.getTime()) absorbedDays[kind] = p.days;
        else nextPending[kind] = p;
      }
    }

    let anyShorten = false;
    const appliedNow: RetentionTargetKind[] = [];
    const pendingKinds: RetentionTargetKind[] = [];

    for (const kind of CONVERSATION_RETENTION_KINDS) {
      const newValue = dto.days[kind];
      const globalResolved = resolveGlobalStoredDays(kind, globalDays, globalPending, now);
      if (newValue !== 'GLOBAL') {
        const rangeError = validateRange(kind, newValue, bounds);
        if (rangeError) throw new ApiException('RETENTION_OUT_OF_RANGE', 400, rangeError, [{ field: kind, message: rangeError }]);
      }
      const currentEffective = resolveChatbotStoredDays(kind, absorbedDays, {}, globalResolved, now);
      const newEffective = newValue === 'GLOBAL' ? globalResolved : newValue;
      const judgement = judgeShorten(currentEffective, newEffective, now, bounds.shortenGraceDays);
      if (judgement.shortening) {
        anyShorten = true;
        nextPending[kind] = { days: newValue, effectiveAt: judgement.effectiveAt.toISOString() };
        pendingKinds.push(kind);
      } else {
        absorbedDays[kind] = newValue;
        delete nextPending[kind];
        appliedNow.push(kind);
      }
    }

    if (anyShorten && dto.confirmText !== chatbot.name) {
      throw new ApiException('CONFIRM_NAME_MISMATCH', 400, '보존기간을 단축하려면 챗봇 이름을 정확히 입력해야 합니다.');
    }

    await this.prisma.retentionPolicy.upsert({
      where: { scopeKey: chatbotId },
      create: {
        scopeKey: chatbotId,
        chatbotId,
        days: JSON.stringify(absorbedDays),
        pending: JSON.stringify(nextPending),
        updatedById: this.auditLog.currentActorSnapshot()?.id ?? null,
        updatedByEmail: this.auditLog.currentActorSnapshot()?.email ?? null,
      },
      update: {
        days: JSON.stringify(absorbedDays),
        pending: JSON.stringify(nextPending),
        updatedById: this.auditLog.currentActorSnapshot()?.id ?? null,
        updatedByEmail: this.auditLog.currentActorSnapshot()?.email ?? null,
      },
    });

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'RetentionPolicy',
      targetId: chatbotId,
      chatbotId,
      targetName: chatbot.name,
      summary: `보존기간 변경(챗봇 재정의 — 단축 ${pendingKinds.length}종 유예 · 즉시 ${appliedNow.length}종)`,
      before: this.toAuditSnapshot(currentDays, currentPending),
      after: this.toAuditSnapshot(absorbedDays, nextPending),
    });

    return this.getChatbot(chatbotId);
  }

  async cancelChatbotPending(chatbotId: string): Promise<RetentionPolicyResponse> {
    const chatbot = await this.assertChatbotExists(chatbotId);
    const row = await this.loadChatbotRow(chatbotId);
    const pending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};
    if (Object.keys(pending).length === 0) throw new ApiException('NOT_FOUND', 404, '취소할 보존기간 단축 예약이 없습니다.');

    const days: ChatbotRetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    await this.prisma.retentionPolicy.update({ where: { scopeKey: chatbotId }, data: { pending: JSON.stringify({}) } });

    await this.auditLog.record({
      action: 'UPDATE',
      targetType: 'RetentionPolicy',
      targetId: chatbotId,
      chatbotId,
      targetName: chatbot.name,
      summary: '보존기간 단축 예약 취소(챗봇)',
      before: this.toAuditSnapshot(days, pending),
      after: this.toAuditSnapshot(days, {}),
    });

    return this.getChatbot(chatbotId);
  }

  async previewChatbot(chatbotId: string, dto: RetentionPreviewRequestDto): Promise<RetentionPreviewResponse> {
    const chatbot = await this.assertChatbotExists(chatbotId);
    const bounds = this.bounds();
    const now = new Date();
    const { globalDays, globalPending } = await this.loadGlobalForResolve();
    const row = await this.loadChatbotRow(chatbotId);
    const currentDays: ChatbotRetentionDaysMap = row ? safeJsonParse(row.days, {}) : {};
    const currentPending: RetentionPendingMap = row ? safeJsonParse(row.pending, {}) : {};

    const items = await Promise.all(
      CONVERSATION_RETENTION_KINDS.filter((k) => dto.days[k] !== undefined).map(async (kind) => {
        const newValueRaw = dto.days[kind] as number | null | 'GLOBAL';
        const globalResolved = resolveGlobalStoredDays(kind, globalDays, globalPending, now);
        const newDays = newValueRaw === 'GLOBAL' ? globalResolved : newValueRaw;
        const currentEffective = resolveChatbotStoredDays(kind, currentDays, currentPending, globalResolved, now);
        const judgement = judgeShorten(currentEffective, newDays, now, bounds.shortenGraceDays);
        const affectedCount = newDays === null ? null : await this.countAffectedForChatbot(chatbotId, kind, computeCutoff(Math.max(newDays, bounds.minConversationDays), now));
        return {
          kind,
          currentDays: currentEffective,
          newDays,
          shortening: judgement.shortening,
          affectedCount,
          firstPurgeAt: judgement.shortening ? judgement.effectiveAt : newDays !== null ? computeNextWindowStart(now, this.retentionWindow()) : null,
        };
      }),
    );

    const requiresConfirm = items.some((i) => i.shortening);
    return { items, requiresConfirm, ...(requiresConfirm ? { confirmHint: chatbot.name } : {}) };
  }

  async listOverrides(query: PaginationQuery): Promise<RetentionOverrideListResponse> {
    const where = { chatbotId: { not: null } };
    const [rows, total] = await Promise.all([
      this.prisma.retentionPolicy.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.retentionPolicy.count({ where }),
    ]);

    const chatbotIds = rows.map((r) => r.chatbotId as string);
    const chatbots = chatbotIds.length > 0 ? await this.prisma.chatbot.findMany({ where: { id: { in: chatbotIds } }, select: { id: true, name: true, status: true } }) : [];
    const chatbotById = new Map(chatbots.map((c) => [c.id, c]));
    const bounds = this.bounds();
    const now = new Date();
    const { globalDays, globalPending } = await this.loadGlobalForResolve();

    const items: RetentionOverrideItem[] = rows.map((r) => {
      const chatbotId = r.chatbotId as string;
      const chatbot = chatbotById.get(chatbotId);
      const days: ChatbotRetentionDaysMap = safeJsonParse(r.days, {});
      const pending: RetentionPendingMap = safeJsonParse(r.pending, {});
      const kinds = CONVERSATION_RETENTION_KINDS.map((kind) => this.buildChatbotKindView(kind, days, pending, globalDays, globalPending, bounds, now));
      return { chatbotId, chatbotName: chatbot?.name ?? '(삭제됨)', status: chatbot?.status ?? 'UNKNOWN', kinds };
    });

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private async loadGlobalForResolve(): Promise<{ globalDays: RetentionDaysMap; globalPending: RetentionPendingMap }> {
    const globalRow = await this.loadGlobalRow();
    return {
      globalDays: globalRow ? safeJsonParse(globalRow.days, {}) : {},
      globalPending: globalRow ? safeJsonParse(globalRow.pending, {}) : {},
    };
  }

  private buildChatbotKindView(
    kind: RetentionTargetKind,
    days: ChatbotRetentionDaysMap,
    pending: RetentionPendingMap,
    globalDays: RetentionDaysMap,
    globalPending: RetentionPendingMap,
    bounds: RetentionBounds,
    now: Date,
  ): RetentionKindView {
    const globalResolved = resolveGlobalStoredDays(kind, globalDays, globalPending, now);
    const resolved = resolveChatbotStoredDays(kind, days, pending, globalResolved, now);
    const p = pending[kind];
    const pendingUnapplied = p && new Date(p.effectiveAt).getTime() > now.getTime() ? p : undefined;
    const stored = days[kind];
    const source: 'GLOBAL' | 'CHATBOT' | 'DEFAULT' = stored !== undefined && stored !== 'GLOBAL' ? 'CHATBOT' : pendingUnapplied ? 'CHATBOT' : 'GLOBAL';
    const min = bounds.minConversationDays;
    return {
      kind,
      days: resolved,
      source,
      ...(pendingUnapplied ? { pending: { days: pendingUnapplied.days === 'GLOBAL' ? null : pendingUnapplied.days, effectiveAt: new Date(pendingUnapplied.effectiveAt) } } : {}),
      ...(resolved !== null && resolved < min ? { belowServerMinimum: true as const } : {}),
    };
  }

  private async countAffectedForChatbot(chatbotId: string, kind: RetentionTargetKind, cutoff: Date): Promise<number> {
    if (kind === 'CONVERSATION_TEXT') return this.prisma.conversationLog.count({ where: { chatbotId, textPurgedAt: null, createdAt: { lt: cutoff } } });
    if (kind === 'UNANSWERED_CLOSED') {
      return this.prisma.unansweredQuestion.count({ where: { chatbotId, status: { in: ['RESOLVED', 'IGNORED'] }, textPurgedAt: null, lastOccurredAt: { lt: cutoff } } });
    }
    if (kind === 'SURVEY_FREE_TEXT') {
      const surveys = await this.prisma.survey.findMany({ where: { chatbotId }, select: { id: true } });
      const ids = surveys.map((s) => s.id);
      if (ids.length === 0) return 0;
      return this.prisma.surveyAnswer.count({ where: { surveyId: { in: ids }, textPurgedAt: null, textValue: { not: null }, answeredAt: { lt: cutoff } } });
    }
    // HANDOFF_TEXT
    return this.prisma.handoffMessage.count({ where: { chatbotId, textPurgedAt: null, createdAt: { lt: cutoff }, handoffSession: { status: 'ENDED' } } });
  }
}
