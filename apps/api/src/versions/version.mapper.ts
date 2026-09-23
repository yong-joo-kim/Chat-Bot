import type { ChatbotVersion as PrismaChatbotVersion } from '@prisma/client';
import type {
  ChatbotVersionDetail,
  ChatbotVersionListItem,
  ChatbotVersionTrigger,
  VersionCounts,
  VersionIntegrityWarning,
  VersionTriggerContext,
} from '@chat-bot/shared-types';
import { CHATBOT_VERSION_TRIGGER_LABELS } from '@chat-bot/shared-types';
import { isSchemaSupported } from './lib/snapshot-upcasters';

/** `ChatbotVersion` 메타 행 → 목록/상세 DTO. **payload를 읽지 않는다**(FR-H1-17, §16 V-7). */
export function toVersionListItemDto(row: PrismaChatbotVersion): ChatbotVersionListItem {
  return {
    id: row.id,
    versionNo: row.versionNo,
    trigger: row.trigger as ChatbotVersionTrigger,
    triggerLabel: CHATBOT_VERSION_TRIGGER_LABELS[row.trigger as ChatbotVersionTrigger] ?? row.trigger,
    triggerContext: row.triggerContext ? (JSON.parse(row.triggerContext) as VersionTriggerContext) : null,
    schemaVersion: row.schemaVersion,
    schemaSupported: isSchemaSupported(row.schemaVersion),
    contentHash: row.contentHash,
    counts: JSON.parse(row.counts) as VersionCounts,
    sizeBytes: row.sizeBytes,
    integrityWarningCount: row.integrityWarningCount,
    label: row.label,
    memo: row.memo,
    pinned: row.pinned,
    restoredFromVersionNo: row.restoredFromVersionNo,
    createdById: row.createdById,
    createdByEmail: row.createdByEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toVersionDetailDto(row: PrismaChatbotVersion, payloadStatus: 'OK' | 'CORRUPT' | 'SCHEMA_UNSUPPORTED'): ChatbotVersionDetail {
  return {
    ...toVersionListItemDto(row),
    integrityWarnings: JSON.parse(row.integrityWarnings) as VersionIntegrityWarning[],
    payloadStatus,
  };
}
