import type { BannedWord as PrismaBannedWord } from '@prisma/client';
import type { BannedWord, BannedWordMatchType, BannedWordPolicy } from '@chat-bot/shared-types';

export function toBannedWordDto(row: PrismaBannedWord): BannedWord {
  return {
    id: row.id,
    word: row.word,
    wordNormalized: row.wordNormalized,
    matchType: row.matchType as BannedWordMatchType,
    policy: row.policy as BannedWordPolicy,
    enabled: row.enabled,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
