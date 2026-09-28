import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { EnvironmentServingModule } from '../environment/serving/environment-serving.module';
import { ProactiveController } from './proactive.controller';
import { ProactiveSettingsService } from './proactive-settings.service';
import { ProactiveRulesService } from './proactive-rules.service';
import { ProactiveOverviewService } from './proactive-overview.service';
import { ProactiveTargetCheckService } from './proactive-target-check.service';
import { ProactivePublicService } from './public/proactive-public.service';
import { ProactiveStatWriter } from './core/proactive-stat.writer';
import { ProactiveEventDeduper } from './core/proactive-event-deduper';

/**
 * [신규 No.35] 선제 안내(Proactive Messaging) — 설정·규칙·통계 관리(컨트롤러 1 · 10 핸들러) + 공개
 * 페이로드 조립·수집(export 유일 `ProactivePublicService`, ADR-0045 §2). `proactive`는
 * `conversation`을 import하지 않는다(슬러그 판정 결과 행을 넘겨받는다 — 순환 없음).
 */
@Module({
  imports: [ChatbotsModule, BannedWordsModule, DialogueCommonModule, EnvironmentServingModule],
  controllers: [ProactiveController],
  providers: [
    ProactiveSettingsService,
    ProactiveRulesService,
    ProactiveOverviewService,
    ProactiveTargetCheckService,
    ProactivePublicService,
    ProactiveStatWriter,
    ProactiveEventDeduper,
  ],
  exports: [ProactivePublicService],
})
export class ProactiveModule {}
