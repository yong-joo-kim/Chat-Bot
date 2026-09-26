import { Module } from '@nestjs/common';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { EmbeddingModule } from '../embedding/embedding.module';
import { DialogueCommonModule } from '../dialogue-common/dialogue-common.module';
import { CannedResponsesModule } from '../canned-responses/canned-responses.module';
import { EnvironmentServingModule } from '../environment/serving/environment-serving.module';
import { WorkflowTriggersModule } from '../workflow/triggers/workflow-triggers.module';
import { CLOCK, SystemClock } from '../common/polling/clock';
import { LiveSessionsController } from './live-sessions.controller';
import { HandoffsController } from './handoffs.controller';
import { HandoffSettingsController } from './handoff-settings.controller';
import { HandoffConsoleController } from './handoff-console.controller';
import { HandoffThreadService } from './handoff-thread.service';
import { HandoffSettingsCacheService } from './handoff-settings-cache.service';
import { HandoffSettingsService } from './handoff-settings.service';
import { HandoffGateService } from './handoff-gate.service';
import { HandoffPublicPollService } from './handoff-public-poll.service';
import { HandoffSweeperService } from './handoff-sweeper.service';
import { LiveSessionsService } from './live-sessions.service';
import { HandoffTranscriptService } from './handoff-transcript.service';
import { HandoffHintsService } from './handoff-hints.service';
import { HandoffHistoryService } from './handoff-history.service';
import { HandoffActionsService } from './handoff-actions.service';
import { HandoffConsoleService } from './handoff-console.service';
import { SessionRefResolverService } from './session-ref-resolver.service';

/**
 * 하이브리드 CS(No.24, ADR-0036) — 개입 세션 상담 스레드 · 공개 게이트/폴링 · 진행 중 목록 ·
 * 대화 보기(원문 출구 1곳) · 응답힌트 · 이력/요약 · 60초 정리 루프 · 챗봇별 자주 쓰는 문장.
 *
 * **export는 2개뿐**(`HandoffGateService`·`HandoffPublicPollService`) — import처는
 * `ConversationModule` 1곳이다(§2.2). 이 모듈은 `conversation`을 import하지 않는다(순환 금지).
 * `simulation`·`validation`·`versions`·`deploy-schedules`·`stats`·`learning`은 이 모듈을
 * import하지 않는다(DI 격리, FR-0-123, §18 H-12).
 */
@Module({
  imports: [ChatbotsModule, BannedWordsModule, AnswerSettingsModule, EmbeddingModule, DialogueCommonModule, CannedResponsesModule, EnvironmentServingModule, WorkflowTriggersModule],
  controllers: [LiveSessionsController, HandoffsController, HandoffSettingsController, HandoffConsoleController],
  providers: [
    HandoffThreadService,
    HandoffSettingsCacheService,
    HandoffSettingsService,
    HandoffGateService,
    HandoffPublicPollService,
    HandoffSweeperService,
    LiveSessionsService,
    HandoffTranscriptService,
    HandoffHintsService,
    HandoffHistoryService,
    HandoffActionsService,
    HandoffConsoleService,
    SessionRefResolverService,
    { provide: CLOCK, useClass: SystemClock },
  ],
  exports: [HandoffGateService, HandoffPublicPollService],
})
export class HandoffModule {}
