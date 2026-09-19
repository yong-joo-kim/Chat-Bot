import type { Paginated } from '@chat-bot/shared-types';

/** 목록 API 공통 응답 봉투 생성 헬퍼(FR-0-5). */
export function toPaginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize };
}
