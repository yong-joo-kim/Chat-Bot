import type { InboxThreadListQuery } from '@chat-bot/shared-types';
import { buildThreadListWhere } from './list-where';

function baseQuery(overrides: Partial<InboxThreadListQuery> = {}): InboxThreadListQuery {
  return {
    page: 1,
    pageSize: 20,
    includeTest: false,
    activeHandoff: false,
    ...overrides,
  } as InboxThreadListQuery;
}

describe('buildThreadListWhere(순수 함수, §9.1 · 코드리뷰 R1 M-3 — channelFamily 필터)', () => {
  const now = new Date('2026-09-26T00:00:00Z');

  it('channelFamily가 없으면 lastChannelFamily 조건을 넣지 않는다', () => {
    const where = buildThreadListWhere(baseQuery(), now);
    expect(where.lastChannelFamily).toBeUndefined();
  });

  it('channelFamily가 있으면 lastChannelFamily 필드에 in 조건을 만든다(설계서 §3.1 필드 기준)', () => {
    const where = buildThreadListWhere(baseQuery({ channelFamily: ['RECORD'] }), now);
    expect(where.lastChannelFamily).toEqual({ in: ['RECORD'] });
  });

  it('channelFamily 다중 값도 그대로 in 배열에 담긴다', () => {
    const where = buildThreadListWhere(baseQuery({ channelFamily: ['DEPLOY', 'SIMULATED'] }), now);
    expect(where.lastChannelFamily).toEqual({ in: ['DEPLOY', 'SIMULATED'] });
  });

  it('channelFamily 빈 배열은 필터를 넣지 않는다(전체 조회 취급)', () => {
    const where = buildThreadListWhere(baseQuery({ channelFamily: [] }), now);
    expect(where.lastChannelFamily).toBeUndefined();
  });
});
