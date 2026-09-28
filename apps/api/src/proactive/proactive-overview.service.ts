import { Injectable } from '@nestjs/common';
import { hostMatchesRules, PROACTIVE_LIMITS, toKstDayBucket } from '@chat-bot/shared-types';
import type { ProactiveOverviewResponse, ProactiveRuleView, ProactiveStatsQuery, ProactiveStatsResponse, ProactiveTrigger } from '@chat-bot/shared-types';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { BannedWordFilterService } from '../banned-words/banned-word-filter.service';
import { ApiException } from '../common/api.exception';
import { ProactiveTargetCheckService } from './proactive-target-check.service';
import type { ServingNodeCheckResult } from './proactive-target-check.service';
import { decodeProactiveRule } from './lib/rule-codec';
import type { DecodedProactiveRule } from './lib/rule-codec';
import { computePeriodState } from './lib/schedule-window';
import { evaluateRuleIssues } from './lib/rule-servability';
import { looksLikeContactInfo } from './lib/contact-like';
import { parseProactiveLinkPolicyHosts, safeHostOf } from './lib/link-policy';
import { aggregateProactiveStats, isFrequentlyDismissed } from './lib/stats-aggregate';
import { resolveProactiveStatsRange } from './lib/stats-range';

const FALLBACK_TRIGGER: ProactiveTrigger = { kind: 'PAGE_DWELL', pathInclude: ['/'], pathExclude: [], dwellSec: PROACTIVE_LIMITS.dwellSecDefault };
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type ProactiveRuleRow = {
  id: string;
  name: string;
  enabled: boolean;
  position: number;
  trigger: string;
  text: string;
  buttons: string;
  devices: string;
  startsAt: Date | null;
  endsAt: Date | null;
  schedule: string | null;
  purposeConfirmedAt: Date;
  updatedAt: Date;
};

type Counter = { shown: number; clicked: number; dismissed: number; optedOut: number };
const EMPTY_COUNTER: Counter = { shown: 0, clicked: 0, dismissed: 0, optedOut: 0 };

interface BuildViewCtx {
  nodeCheck: ServingNodeCheckResult;
  linkHosts: { host: string; includeSubdomains: boolean }[];
  now: Date;
  last7d: Counter;
}

function hasNodeButtonRow(row: ProactiveRuleRow, decoded: DecodedProactiveRule | null): boolean {
  return decoded !== null && decoded.buttons.some((b) => b.action === 'NODE');
}

/** `.envBoolean()` 형식 파싱과 맞춰 문자열·불리언 모두 안전하게 읽는다(관리 API 응답 `serverEnabled`용). */
function readProactiveEnabled(config: ConfigService): boolean {
  const value = config.get<boolean>('PROACTIVE_ENABLED');
  return value ?? true;
}

/**
 * [신규 No.35] 목록(설정 + 규칙 + 문제 배지 + 기간 상태 + 최근 7일) · 단건 조회(읽기 전용) — 공개
 * 필터(`rule-servability.ts`)와 같은 판정 1벌을 관리 화면용으로 재사용한다(§9.4).
 */
