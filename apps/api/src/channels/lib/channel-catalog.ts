import { CHANNEL_IMPLEMENTATION, CHANNEL_TYPE_LABELS, CHANNEL_TYPE_ORDER } from '@chat-bot/shared-types';
import type { ChannelListItem, ChannelType } from '@chat-bot/shared-types';
import { defaultChannelConfig, parseChannelConfig } from './channel-config';

export interface ChannelRow {
  type: string;
  enabled: boolean;
  config: string;
  updatedAt: Date;
}

/**
 * 레코드 유무와 무관하게 8종 전부를 반환한다(FR-11-2). 미설정 타입은 `configured:false`로 표현해
 * 프런트가 목록을 하드코딩하지 않게 한다.
 */
export function buildChannelCatalog(rows: ChannelRow[]): ChannelListItem[] {
  const byType = new Map(rows.map((r) => [r.type, r]));
  return CHANNEL_TYPE_ORDER.map((type) => {
    const row = byType.get(type);
    if (!row) {
      return {
        type,
        label: CHANNEL_TYPE_LABELS[type],
        implementation: CHANNEL_IMPLEMENTATION[type],
        configured: false,
        enabled: false,
        config: defaultChannelConfig(type),
        updatedAt: null,
      };
    }
    return toChannelListItem(type, row);
  });
}

export function toChannelListItem(type: ChannelType, row: ChannelRow): ChannelListItem {
  return {
    type,
    label: CHANNEL_TYPE_LABELS[type],
    implementation: CHANNEL_IMPLEMENTATION[type],
    configured: true,
    enabled: row.enabled,
    config: parseChannelConfig(type, row.config),
    updatedAt: row.updatedAt,
  };
}
