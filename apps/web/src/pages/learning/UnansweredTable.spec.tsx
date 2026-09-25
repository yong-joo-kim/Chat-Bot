import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { UnansweredTable } from './UnansweredTable';

expect.extend(toHaveNoViolations);

function makeItem(overrides: Partial<UnansweredQuestionListItem> = {}): UnansweredQuestionListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    chatbotId: 'bot-1',
    questionText: '주차 되나요?',
    occurredCount: 3,
    status: 'RESOLVED',
    firstOccurredAt: new Date('2026-09-01T00:00:00.000Z'),
    lastOccurredAt: new Date('2026-09-20T00:00:00.000Z'),
    recurredCount: 2,
    suggestions: [],
    ...overrides,
  };
}

function renderTable(items: UnansweredQuestionListItem[]): ReturnType<typeof render> {
  return render(
    <UnansweredTable
      items={items}
      selected={new Set()}
      onToggleSelect={vi.fn()}
      canWrite={false}
      expandedId={null}
      onToggleExpand={vi.fn()}
      detailById={new Map()}
      detailLoadingId={null}
      onResolveClick={vi.fn()}
      onIgnoreClick={vi.fn()}
      onReopenClick={vi.fn()}
      topicsById={new Map()}
      chatbotId="bot-1"
      onMarkAddressedClick={vi.fn()}
    />,
  );
}

/** [신규 No.40] "운영 미반영" 배지 · 재발생 배지 판정(`environment-separation-ui-spec.md` §4.16, §15.1). */
describe('UnansweredTable — 운영 미반영 배지(No.40)', () => {
  it('prodReflection이 없으면(모드 꺼짐) "운영 미반영" 배지를 렌더하지 않는다', () => {
    renderTable([makeItem()]);
    expect(screen.queryByText('운영 미반영')).not.toBeInTheDocument();
  });

  it('prodReflection.status === PENDING_SWITCH면 "운영 미반영" 배지를 렌더한다', () => {
    renderTable([makeItem({ prodReflection: { status: 'PENDING_SWITCH' } })]);
    expect(screen.getByText('운영 미반영')).toBeInTheDocument();
  });

  it('prodReflection.status === REFLECTED면 배지가 사라진다(AC-EN7-3)', () => {
    renderTable([makeItem({ prodReflection: { status: 'REFLECTED', reflectedAt: new Date('2026-09-21T00:00:00.000Z') } })]);
    expect(screen.queryByText('운영 미반영')).not.toBeInTheDocument();
  });

  it('모드 꺼짐(prodReflection 없음)에서는 recurredCount > 0이면 기존처럼 재발생 배지를 그대로 보여준다(무회귀)', () => {
    renderTable([makeItem({ recurredCount: 2 })]);
    expect(screen.getByText('반영 후 재발생 2회')).toBeInTheDocument();
  });

  it('모드 켜짐 + PENDING_SWITCH(아직 운영 미반영)이면 재발생 배지를 숨긴다(재유입 오표시 방지)', () => {
    renderTable([
      makeItem({
        recurredCount: 2,
        lastOccurredAt: new Date('2026-09-20T00:00:00.000Z'),
        prodReflection: { status: 'PENDING_SWITCH' },
      }),
    ]);
    expect(screen.queryByText('반영 후 재발생 2회')).not.toBeInTheDocument();
    // "운영 미반영" 배지는 그대로 보인다.
    expect(screen.getByText('운영 미반영')).toBeInTheDocument();
  });

  it('모드 켜짐 + REFLECTED이고 반영 이후 재발생이면 재발생 배지를 보여준다', () => {
    renderTable([
      makeItem({
        recurredCount: 2,
        lastOccurredAt: new Date('2026-09-25T00:00:00.000Z'),
        prodReflection: { status: 'REFLECTED', reflectedAt: new Date('2026-09-20T00:00:00.000Z') },
      }),
    ]);
    expect(screen.getByText('반영 후 재발생 2회')).toBeInTheDocument();
  });

  it('운영 미반영 배지가 있는 행 — axe 스캔 위반 0건', async () => {
    const { container } = renderTable([makeItem({ prodReflection: { status: 'PENDING_SWITCH' } })]);
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
