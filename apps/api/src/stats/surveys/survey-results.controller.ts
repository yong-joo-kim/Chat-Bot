import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  Paginated,
  SurveyExportQuery,
  SurveyExportQuerySchema,
  SurveyQuestionStats,
  SurveyResponseListItem,
  SurveyResponseListQuery,
  SurveyResponseListQuerySchema,
  SurveyStatsQuery,
  SurveyStatsQuerySchema,
  SurveyStatsSummary,
  SurveyTextAnswerItem,
  SurveyTextAnswerListQuery,
  SurveyTextAnswerListQuerySchema,
} from '@chat-bot/shared-types';
import { ZodQueryPipe } from '../../common/zod-query.pipe';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { AuditView } from '../../audit-logs/access/audit-view.decorator';
import { SurveyStatsService } from './survey-stats.service';
import { SurveyResultsService } from './survey-results.service';
import { buildContentDisposition } from './lib/survey-csv';

/** 설문 결과 조회(No.27, §13.1 ⑦~⑪) — 읽기 전용, `chatbot:read`(VIEWER 포함 — 마스킹본만). */
@Controller('chatbots/:chatbotId/surveys/:surveyId')
export class SurveyResultsController {
  constructor(
    private readonly statsService: SurveyStatsService,
    private readonly resultsService: SurveyResultsService,
  ) {}

  @Get('stats/summary')
  @RequirePermission('chatbot:read')
  summary(
    @Param('chatbotId') chatbotId: string,
    @Param('surveyId') surveyId: string,
    @Query(new ZodQueryPipe(SurveyStatsQuerySchema)) query: SurveyStatsQuery,
  ): Promise<SurveyStatsSummary> {
    return this.statsService.summary(chatbotId, surveyId, query);
  }

  @Get('stats/questions')
  @RequirePermission('chatbot:read')
  questions(
    @Param('chatbotId') chatbotId: string,
    @Param('surveyId') surveyId: string,
    @Query(new ZodQueryPipe(SurveyStatsQuerySchema)) query: SurveyStatsQuery,
  ): Promise<SurveyQuestionStats> {
    return this.statsService.questions(chatbotId, surveyId, query);
  }

  @Get('responses')
  @RequirePermission('chatbot:read')
  @AuditView({ targetType: 'Survey', idParam: 'surveyId', chatbotParam: 'chatbotId' })
  responses(
    @Param('chatbotId') chatbotId: string,
    @Param('surveyId') surveyId: string,
    @Query(new ZodQueryPipe(SurveyResponseListQuerySchema)) query: SurveyResponseListQuery,
  ): Promise<Paginated<SurveyResponseListItem>> {
    return this.resultsService.listResponses(chatbotId, surveyId, query);
  }

  @Get('responses/export')
  @RequirePermission('chatbot:read')
  @Header('Cache-Control', 'no-store')
  async export(
    @Param('chatbotId') chatbotId: string,
    @Param('surveyId') surveyId: string,
    @Query(new ZodQueryPipe(SurveyExportQuerySchema)) query: SurveyExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    const { content, filename, filenameAscii, mimeType, truncated, total } = await this.resultsService.export(chatbotId, surveyId, query);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', buildContentDisposition(filename, filenameAscii));
    if (truncated) {
      res.setHeader('X-Export-Truncated', 'true');
      res.setHeader('X-Export-Total', String(total));
    }
    res.send(content);
  }

  @Get('text-answers')
  @RequirePermission('chatbot:read')
  @AuditView({ targetType: 'Survey', idParam: 'surveyId', chatbotParam: 'chatbotId' })
  textAnswers(
    @Param('chatbotId') chatbotId: string,
    @Param('surveyId') surveyId: string,
    @Query(new ZodQueryPipe(SurveyTextAnswerListQuerySchema)) query: SurveyTextAnswerListQuery,
  ): Promise<Paginated<SurveyTextAnswerItem>> {
    return this.resultsService.listTextAnswers(chatbotId, surveyId, query);
  }
}
