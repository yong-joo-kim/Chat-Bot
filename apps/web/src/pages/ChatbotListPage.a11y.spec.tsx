import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast';
import { makeChatbotListItem, makeGroup } from '../test/fixtures';
import { ChatbotListPage } from './ChatbotListPage';

expect.extend(toHaveNoViolations);

const mockGroupsList = vi.fn();
vi.mock('../api/groups', () => ({
  groupsApi: {
    list: (...args: unknown[]) => mockGroupsList(...args),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    copy: vi.fn(),
  },
}));

const mockChatbotsList = vi.fn();
vi.mock('../api/chatbots', () => ({
  chatbotsApi: {
    list: (...args: unknown[]) => mockChatbotsList(...args),
    slugAvailable: vi.fn(),
  },
}));

const group = makeGroup({ id: 'group-1', name: '고객지원 그룹', chatbotCount: 1 });
const chatbotItem = makeChatbotListItem({ id: 'bot-1', groupId: 'group-1', groupName: '고객지원 그룹' });

/**
 * AC-5-4 axe 자동 접근성 스캔 시범 적용(1개 화면). `시험항목.md` TC-A2.
 *
 * 알려진 한계: jsdom에는 실제 레이아웃/렌더 엔진이 없어 axe-core의 `color-contrast` 규칙은
 * 신뢰할 수 없는 "incomplete" 결과만 낸다(실제 배경색 합성을 계산할 수 없음). 이 룰은 여기서는
 * 비활성화하고, 색상 대비 수치 자체는 `lib/contrast.spec.ts`(WCAG 공식 단위 시험)와
 * `chatbot-operations-ui-spec.md` §2.1 상태배지 대비표(정적 검증)로 별도 커버한다.
 * 실제 브라우저 렌더링 기반 색상대비 스캔은 Playwright + axe-core 등 E2E 인프라 도입 시 보완 필요.
 */
describe('ChatbotListPage — axe 접근성 스캔 (TC-A2)', () => {
  beforeEach(() => {
    mockGroupsList.mockReset();
    mockChatbotsList.mockReset();
  });

  it('데이터가 있는 목록 화면에 구조적 접근성 위반이 없다(레이블/ARIA/랜드마크 등)', async () => {
    mockGroupsList.mockResolvedValue({ items: [group], total: 1, page: 1, pageSize: 100 });
    mockChatbotsList.mockResolvedValue({ items: [chatbotItem], total: 1, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotListPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('총 1건');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(그룹 0개) 화면에도 접근성 위반이 없다(EX-1-5)', async () => {
    mockGroupsList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 100 });
    mockChatbotsList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <ChatbotListPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('그룹이 없습니다. 그룹을 먼저 만들어 주세요.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
