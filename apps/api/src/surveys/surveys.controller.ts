import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import {
  CopySurveySchema,
  CreateSurveySchema,
  SurveyDetail,
  SurveyListItem,
  SurveyListQuery,
  SurveyListQuerySchema,
  UpdateSurveySchema,
  type CopySurveyDto,
  type CreateSurveyDto,
  type UpdateSurveyDto,
} from '@chat-bot/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ZodQueryPipe } from '../common/zod-query.pipe';
import { RequirePermission } from '../common/auth/require-permission.decorator';
import { SurveysService } from './surveys.service';

/** 설문 정의 CRUD(No.27, §13.1 ①~⑥). 응답 쓰기 경로는 없다 — `survey-responses/`가 유일한 쓰기 주체. */
@Controller('chatbots/:chatbotId/surveys')
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  @Get()
  @RequirePermission('dialogue:read')
  list(
    @Param('chatbotId') chatbotId: string,
    @Query(new ZodQueryPipe(SurveyListQuerySchema)) query: SurveyListQuery,
  ): Promise<{ items: SurveyListItem[] }> {
    return this.surveysService.list(chatbotId, query);
  }

  @Post()
  @RequirePermission('dialogue:write')
  create(@Param('chatbotId') chatbotId: string, @Body(new ZodValidationPipe(CreateSurveySchema)) dto: CreateSurveyDto): Promise<SurveyDetail> {
    return this.surveysService.create(chatbotId, dto);
  }

  @Get(':surveyId')
  @RequirePermission('dialogue:read')
  findOne(@Param('chatbotId') chatbotId: string, @Param('surveyId') surveyId: string): Promise<SurveyDetail> {
    return this.surveysService.findOne(chatbotId, surveyId);
  }

  @Patch(':surveyId')
  @RequirePermission('dialogue:write')
  update(
    @Param('chatbotId') chatbotId: string,
    @Param('surveyId') surveyId: string,
    @Body(new ZodValidationPipe(UpdateSurveySchema)) dto: UpdateSurveyDto,
  ): Promise<SurveyDetail> {
    return this.surveysService.update(chatbotId, surveyId, dto);
  }

  @Post(':surveyId/copy')
  @RequirePermission('dialogue:write')
  copy(
    @Param('chatbotId') chatbotId: string,
    @Param('surveyId') surveyId: string,
    @Body(new ZodValidationPipe(CopySurveySchema)) dto: CopySurveyDto,
  ): Promise<SurveyDetail> {
    return this.surveysService.copy(chatbotId, surveyId, dto);
  }

  @Delete(':surveyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('dialogue:write')
  async remove(@Param('chatbotId') chatbotId: string, @Param('surveyId') surveyId: string): Promise<void> {
    await this.surveysService.remove(chatbotId, surveyId);
  }
}
