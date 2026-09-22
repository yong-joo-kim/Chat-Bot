import { AUDIT_LIMITS } from '@chat-bot/shared-types';
import type { AuditTargetType } from '@chat-bot/shared-types';

/**
 * 감사 스냅샷 화이트리스트(FR-13-11, NFR-S8, ADR-0016 §9.6). 대량 필드는 원문이 아니라
 * 건수로 대체한다(`examples`→`exampleCount` 등) — 서비스가 스냅샷 입력을 만들 때 이미 건수로 변환해
 * 넘겨야 한다. `User`에는 `passwordHash`가 물리적으로 들어갈 수 없다(화이트리스트에 없다).
 */
const AUDIT_FIELDS: Record<AuditTargetType, readonly string[]> = {
  ChatbotGroup: ['name', 'description'],
  Chatbot: ['name', 'slug', 'status', 'groupId', 'description', 'avatarUrl'],
  Intent: ['name', 'description', 'exampleCount'],
  Keyword: ['name', 'synonymCount'],
  HomonymDictionary: ['word', 'policy', 'meaningCount'],
  ContextVariable: ['name', 'slotCount', 'cancelKeywords', 'sessionTimeoutMinutes'],
  DialogNode: ['name', 'nodeType', 'priority', 'enabled', 'outputCount', 'intentIds', 'keywordIds', 'contextVariableId'],
  FaqEntry: ['question', 'category', 'enabled', 'altQuestionCount'],
  Channel: ['type', 'enabled'],
  User: ['email', 'name', 'role', 'status'],
  BannedWord: ['word', 'matchType', 'policy', 'enabled'],
  Session: [],
};

/** 엔터티(도메인 객체)에서 화이트리스트 필드만 뽑아 스냅샷을 만든다. */
export function buildSnapshot(targetType: AuditTargetType, entity: unknown): Record<string, unknown> | null {
  if (entity === null || entity === undefined) return null;
  const fields = AUDIT_FIELDS[targetType] ?? [];
  const source = entity as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) snapshot[field] = source[field];
  }
  return snapshot;
}

export interface SerializedSnapshot {
  json: string | null;
  truncated: boolean;
}

/** 직렬화 결과가 상한(8KB)을 넘으면 필드를 뒤에서부터 잘라내고 `__truncated:true`를 남긴다(EX-13-11). */
export function serializeSnapshot(snapshot: Record<string, unknown> | null): SerializedSnapshot {
  if (snapshot === null) return { json: null, truncated: false };
  const keys = Object.keys(snapshot);

  for (let cut = keys.length; cut >= 0; cut -= 1) {
    const partial: Record<string, unknown> = {};
    for (let i = 0; i < cut; i += 1) partial[keys[i]] = snapshot[keys[i]];
    const truncated = cut < keys.length;
    const payload = truncated ? { ...partial, __truncated: true } : partial;
    const json = JSON.stringify(payload);
    if (cut === 0 || Buffer.byteLength(json, 'utf8') <= AUDIT_LIMITS.snapshotBytes) {
      return { json, truncated };
    }
  }
  return { json: '{}', truncated: true };
}
