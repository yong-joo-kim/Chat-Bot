import { Injectable, Logger } from '@nestjs/common';
import { API_CALL_LOG_LIMITS, toKstDayBucket } from '@chat-bot/shared-types';
import type { ApiCallBranch, ApiCallLogItem, ApiCallLogListQuery, ApiCallLogSummary, ApiCallOutcome, ApiCallSource, ApiHttpMethod, Paginated } from '@chat-bot/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { toPaginated } from '../common/pagination';
import { ChatbotScopeService } from '../chatbots/chatbot-scope.service';
import { ApiException } from '../common/api.exception';

export interface RecordApiCallLogParams {
  chatbotId: string | null;
  connectionId: string;
  connectionName: string;
  nodeId?: string | null;
  conversationLogId?: string | null;
  source: ApiCallSource;
  method: ApiHttpMethod;
  pathTemplate: string;
  outcome: ApiCallOutcome;
  httpStatus?: number | null;
  latencyMs: number;
  responseBytes?: number | null;
  branch?: ApiCallBranch | null;
  conditionIndex?: number | null;
  personalDataMasked: boolean;
}

/**
 * ★ `ApiCallLog` 쓰기 유일 지점(§9.1, fire-and-forget). **원문 0** — 해석된 URL·쿼리·헤더·요청/응답
 * 본문·바인딩 값·응답 값 컬럼이 없다(AC-L5-2 · §13 L-7). 목·TC·비교는 기록하지 않는다(AC-L5-3).
 */
@Injectable()
export class ApiCallLogService {
  private readonly logger = new Logger('ApiCallLogService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
  ) {}

  record(params: RecordApiCallLogParams): void {
    void this.prisma.apiCallLog
      .create({
        data: {
          chatbotId: params.chatbotId,
          connectionId: params.connectionId,
          connectionName: params.connectionName,
          nodeId: params.nodeId ?? null,
          conversationLogId: params.conversationLogId ?? null,
          source: params.source,
          method: params.method,
          pathTemplate: params.pathTemplate,
          outcome: params.outcome,
          httpStatus: params.httpStatus ?? null,
          latencyMs: params.latencyMs,
          responseBytes: params.responseBytes ?? null,
          branch: params.branch ?? null,
          conditionIndex: params.conditionIndex ?? null,
          personalDataMasked: params.personalDataMasked,
          dayBucket: toKstDayBucket(new Date()),
        },
      })
      .catch((e: unknown) => {
        this.logger.warn(`ApiCallLog 적재 실패: connectionId=${params.connectionId} errorName=${e instanceof Error ? e.name : 'unknown'}`);
      });
  }

  async list(chatbotId: string, query: ApiCallLogListQuery): Promise<Paginated<ApiCallLogItem>> {
    await this.scope.assertReadable(chatbotId);
    const where = this.buildWhere(chatbotId, query);
    const [rows, total] = await Promise.all([
      this.prisma.apiCallLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.apiCallLog.count({ where }),
    ]);
    const items: ApiCallLogItem[] = rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      connectionId: r.connectionId,
      connectionName: r.connectionName,
      nodeId: r.nodeId ?? undefined,
      conversationLogId: r.conversationLogId ?? undefined,
      source: r.source as ApiCallSource,
      method: r.method as ApiHttpMethod,
      pathTemplate: r.pathTemplate,
      outcome: r.outcome as ApiCallOutcome,
      httpStatus: r.httpStatus ?? undefined,
      latencyMs: r.latencyMs,
      responseBytes: r.responseBytes ?? undefined,
      branch: (r.branch as ApiCallBranch | null) ?? undefined,
      conditionIndex: r.conditionIndex ?? undefined,
      personalDataMasked: r.personalDataMasked,
    }));
    return toPaginated(items, total, query.page, query.pageSize);
  }

  async summary(chatbotId: string, query: ApiCallLogListQuery): Promise<ApiCallLogSummary> {
    await this.scope.assertReadable(chatbotId);
    const where = this.buildWhere(chatbotId, query);
    const rows = await this.prisma.apiCallLog.findMany({ where, select: { outcome: true, latencyMs: true } });
    const total = rows.length;
    const success = rows.filter((r) => r.outcome === 'SUCCESS').length;
    const byOutcome: Record<string, number> = {};
    for (const r of rows) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
    const sortedLatency = rows.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p95Index = sortedLatency.length > 0 ? Math.min(sortedLatency.length - 1, Math.floor(sortedLatency.length * 0.95)) : 0;
    const p95LatencyMs = sortedLatency.length > 0 ? sortedLatency[p95Index] : 0;

    const byConnRows = await this.prisma.apiCallLog.groupBy({
      by: ['connectionId', 'connectionName'],
      where,
      _count: { _all: true },
    });
    const byConnection = await Promise.all(
      byConnRows.map(async (g) => {
        const failures = await this.prisma.apiCallLog.count({ where: { ...where, connectionId: g.connectionId, outcome: { not: 'SUCCESS' } } });
        return { connectionId: g.connectionId, connectionName: g.connectionName, total: g._count._all, failures };
      }),
    );

    return {
      total,
      success,
      successRate: total > 0 ? success / total : 0,
      byOutcome: byOutcome as ApiCallLogSummary['byOutcome'],
      p95LatencyMs,
      byConnection,
    };
  }

  private buildWhere(chatbotId: string, query: ApiCallLogListQuery) {
    if (query.from && query.to) {
      const days = (new Date(query.to).getTime() - new Date(query.from).getTime()) / (24 * 60 * 60 * 1000);
      if (days > API_CALL_LOG_LIMITS.maxRangeDays) {
        throw new ApiException('VALIDATION_FAILED', 400, `조회 기간은 최대 ${API_CALL_LOG_LIMITS.maxRangeDays}일까지 지정할 수 있습니다.`);
      }
    }
    const where: Record<string, unknown> = { chatbotId };
    if (query.from || query.to) {
      where.dayBucket = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    }
    if (query.connectionId) where.connectionId = query.connectionId;
    if (query.outcome && query.outcome.length > 0) where.outcome = { in: query.outcome };
    where.source = query.source && query.source.length > 0 ? { in: query.source } : { in: ['PUBLIC', 'SIMULATION_LIVE'] };
    return where;
  }

  /** 연결 상세 응답의 `stats24h`(§4.4) — 최근 24시간 호출/실패 수. */
  async stats24h(connectionId: string): Promise<{ calls: number; failures: number }> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [calls, failures] = await Promise.all([
      this.prisma.apiCallLog.count({ where: { connectionId, createdAt: { gte: since } } }),
      this.prisma.apiCallLog.count({ where: { connectionId, createdAt: { gte: since }, outcome: { not: 'SUCCESS' } } }),
    ]);
    return { calls, failures };
  }
}
