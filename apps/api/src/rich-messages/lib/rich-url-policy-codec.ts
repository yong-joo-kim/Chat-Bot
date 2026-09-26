import type { RichUrlHostRule } from '@chat-bot/shared-types';

/** 저장 컬럼(`hosts` JSON 문자열) ↔ 계약 타입 변환(순수 — DB·Nest 무의존). */
export function parseRichUrlHosts(json: string): RichUrlHostRule[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is RichUrlHostRule => typeof h === 'object' && h !== null && typeof h.host === 'string' && typeof h.includeSubdomains === 'boolean');
  } catch {
    return [];
  }
}

export function serializeRichUrlHosts(hosts: readonly RichUrlHostRule[]): string {
  return JSON.stringify(hosts);
}
