import { TOPIC_FILTER_COMMON } from '@chat-bot/shared-types';

/**
 * 목록 쿼리 `topicIds`(uuid | 'common' 콤마 목록) → Prisma `where` 절 조각(topic-system-설계.md §5.3).
 * 쿼리 수 불변 — 기존 `findMany`/`count`의 `where`에 조건을 더할 뿐이다. 없는 토픽 id는 매칭 0으로
 * 자연히 처리된다(EX-TP-24). 반환값은 자산 6종 Where 타입과 구조적으로 호환된다(topicId: string | null 컬럼).
 */
export function buildTopicIdsWhere(topicIds: readonly string[] | undefined): Record<string, unknown> | undefined {
  if (!topicIds || topicIds.length === 0) return undefined;
  const uuids = topicIds.filter((t) => t !== TOPIC_FILTER_COMMON);
  const hasCommon = topicIds.includes(TOPIC_FILTER_COMMON);

  if (hasCommon && uuids.length > 0) return { OR: [{ topicId: { in: uuids } }, { topicId: null }] };
  if (hasCommon) return { topicId: null };
  return { topicId: { in: uuids } };
}
