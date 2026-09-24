import { Injectable } from '@nestjs/common';
import type { SurveyQuestionStats, SurveyStatsQuery, SurveyStatsSummary } from '@chat-bot/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiException } from '../../common/api.exception';
import { ChatbotScopeService } from '../../chatbots/chatbot-scope.service';
import { runWithAggregationTimeout } from '../stats-request.helpers';
import { buildBuckets } from '../lib/bucket';
import { assertSurveyPeriod } from './lib/survey-period';
import { assembleSurveySummary, toStatsGranularity } from './lib/survey-summary-assembler';
import { assembleSurveyQuestionStats } from './lib/survey-question-assembler';
import { parseSurveyRow } from './lib/survey-row';

const NOT_FOUND_MESSAGE = '요청하신 설문을 찾을 수 없습니다.';

@Injectable()
export class SurveyStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ChatbotScopeService,
  ) {}

  private async findSurveyOrThrow(chatbotId: string, surveyId: string) {
    await this.scope.assertReadable(chatbotId);
    const row = await this.prisma.survey.findFirst({ where: { id: surveyId, chatbotId } });
    if (!row) throw new ApiException('NOT_FOUND', 404, NOT_FOUND_MESSAGE);
    return row;
  }

  async summary(chatbotId: string, surveyId: string, query: SurveyStatsQuery): Promise<SurveyStatsSummary> {
    const surveyRow = await this.findSurveyOrThrow(chatbotId, surveyId);
    assertSurveyPeriod(query.from, query.to);
    const survey = parseSurveyRow(surveyRow);
    const now = new Date();
    const cutoff = new Date(now.getTime() - survey.sessionTimeoutMinutes * 60_000);

    const baseWhere = {
      surveyId,
      dayBucket: { gte: query.from, lte: query.to },
      ...(query.channel ? { channelType: query.channel } : {}),
    };

    const [statusRows, activeRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.surveyResponse.groupBy({
          by: ['dayBucket', 'status', 'started', 'isDuplicate'],
          where: baseWhere,
          _count: { _all: true },
        }),
        this.prisma.surveyResponse.groupBy({
          by: ['dayBucket', 'started', 'isDuplicate'],
          where: { ...baseWhere, status: { in: ['EXPOSED', 'IN_PROGRESS'] }, lastInteractedAt: { gte: cutoff } },
          _count: { _all: true },
        }),
      ]),
    );

    const buckets = buildBuckets(query.from, query.to, toStatsGranularity(query.granularity));

    return assembleSurveySummary({
      buckets,
      granularity: query.granularity,
      statusRows: statusRows.map((r) => ({ dayBucket: r.dayBucket, status: r.status, started: r.started, isDuplicate: r.isDuplicate, count: r._count._all })),
      activeRows: activeRows.map((r) => ({ dayBucket: r.dayBucket, started: r.started, isDuplicate: r.isDuplicate, count: r._count._all })),
      includeDuplicates: query.includeDuplicates,
      surveyId,
      from: query.from,
      to: query.to,
      generatedAt: now,
      filters: { channel: query.channel },
    });
  }

  async questions(chatbotId: string, surveyId: string, query: SurveyStatsQuery): Promise<SurveyQuestionStats> {
    const surveyRow = await this.findSurveyOrThrow(chatbotId, surveyId);
    assertSurveyPeriod(query.from, query.to);
    const survey = parseSurveyRow(surveyRow);
    const now = new Date();

    const responseWhere = {
      surveyId,
      dayBucket: { gte: query.from, lte: query.to },
      ...(query.channel ? { channelType: query.channel } : {}),
      ...(query.includeDuplicates ? {} : { isDuplicate: false }),
    };
    const answerWhere = {
      surveyId,
      dayBucket: { gte: query.from, lte: query.to },
      ...(query.channel ? { channelType: query.channel } : {}),
      ...(query.includeDuplicates ? {} : { isDuplicate: false }),
    };

    const [exposedCount, reachedRows, answerKindRows, choiceDistRows, scaleDistRows] = await runWithAggregationTimeout(
      Promise.all([
        this.prisma.surveyResponse.count({ where: responseWhere }),
        this.prisma.surveyResponse.groupBy({ by: ['lastQuestionIndex'], where: responseWhere, _count: { _all: true } }),
        this.prisma.surveyAnswer.groupBy({ by: ['questionKey', 'kind'], where: { ...answerWhere, isHead: true }, _count: { _all: true } }),
        this.prisma.surveyAnswer.groupBy({
          by: ['questionKey', 'choiceKey'],
          where: { ...answerWhere, kind: 'ANSWERED', choiceKey: { not: '' } },
          _count: { _all: true },
        }),
        this.prisma.surveyAnswer.groupBy({
          by: ['questionKey', 'numericValue'],
          where: { ...answerWhere, kind: 'ANSWERED', isHead: true, numericValue: { not: null } },
          _count: { _all: true },
        }),
      ]),
    );

    return assembleSurveyQuestionStats({
      survey,
      exposed: exposedCount,
      reachedRows: reachedRows.map((r) => ({ lastQuestionIndex: r.lastQuestionIndex, count: r._count._all })),
      answerKindRows: answerKindRows.map((r) => ({ questionKey: r.questionKey, kind: r.kind, count: r._count._all })),
      choiceDistRows: choiceDistRows.map((r) => ({ questionKey: r.questionKey, choiceKey: r.choiceKey, count: r._count._all })),
      scaleDistRows: scaleDistRows.map((r) => ({ questionKey: r.questionKey, numericValue: r.numericValue as number, count: r._count._all })),
      from: query.from,
      to: query.to,
      generatedAt: now,
    });
  }
}
