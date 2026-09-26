import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { UnansweredQuestionDetail, UnansweredQuestionListItem } from '@chat-bot/shared-types';
import { UnansweredTable } from './UnansweredTable';

expect.extend(toHaveNoViolations);

let mockGovernanceModeOn = false;
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { governanceModeOn: mockGovernanceModeOn }, can: () => true }),
}));

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

function makeDetail(overrides: Partial<UnansweredQuestionDetail> = {}): UnansweredQuestionDetail {
  return {
    ...makeItem(),
    variants: ['주차 되나요?'],
    trend: [],
    trendApproximated: false,
    ...overrides,
  };
}

/** [신규 No.45] G5 파기 표시·G7 열람 감사 배너(data-governance-ui-spec.md §3.7·§3.10, EX-DG-11). */
describe('UnansweredTable — 데이터 거버넌스(No.45) 표시', () => {
  beforeEach(() => {
    mockGovernanceModeOn = false;
  });

  it('purged:true인 질문은 목록 셀에서 "보존기간 경과로 파기됨"으로 표시된다', () => {
    renderTable([makeItem({ purged: true, questionText: '' })]);
    expect(screen.getByText('보존기간 경과로 파기됨')).toBeInTheDocument();
  });

  /** [코드 리뷰 R1 L-4] purged거나 텍스트가 비어 있으면 체크박스·펼침 버튼 접근 가능한 이름이 빈 문자열이 아니어야 한다. */
  it('purged:true인 행의 선택 체크박스·펼침 버튼은 빈 텍스트 대신 식별 가능한 라벨을 쓴다', () => {
    render(
      <UnansweredTable
        items={[makeItem({ purged: true, questionText: '' })]}
        selected={new Set()}
        onToggleSelect={vi.fn()}
        canWrite
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
    expect(screen.getByRole('checkbox', { name: '보존기간 경과로 파기된 항목 선택' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /보존기간 경과로 파기된 항목 상세 펼치기/ })).toBeInTheDocument();
  });

  it('상세의 lastFeedback.purged:true면 "당시 답변: 보존기간 경과로 파기됨"으로 표시된다(EX-DG-11)', () => {
    const item = makeItem({ source: 'NEGATIVE_FEEDBACK' });
    const detail = makeDetail({
      source: 'NEGATIVE_FEEDBACK',
      lastFeedback: {
        botResponse: '',
        turnAt: new Date('2026-09-20T00:00:00.000Z'),
        target: { kind: 'FAQ', id: 'faq-1', name: '환불 안내', deleted: false },
        purged: true,
      },
    });
    render(
      <MemoryRouter>
        <UnansweredTable
          items={[item]}
          selected={new Set()}
          onToggleSelect={vi.fn()}
          canWrite={false}
          expandedId={item.id}
          onToggleExpand={vi.fn()}
          detailById={new Map([[item.id, detail]])}
          detailLoadingId={null}
          onResolveClick={vi.fn()}
          onIgnoreClick={vi.fn()}
          onReopenClick={vi.fn()}
          topicsById={new Map()}
          chatbotId="bot-1"
          onMarkAddressedClick={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('보존기간 경과로 파기됨')).toBeInTheDocument();
  });

  it('governanceModeOn=true면 상세 패널 상단에 G7 배너("이 화면 열람은 감사로그에 기록됩니다")가 뜬다', () => {
    mockGovernanceModeOn = true;
    const item = makeItem();
    const detail = makeDetail();
    render(
      <MemoryRouter>
        <UnansweredTable
          items={[item]}
          selected={new Set()}
          onToggleSelect={vi.fn()}
          canWrite={false}
          expandedId={item.id}
          onToggleExpand={vi.fn()}
          detailById={new Map([[item.id, detail]])}
          detailLoadingId={null}
          onResolveClick={vi.fn()}
          onIgnoreClick={vi.fn()}
          onReopenClick={vi.fn()}
          topicsById={new Map()}
          chatbotId="bot-1"
          onMarkAddressedClick={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('이 화면 열람은 감사로그에 기록됩니다.')).toBeInTheDocument();
  });
});
