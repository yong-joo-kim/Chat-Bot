import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { ProactiveRuleEditModal } from './ProactiveRuleEditModal';

expect.extend(toHaveNoViolations);

vi.mock('../../../api/proactive', () => ({
  proactiveApi: {
    createRule: vi.fn(),
    updateRule: vi.fn(),
  },
}));

/** 설계서 §16.1 — 선제 안내(No.35) 규칙 편집 모달 axe 접근성 스캔(Medium #4). */
describe('ProactiveRuleEditModal — axe 접근성 스캔', () => {
  it('신규 규칙 작성 폼에 구조적 접근성 위반이 없다', async () => {
    const { container } = render(
      <ProactiveRuleEditModal isOpen chatbotId="bot-1" rule={null} onClose={vi.fn()} onSaved={vi.fn()} primaryColor="#4F46E5" />,
    );
    await screen.findByRole('button', { name: '저장' });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('기존 규칙 수정 폼에 구조적 접근성 위반이 없다', async () => {
    const { container } = render(
      <ProactiveRuleEditModal
        isOpen
        chatbotId="bot-1"
        rule={{
          id: '11111111-1111-4111-8111-111111111111',
          name: '배송조회 도움',
          enabled: true,
          position: 0,
          trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 5 },
          text: '주문·배송 조회를 도와드릴까요?',
          buttons: [],
          devices: ['DESKTOP', 'MOBILE'],
          startsAt: null,
          endsAt: null,
          schedule: null,
          periodState: 'ALWAYS',
          issues: [],
          warnings: [],
          last7d: { shown: 12, clicked: 3, dismissed: 1, optedOut: 0 },
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        primaryColor="#4F46E5"
      />,
    );
    await screen.findByRole('button', { name: '저장' });

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
