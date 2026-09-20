import { channelConfigSchemaFor } from '@chat-bot/shared-types';
import type { ChannelConfig, ChannelType } from '@chat-bot/shared-types';

/**
 * DB에 저장된 JSON 문자열을 타입별 판별 유니온으로 파싱한다(FR-11-8).
 * 파싱 실패/스키마 불일치는 기본값 폴백으로 처리한다(NFR-M4 — 엔진 쪽 "예외 없음" 원칙과 대칭).
 */
export function parseChannelConfig(type: ChannelType, json: string): ChannelConfig {
  const schema = channelConfigSchemaFor(type);
  try {
    const parsed = JSON.parse(json);
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // 폴백으로 진행
  }
  return schema.parse({});
}

export function defaultChannelConfig(type: ChannelType): ChannelConfig {
  return channelConfigSchemaFor(type).parse({});
}
