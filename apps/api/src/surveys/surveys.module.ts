import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { SurveysController } from './surveys.controller';
import { SurveysService } from './surveys.service';

/** 설문 정의 CRUD(No.27) — 챗봇 스코프(§2.1). 응답 쓰기 경로는 여기에 없다(`SurveyResponsesModule` 전용). */
@Module({
  imports: [ChatbotsModule, DialogueCommonModule],
  controllers: [SurveysController],
  providers: [SurveysService],
  exports: [SurveysService],
})
export class SurveysModule {}
