import type { Chatbot, ChatbotGroupWithCount, ChatbotListItem } from '@chat-bot/shared-types';
import type { DashboardSummary } from '@chat-bot/shared-types';

/**
 * 컴포넌트/통합 테스트용 최소 픽스처. `apps/api/prisma/seed.ts`의 3트랙
 * (sample-support-bot/empty-dashboard-bot/archived-legacy-bot) 네이밍을 그대로 재사용해
 * 시험데이터 문서(`docs/04-test/시험데이터.md`)와 대조하기 쉽게 한다.
 */

export function makeGroup(overrides: Partial<ChatbotGroupWithCount> = {}): ChatbotGroupWithCount {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: '고객지원 그룹',
    description: undefined,
    chatbotCount: 1,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeChatbot(overrides: Partial<Chatbot> = {}): Chatbot {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    groupId: '11111111-1111-4111-8111-111111111111',
    name: '주문 상담봇',
    avatarUrl: undefined,
    description: undefined,
    slug: 'order-bot',
    status: 'ACTIVE',
    skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeChatbotListItem(overrides: Partial<ChatbotListItem> = {}): ChatbotListItem {
  const chatbot = makeChatbot(overrides);
  return { ...chatbot, groupName: overrides.groupName ?? '고객지원 그룹' };
}

/** empty-dashboard-bot(로그 0건) 트랙과 동일한 빈 상태 대시보드 응답(AC-2-5/AC-2-6). */
export function makeEmptyDashboardSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    chatbotId: '33333333-3333-4333-8333-333333333333',
    periodStart: new Date('2026-09-13T00:00:00.000Z'),
    periodEnd: new Date('2026-09-19T23:59:59.999Z'),
    visitCount: 0,
    visitCountBasis: 'LOG_COUNT',
    totalLogCount: 0,
    responseRate: 0,
    noResponseRate: 0,
    topQuestions: [],
    ...overrides,
  };
}

/** sample-support-bot(로그 100건) 트랙과 동일한 정상 데이터 대시보드 응답. */
export function makeDashboardSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    chatbotId: '22222222-2222-4222-8222-222222222222',
    periodStart: new Date('2026-09-13T00:00:00.000Z'),
    periodEnd: new Date('2026-09-19T23:59:59.999Z'),
    visitCount: 100,
    visitCountBasis: 'LOG_COUNT',
    totalLogCount: 100,
    responseRate: 0.9,
    noResponseRate: 0.1,
    topQuestions: [
      { question: '배송 조회', count: 12 },
      { question: '환불 절차', count: 7 },
    ],
    ...overrides,
  };
}

/* ── 보안/이력(No.12~13) 픽스처 ── */
import type { AuditLogDetail, AuditLogListItem, BannedWord, CurrentUser, User } from '@chat-bot/shared-types';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    email: 'editor@chat-bot.local',
    name: '김편집',
    role: 'EDITOR',
    status: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: new Date('2026-09-20T09:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T09:00:00.000Z'),
    ...overrides,
  };
}

export function makeCurrentUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  const base = makeUser();
  return {
    ...base,
    permissions: ['chatbot:read', 'chatbot:write', 'dialogue:read', 'dialogue:write', 'channel:read', 'channel:write', 'simulation:read'],
    ...overrides,
  };
}

export function makeAdminUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return makeCurrentUser({
    id: '55555555-5555-4555-8555-555555555555',
    email: 'admin@chat-bot.local',
    name: '박관리',
    role: 'ADMIN',
    permissions: [
      'chatbot:read', 'chatbot:write', 'chatbot:delete', 'chatbot:purge',
      'dialogue:read', 'dialogue:write', 'channel:read', 'channel:write', 'simulation:read',
      'user:read', 'user:write', 'security:read', 'security:write', 'audit:read',
    ],
    ...overrides,
  });
}

export function makeViewerUser(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return makeCurrentUser({
    id: '66666666-6666-4666-8666-666666666666',
    email: 'viewer@chat-bot.local',
    name: '이조회',
    role: 'VIEWER',
    permissions: ['chatbot:read', 'dialogue:read', 'channel:read', 'simulation:read'],
    ...overrides,
  });
}

export function makeBannedWord(overrides: Partial<BannedWord> = {}): BannedWord {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    word: '금칙어',
    wordNormalized: '금칙어',
    matchType: 'CONTAINS',
    policy: 'BLOCK',
    enabled: true,
    description: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeAuditLogListItem(overrides: Partial<AuditLogListItem> = {}): AuditLogListItem {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    createdAt: new Date('2026-09-19T14:22:00.000Z'),
    actorId: '44444444-4444-4444-8444-444444444444',
    actorEmail: 'editor@chat-bot.local',
    actorRole: 'EDITOR',
    action: 'DELETE',
    targetType: 'Intent',
    targetId: '99999999-9999-4999-8999-999999999999',
    targetName: '주문_배송조회',
    chatbotId: '22222222-2222-4222-8222-222222222222',
    summary: null,
    ...overrides,
  };
}

/* ── 운영 예약 배포(No.28) 픽스처 ── */
import type { DeployScheduleMeta } from '@chat-bot/shared-types';

/** `useDeployScheduleMeta`/`ScheduleConflictBanner` 등 meta를 필요로 하는 컴포넌트 테스트 공용 픽스처. */
export function makeDeployScheduleMeta(overrides: Partial<DeployScheduleMeta> = {}): DeployScheduleMeta {
  return {
    timezone: 'Asia/Seoul',
    timezoneFallback: false,
    engine: { enabledOnThisInstance: true, pollIntervalMs: 1000, misfireGraceMinutes: 10, retryWindowMinutes: 15, leaseMinutes: 5, overduePendingCount: 0 },
    limits: { minLeadMinutes: 5, maxHorizonDays: 90, minSpacingMinutes: 1, maxActivePerChatbot: 5, memoMaxCodePoints: 200, longHorizonWarnDays: 30, listPageSizeDefault: 20, listPageSizeMax: 100 },
    ...overrides,
  };
}

export function makeAuditLogDetail(overrides: Partial<AuditLogDetail> = {}): AuditLogDetail {
  const item = makeAuditLogListItem(overrides);
  return {
    ...item,
    before: { name: '주문_배송조회', examples: ['배송 조회해줘'] },
    after: null,
    changedFields: ['name', 'examples'],
    truncated: false,
    ip: '127.0.0.1',
    userAgent: 'vitest',
    ...overrides,
  };
}

/* ── 토픽 시스템(No.22) 픽스처 ── */
import type { Topic, TopicListItem } from '@chat-bot/shared-types';

export function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    chatbotId: '22222222-2222-4222-8222-222222222222',
    name: '배송',
    description: undefined,
    sortOrder: 0,
    enabled: true,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

export function makeTopicListItem(overrides: Partial<TopicListItem> = {}): TopicListItem {
  const topic = makeTopic(overrides);
  return {
    ...topic,
    counts: { intents: 0, keywords: 0, homonyms: 0, contexts: 0, dialogNodes: 0, faqs: 0 },
    outgoingCrossRefs: 0,
    incomingCrossRefs: 0,
    ...overrides,
  };
}