@Injectable()
export class ProactiveOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly scope: ChatbotScopeService,
    private readonly bannedWords: BannedWordFilterService,
    private readonly targetCheck: ProactiveTargetCheckService,
  ) {}

  async getOverview(chatbotId: string): Promise<ProactiveOverviewResponse> {
    await this.scope.assertReadable(chatbotId);
    const chatbot = await this.prisma.chatbot.findUnique({ where: { id: chatbotId } });
    if (!chatbot) throw new ApiException('NOT_FOUND', 404, '요청하신 챗봇을 찾을 수 없습니다.');
    const channel = await this.prisma.channel.findUnique({ where: { chatbotId_type: { chatbotId, type: 'WEB' } } });
    const launcherHidden = channel ? isLauncherHidden(channel.config) : false;

    const setting = await this.prisma.chatbotProactiveSetting.findUnique({ where: { chatbotId } });
    const rules = await this.listRules(chatbotId);

    return {
      settings: {
        enabled: setting?.enabled ?? false,
        maxPerSession: setting?.maxPerSession ?? PROACTIVE_LIMITS.maxPerSessionDefault,
        minIntervalSec: setting?.minIntervalSec ?? PROACTIVE_LIMITS.minIntervalSecDefault,
        quietAfterUserMessageSec: setting?.quietAfterUserMessageSec ?? PROACTIVE_LIMITS.quietAfterUserMessageSecDefault,
        updatedAt: setting?.updatedAt ?? null,
      },
      serverEnabled: readProactiveEnabled(this.config),
      context: {
        chatbotStatus: chatbot.status,
        webChannelEnabled: channel?.enabled ?? false,
        launcherHidden,
        environmentMode: chatbot.prodVersionId !== null,
      },
      limits: { rulesMax: PROACTIVE_LIMITS.rulesMax, enabledRulesMax: PROACTIVE_LIMITS.enabledRulesMax },
      rules,
    };
  }

  async listRules(chatbotId: string): Promise<ProactiveRuleView[]> {
    const rows = await this.prisma.proactiveRule.findMany({
      where: { chatbotId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    if (rows.length === 0) return [];

    const ctx = await this.buildSharedContext(chatbotId, rows);
    const views: ProactiveRuleView[] = [];
    for (const row of rows) {
      views.push(await this.buildView(row, { ...ctx, last7d: ctx.statsByRule.get(row.id) ?? EMPTY_COUNTER }));
    }
    return views;
  }

  async getRule(chatbotId: string, ruleId: string): Promise<ProactiveRuleView> {
    await this.scope.assertReadable(chatbotId);
    const row = await this.findRowOrThrow(chatbotId, ruleId);
    const ctx = await this.buildSharedContext(chatbotId, [row]);
    return this.buildView(row, { ...ctx, last7d: ctx.statsByRule.get(row.id) ?? EMPTY_COUNTER });
  }

  /** `GET /chatbots/:chatbotId/proactive/stats?from=&to=` — 원천 = `ProactiveDailyStat`만
   * (대화 로그·No.14·No.29 수치·스키마 불변, §11). */
  async getStats(chatbotId: string, query: ProactiveStatsQuery): Promise<ProactiveStatsResponse> {
    await this.scope.assertReadable(chatbotId);
    const now = new Date();
    const { from, to } = resolveProactiveStatsRange(query.from, query.to, now);

    const [statRows, existingRules] = await Promise.all([
      this.prisma.proactiveDailyStat.findMany({ where: { chatbotId, dayBucket: { gte: from, lte: to } } }),
      this.prisma.proactiveRule.findMany({ where: { chatbotId }, select: { id: true } }),
    ]);

    const { totals, daily } = aggregateProactiveStats(statRows, new Set(existingRules.map((r) => r.id)), PROACTIVE_LIMITS.frequentDismiss);

    return { from, to, basis: 'BROWSER_REPORTED', frequentDismiss: PROACTIVE_LIMITS.frequentDismiss, totals, daily };
  }

  private async findRowOrThrow(chatbotId: string, ruleId: string): Promise<ProactiveRuleRow> {
    const row = await this.prisma.proactiveRule.findUnique({ where: { id: ruleId } });
    if (!row || row.chatbotId !== chatbotId) throw new ApiException('NOT_FOUND', 404, '요청하신 규칙을 찾을 수 없습니다.');
    return row;
  }

  private async buildSharedContext(
    chatbotId: string,
    rows: readonly ProactiveRuleRow[],
  ): Promise<{ nodeCheck: ServingNodeCheckResult; linkHosts: { host: string; includeSubdomains: boolean }[]; now: Date; statsByRule: Map<string, Counter> }> {
    const now = new Date();
    const decodedRows = rows.map((row) => decodeProactiveRule(row));
    const needsNodeCheck = rows.some((row, i) => hasNodeButtonRow(row, decodedRows[i]));
    const nodeCheck = needsNodeCheck ? await this.targetCheck.enabledNodeIds(chatbotId) : { nodeIds: new Set<string>(), unverifiable: false };

    const linkPolicyRow = await this.prisma.chatbotRichUrlPolicy.findUnique({ where: { chatbotId } });
    const linkHosts = linkPolicyRow ? parseProactiveLinkPolicyHosts(linkPolicyRow.hosts) : [];

    const sevenDaysAgo = new Date(now.getTime() - SEVEN_DAYS_MS);
    const statRows = await this.prisma.proactiveDailyStat.findMany({
      where: { ruleId: { in: rows.map((r) => r.id) }, dayBucket: { gte: toKstDayBucket(sevenDaysAgo) } },
    });
    const statsByRule = new Map<string, Counter>();
    for (const s of statRows) {
      const acc = statsByRule.get(s.ruleId) ?? { ...EMPTY_COUNTER };
      statsByRule.set(s.ruleId, { shown: acc.shown + s.shown, clicked: acc.clicked + s.clicked, dismissed: acc.dismissed + s.dismissed, optedOut: acc.optedOut + s.optedOut });
    }

    return { nodeCheck, linkHosts, now, statsByRule };
  }

  private async buildView(row: ProactiveRuleRow, ctx: BuildViewCtx): Promise<ProactiveRuleView> {
    const decoded = decodeProactiveRule(row);

    let bannedWordHit = false;
    let contactLike = false;
    if (decoded) {
      const texts = [row.text, ...decoded.buttons.map((b) => b.label), ...decoded.buttons.filter((b) => b.action === 'MESSAGE').map((b) => b.value)];
      for (const t of texts) {
        const { matches } = await this.bannedWords.evaluateInbound(t);
        if (matches.length > 0) bannedWordHit = true;
      }
      contactLike = texts.some((t) => looksLikeContactInfo(t));
    }

    const linkOutsidePolicy =
      decoded !== null &&
      ctx.linkHosts.length > 0 &&
      decoded.buttons.some((b) => b.action === 'LINK' && !hostMatchesRules(safeHostOf(b.value) ?? '', ctx.linkHosts));

    const issues = evaluateRuleIssues({
      decoded,
      servingNodeIds: [...ctx.nodeCheck.nodeIds],
      servingUnverifiable: ctx.nodeCheck.unverifiable,
      bannedWordHit,
      linkOutsidePolicy,
    });

    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      position: row.position,
      trigger: decoded?.trigger ?? FALLBACK_TRIGGER,
      text: row.text,
      buttons: decoded?.buttons ?? [],
      devices: decoded?.devices ?? ['DESKTOP'],
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      schedule: decoded?.schedule ?? null,
      periodState: computePeriodState(row.startsAt, row.endsAt, ctx.now),
      issues,
      warnings: contactLike ? ['CONTACT_LIKE'] : [],
      last7d: ctx.last7d,
      frequentlyDismissed: isFrequentlyDismissed(ctx.last7d.shown, ctx.last7d.dismissed, ctx.last7d.optedOut, PROACTIVE_LIMITS.frequentDismiss),
      purposeConfirmedAt: row.purposeConfirmedAt,
      updatedAt: row.updatedAt,
    };
  }
}

function isLauncherHidden(configJson: string): boolean {
  try {
    const parsed = JSON.parse(configJson) as { showLauncher?: boolean };
    return parsed.showLauncher === false;
  } catch {
    return false;
  }
}
