import { Injectable } from '@nestjs/common';
import { GUARDRAIL_LIMITS } from '@chat-bot/shared-types';
import type { GuardrailEventItem, GuardrailEventListQuery, GuardrailOverview, GuardrailOverviewQuery, Paginated } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { toPaginated } from '../common/pagination';
import { resolveStatsPeriodOrThrow } from '../stats/stats-request.helpers';
import type { StatsRangeLimits } from '../stats/lib/stats-period';
import { GuardrailRuntimeService } from './runtime/guardrail-runtime.service';
import { aggregateOverview } from './lib/overview-aggregate';
import type { EventGroupRow, PiiGroupRow, RuleGroupRow } from './lib/overview-aggregate';

/** 최대 기간 90일(설계서 §8.4) — 일 단위만 쓰므로 주·월 상한은 사용되지 않는다. */
const PERIOD_LIMITS: StatsRangeLimits = {
  maxRangeDays: GUARDRAIL_LIMITS.overviewMaxRangeDays,
  maxRangeWeeks: 13,
  maxRangeMonths: 3,
  defaultDays: 30,
  defaultWeeks: 4,
  defaultMonths: 3,
};

/**
 * 현황 집계(§8.4) · 이벤트 목록(§8.5) — 읽기 전용. 합계는 같은 `groupBy` 결과에서 파생한다(AC-AG5-2).
 * 이벤트 목록은 대화 기록 **마스킹본**을 함께 싣는다(R-13) — 원문 경로 0(상담 `rawText` 미조회).
 */
@Injectable()
export class GuardrailOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
    private readonly runtime: GuardrailRuntimeService,
  ) {}

  async getOverview(chatbotId: string, query: GuardrailOverviewQuery): Promise<GuardrailOverview> {
    const { prodVersionId } = await this.scope.assertReadable(chatbotId);
    const period = resolveStatsPeriodOrThrow(query.from, query.to, 'DAY', PERIOD_LIMITS);
    const dayRange = { gte: period.fromDayBucket, lte: period.toDayBucket };
    const eventWhere = { chatbotId, dayBucket: dayRange };

    const [eventGroups, ruleGroups, piiGroups, answeredByRagCount, outboundStagedCount, alerts, currentRules, env] = await Promise.all([
      this.prisma.guardrailEvent.groupBy({ by: ['stage', 'kind', 'appliedAction', 'effect', 'decisive'], where: eventWhere, _count: { _all: true } }),
      this.prisma.guardrailEvent.groupBy({
        by: ['ruleId', 'ruleName', 'category', 'stage', 'effect'],
        where: { ...eventWhere, kind: 'RULE', ruleId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.guardrailEvent.groupBy({ by: ['piiKind'], where: { ...eventWhere, kind: 'PII', piiKind: { not: null } }, _count: { _all: true }, _sum: { piiCount: true } }),
      this.prisma.conversationLog.count({ where: { chatbotId, dayBucket: dayRange, answeredByRag: true } }),
      this.prisma.conversationLog.count({ where: { chatbotId, dayBucket: dayRange, guardrailStage: 'OUTBOUND' } }),
      this.prisma.environmentSwitchLog.findMany({
        where: { chatbotId, approvalMode: 'SOLO_ROLLBACK', createdAt: { gte: period.periodStart, lte: period.periodEnd } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.guardrailRule.findMany({ where: { chatbotId }, select: { id: true, name: true, category: true, action: true, enabled: true } }),
      this.prisma.chatbotEnvironment.findUnique({ where: { chatbotId }, select: { approvalRequired: true } }),
    ]);

    const aggregate = aggregateOverview({
      eventGroups: eventGroups.map<EventGroupRow>((g) => ({
        stage: g.stage as EventGroupRow['stage'],
        kind: g.kind as EventGroupRow['kind'],
        appliedAction: g.appliedAction as EventGroupRow['appliedAction'],
        effect: g.effect as EventGroupRow['effect'],
        decisive: g.decisive,
        count: g._count._all,
      })),
      ruleGroups: ruleGroups.map<RuleGroupRow>((g) => ({
        ruleId: g.ruleId as string,
        ruleName: g.ruleName,
        category: g.category,
        stage: g.stage as RuleGroupRow['stage'],
        effect: g.effect as RuleGroupRow['effect'],
        count: g._count._all,
      })),
      piiGroups: piiGroups.map<PiiGroupRow>((g) => ({ piiKind: g.piiKind as string, answers: g._count._all, count: g._sum.piiCount ?? 0 })),
      currentRules: currentRules.map((r) => ({
        id: r.id,
        name: r.name,
        category: r.category as GuardrailOverview['rules'][number]['category'] & string,
        action: r.action as 'MONITOR' | 'REPLACE' | 'NO_RAG',
        enabled: r.enabled,
      })),
      answeredByRagCount,
      outboundStagedCount,
    });

    return {
      from: period.fromDayBucket,
      to: period.toDayBucket,
      serverEnabled: this.runtime.isServerEnabled(),
      ...aggregate,
      alerts: alerts.map((a) => ({ switchLogId: a.id, at: a.createdAt, actorEmail: a.actorEmail, fromVersionNo: a.fromVersionNo, toVersionNo: a.toVersionNo })),
      hitl: { envModeOn: prodVersionId !== null, approvalRequired: env?.approvalRequired ?? false },
    };
  }

  async listEvents(chatbotId: string, query: GuardrailEventListQuery): Promise<Paginated<GuardrailEventItem>> {
    await this.scope.assertReadable(chatbotId);
    const period = resolveStatsPeriodOrThrow(query.from, query.to, 'DAY', PERIOD_LIMITS);
    const where = {
      chatbotId,
      dayBucket: { gte: period.fromDayBucket, lte: period.toDayBucket },
      ...(query.ruleId ? { ruleId: query.ruleId } : {}),
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.appliedAction ? { appliedAction: query.appliedAction } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.guardrailEvent.count({ where }),
      this.prisma.guardrailEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    ]);

    const messageIds = [...new Set(rows.map((r) => r.messageId))];
    const logs =
      messageIds.length === 0
        ? []
        : await this.prisma.conversationLog.findMany({
            where: { id: { in: messageIds }, chatbotId },
            select: { id: true, userMessage: true, botResponse: true, textPurgedAt: true },
          });
    const logById = new Map(logs.map((l) => [l.id, l]));

    const items = rows.map<GuardrailEventItem>((r) => {
      const log = logById.get(r.messageId);
      return {
        id: r.id,
        createdAt: r.createdAt,
        messageId: r.messageId,
        stage: r.stage as GuardrailEventItem['stage'],
        kind: r.kind as GuardrailEventItem['kind'],
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        category: r.category as GuardrailEventItem['category'],
        ruleAction: r.ruleAction as GuardrailEventItem['ruleAction'],
        appliedAction: r.appliedAction as GuardrailEventItem['appliedAction'],
        decisive: r.decisive,
        effect: r.effect as GuardrailEventItem['effect'],
        piiKind: r.piiKind as GuardrailEventItem['piiKind'],
        piiCount: r.piiCount,
        errorCode: r.errorCode,
        conversation: log
          ? log.textPurgedAt
            ? { userMessage: '', botResponse: '', textPurged: true }
            : { userMessage: log.userMessage, botResponse: log.botResponse, textPurged: false }
          : null,
      };
    });
    return toPaginated(items, total, query.page, query.pageSize);
  }
}
