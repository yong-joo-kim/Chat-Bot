import type { AugmentationSuggestion as PrismaAugmentationSuggestion } from '@prisma/client';
import type { AugmentationProviderId, AugmentationSuggestion, AugmentationSuggestionStatus } from '@chat-bot/shared-types';

export interface AugmentationSuggestionMapOpts {
  readonly stale: boolean;
  readonly conflictIntentName?: string;
}

/** Prisma row → API DTO(FR-L1-18). `conflictIntentId`는 FK가 없으므로 이름은 호출부가 조회해 전달한다. */
export function toAugmentationSuggestionDto(
  row: PrismaAugmentationSuggestion,
  opts: AugmentationSuggestionMapOpts,
): AugmentationSuggestion {
  return {
    id: row.id,
    text: row.text,
    similarityToSeed: row.similarityToSeed,
    conflictIntent:
      row.conflictIntentId && opts.conflictIntentName
        ? { intentId: row.conflictIntentId, intentName: opts.conflictIntentName, score: row.conflictScore ?? 0 }
        : undefined,
    status: row.status as AugmentationSuggestionStatus,
    providerId: row.providerId as AugmentationProviderId,
    createdAt: row.createdAt,
    stale: opts.stale,
  };
}
