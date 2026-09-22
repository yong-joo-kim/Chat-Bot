import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BannedWordsController } from './banned-words.controller';
import { BannedWordsService } from './banned-words.service';
import { BannedWordFilterService } from './banned-word-filter.service';
import { InMemoryBannedWordCache } from './banned-word.cache';

/**
 * 금지어 사전·필터(DD-44). `BannedWordFilterService`만 export한다 — `ConversationModule`이
 * 명시적으로 import해 주입받는다(암묵 전역화 금지, `DialogueBundleService` 선례와 동일 판단).
 */
@Module({
  imports: [ConfigModule],
  controllers: [BannedWordsController],
  providers: [
    BannedWordsService,
    BannedWordFilterService,
    {
      provide: 'BannedWordCache',
      useFactory: (config: ConfigService) => new InMemoryBannedWordCache(config.get<number>('BANNED_WORD_CACHE_TTL_MS') ?? 60_000),
      inject: [ConfigService],
    },
  ],
  exports: [BannedWordFilterService],
})
export class BannedWordsModule {}
