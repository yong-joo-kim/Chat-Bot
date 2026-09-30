import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatbotsModule } from '../chatbots/chatbots.module';
import { BannedWordsModule } from '../banned-words/banned-words.module';
import { AnswerSettingsModule } from '../answer-settings/answer-settings.module';
import { GuardrailRuntimeModule } from './runtime/guardrail-runtime.module';
import { GuardrailsController } from './guardrails.controller';
import { GuardrailRulesService } from './guardrail-rules.service';
import { GuardrailSettingsService } from './guardrail-settings.service';
import { GuardrailTestService } from './guardrail-test.service';
import { GuardrailOverviewService } from './guardrail-overview.service';
import { GuardrailRuleStore } from './core/guardrail-rule.store';
import { GuardrailSettingStore } from './core/guardrail-setting.store';

/**
 * [신규 No.36] 안전 가드레일 관리(컨트롤러 1 · 13 핸들러) — 런타임(`GuardrailRuntimeModule`)은 별도 모듈이다
 * (`ConversationModule`·`RagModule`·`SimulationModule`이 런타임만 import한다). 감사 모듈은 전역이다.
 * exports 없음(설계서 §2.3).
 */
@Module({
  imports: [ConfigModule, GuardrailRuntimeModule, ChatbotsModule, BannedWordsModule, AnswerSettingsModule],
  controllers: [GuardrailsController],
  providers: [GuardrailRulesService, GuardrailSettingsService, GuardrailTestService, GuardrailOverviewService, GuardrailRuleStore, GuardrailSettingStore],
})
export class GuardrailsModule {}
