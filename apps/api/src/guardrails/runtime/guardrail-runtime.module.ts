import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BannedWordsModule } from '../../banned-words/banned-words.module';
import { GuardrailEventWriter } from './guardrail-event.writer';
import { GuardrailProfileLoader } from './guardrail-profile.loader';
import { GuardrailRuntimeService } from './guardrail-runtime.service';

/**
 * 가드레일 런타임(판정·캐시·이벤트 적재) — `ConversationModule`·`RagModule`·`SimulationModule`·
 * `GuardrailsModule`이 import한다. export는 `GuardrailRuntimeService` 1개(설계서 §2.3). 다른 모듈을
 * import하지 않아(Prisma는 전역) 순환 참조가 생기지 않는다.
 */
@Module({
  imports: [ConfigModule, BannedWordsModule],
  providers: [GuardrailProfileLoader, GuardrailEventWriter, GuardrailRuntimeService],
  exports: [GuardrailRuntimeService],
})
export class GuardrailRuntimeModule {}
