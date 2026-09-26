import type { IdentitySpaceItem, InboxSummaryResponse, InboxThreadDetail, InboxThreadListItem, InboxThreadListResponse, TimelineEntryUnit } from '@chat-bot/shared-types';

/** 옴니채널 통합 인박스(No.42) 시험 픽스처. */
export function makeThreadListItem(overrides: Partial<InboxThreadListItem> = {}): InboxThreadListItem {
  return {
    threadId: 'thread-1',
    version: 1,
    customer: { id: 'cust-1', alias: 'a1b2c3', displayName: '홍길동', kind: 'IDENTIFIED' },
    status: 'OPEN',
    assignee: undefined,
    tags: [],
    lastChannel: { family: 'DEPLOY', type: 'WEB', label: '웹' },
    lastChatbot: { id: 'bot-1', name: '쇼핑봇' },
    linkedConversationCount: 3,
    activeHandoffCount: 0,
    lastActivityAt: new Date('2026-09-26T10:00:00.000Z'),
    lastActivityKind: 'CONVERSATION',
    lastEntryPreview: '환불하고 싶어요',
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<InboxSummaryResponse> = {}): InboxSummaryResponse {
  return { open: 1, pending: 0, mine: 0, unassigned: 1, activeHandoff: 0, generatedAt: new Date(), ...overrides };
}

export function makeThreadListResponse(items: InboxThreadListItem[] = [makeThreadListItem()]): InboxThreadListResponse {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    pollAfterMs: 10000,
    generatedAt: new Date(),
    participatingChatbots: [{ id: 'bot-1', name: '쇼핑봇' }],
  };
}

export function makeThreadDetail(overrides: Partial<InboxThreadDetail> = {}): InboxThreadDetail {
  return {
    thread: makeThreadListItem(),
    card: {
      conversations: { total: 3, byChannel: [{ type: 'WEB', label: '웹', count: 3 }], byChatbot: [{ id: 'bot-1', name: '쇼핑봇', count: 3 }] },
      firstActivityAt: new Date('2026-09-20T00:00:00.000Z'),
      lastActivityAt: new Date('2026-09-26T10:00:00.000Z'),
      topMatches: [],
      unansweredTurns: 0,
      handoffs: { count: 0 },
      surveysCompleted: 0,
      negativeFeedbacks: 0,
      tags: [],
    },
    timeline: {
      units: [
        {
          kind: 'CONVERSATION',
          at: new Date('2026-09-25T14:02:00.000Z'),
          chatbot: { id: 'bot-1', name: '쇼핑봇' },
          channel: { family: 'DEPLOY', type: 'WEB', label: '웹' },
          sessionRef: 'a'.repeat(16),
          sessionAlias: 'a1b2c3',
          linkId: 'link-1',
          linkSource: 'IDENTITY',
          startedAt: new Date('2026-09-25T14:02:00.000Z'),
          lastAt: new Date('2026-09-25T14:05:00.000Z'),
          turns: [{ at: new Date('2026-09-25T14:02:00.000Z'), user: '환불하고 싶어요', bot: '절차를 안내해 드릴게요', answered: true, handoffTurn: false, blocked: false }],
          handoffs: [],
        },
      ],
      nextCursor: null,
    },
    activeHandoffs: [],
    mergeRevertHours: 24,
    ...overrides,
  };
}

/**
 * SYSTEM 병합 항목(§3.6b 되돌리기 버튼 시험용) — `system.data.mergeId`·`mergedByUserId`·`mergedAt`·
 * `mergeKind`가 실제로 채워진 형태(2026-09-26 계약 보강). 기본값은 "본인(agent-1)이 1시간 전에
 * 수행한 MANUAL 병합"이라 되돌리기 버튼이 즉시 활성 상태로 시험된다.
 */
export function makeMergeSystemEntry(overrides: Partial<TimelineEntryUnit> = {}): TimelineEntryUnit {
  return {
    kind: 'SYSTEM',
    at: new Date('2026-09-26T11:00:00.000Z'),
    entryId: 'entry-merge-1',
    text: '병합됨: 익명 고객 #1b2c3d → 이 고객',
    system: {
      event: 'MERGED_IN',
      data: { mergeId: 'merge-1', sourceAlias: '1b2c3d', mergedByUserId: 'agent-1', mergedAt: new Date(Date.now() - 3600_000).toISOString(), mergeKind: 'MANUAL' },
    },
    ...overrides,
  };
}

export function makeIdentitySpaceItem(overrides: Partial<IdentitySpaceItem> = {}): IdentitySpaceItem {
  return { ref: 'SHOPMALL', chatbots: [{ id: 'bot-2', name: '회원혜택봇' }], ...overrides };
}
