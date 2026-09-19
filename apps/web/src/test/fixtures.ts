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
