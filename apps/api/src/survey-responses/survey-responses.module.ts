import { Module } from '@nestjs/common';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { WorkflowTriggersModule } from '../workflow/triggers/workflow-triggers.module';
import { SurveyResponseService } from './survey-response.service';

/**
 * ★ 응답 쓰기 유일 모듈(No.27). export = `SurveyResponseService` 1개.
 * import처는 `conversation.module.ts`(공개 대화) 1곳뿐이어야 한다(S-6) — 시뮬레이터·TC·버전·
 * 예약·통계 모듈은 이 모듈을 import하지 않는다.
 */
@Module({
  imports: [BannedWordsModule, WorkflowTriggersModule],
  providers: [SurveyResponseService],
  exports: [SurveyResponseService],
})
export class SurveyResponsesModule {}
