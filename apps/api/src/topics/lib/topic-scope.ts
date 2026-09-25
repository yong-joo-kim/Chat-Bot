import { TOPIC_FILTER_COMMON } from '@chat-bot/shared-types';

/**
 * "공통/활성/비활성" 판정 1벌(topic-system-설계.md §7.2) — 토픽 점검·영향 미리보기·분리가 공유한다.
 * DB·Nest 무의존 순수 함수.
 */

export interface TopicEnabledInfo {
  enabled: boolean;
  name: string;
}

/** 토픽 키 — `topicId ?? 'common'`. */
export function topicKey(topicId: string | null | undefined): string {
  return topicId ?? TOPIC_FILTER_COMMON;
}

/** live 범위 = 공통 + 활성 토픽. */
export function isLive(topicId: string | null | undefined, topicMap: ReadonlyMap<string, TopicEnabledInfo>): boolean {
  if (!topicId) return true;
  return topicMap.get(topicId)?.enabled ?? false;
}

export function topicName(topicId: string | null | undefined, topicMap: ReadonlyMap<string, TopicEnabledInfo>, deletedLabel = '삭제된 토픽'): string {
  if (!topicId) return '공통';
  return topicMap.get(topicId)?.name ?? deletedLabel;
}
