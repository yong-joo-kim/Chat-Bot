import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { IntegratedBreakdownItem } from '@chat-bot/shared-types';
import { MESSAGES } from '../../constants/messages';
import { SortableBreakdownTable } from './SortableBreakdownTable';

function chatbotItem(overrides: Partial<Extract<IntegratedBreakdownItem, { kind: 'CHATBOT' }>> = {}): IntegratedBreakdownItem {
  return {
    kind: 'CHATBOT',
    id: 'bot-1',
    name: '연말정산봇',
    status: 'ACTIVE',
    archivedAt: null,
    currentGroupId: null,
    currentGroupName: null,
    turnCount: 79600,
    answeredCount: 73000,
    unansweredCount: 1880,
    sessionCount: 19200,
    responseRate: 0.92,
    share: 0.62,
    ...overrides,
  };
}

function groupItem(overrides: Partial<Extract<IntegratedBreakdownItem, { kind: 'GROUP' }>> = {}): IntegratedBreakdownItem {
  return {
    kind: 'GROUP',
    id: 'group-1',
    name: '세무 서비스',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    archived: false,
    archivedAt: null,
    missing: false,
    turnCount: 128420,
    answeredCount: 117000,
    unansweredCount: 3120,
    sessionCount: 31044,
    responseRate: 0.912,
    share: 0.62,
    ...overrides,
  };
}

describe('SortableBreakdownTable — GROUP kind(ALL 스코프)', () => {
  it('기본 정렬(턴 수 내림차순)로 렌더하고 헤더에 aria-sort를 반영한다', () => {
    const items = [groupItem({ id: 'g1', name: '세무 서비스', turnCount: 100 }), groupItem({ id: 'g2', name: '사업자 서비스', turnCount: 500 })];
    render(<SortableBreakdownTable items={items} kind="GROUP" onRowClick={vi.fn()} />);

    const rows = screen.getAllByRole('row').slice(1); // 헤더 제외
    expect(within(rows[0]).getByText('사업자 서비스')).toBeInTheDocument();
    expect(within(rows[1]).getByText('세무 서비스')).toBeInTheDocument();

    const turnHeader = screen.getByRole('columnheader', { name: /턴 수/ });
    expect(turnHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('헤더 버튼을 클릭하면 정렬 방향이 토글되고 aria-live로 안내된다', () => {
    const items = [groupItem({ id: 'g1', name: '세무 서비스', turnCount: 100 }), groupItem({ id: 'g2', name: '사업자 서비스', turnCount: 500 })];
    render(<SortableBreakdownTable items={items} kind="GROUP" onRowClick={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /턴 수/ }));
    const rowsAfterAsc = screen.getAllByRole('row').slice(1);
    expect(within(rowsAfterAsc[0]).getByText('세무 서비스')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /턴 수/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(screen.getByText('턴 수 기준 오름차순 정렬되었습니다.')).toBeInTheDocument();
  });

  it('othersRow/unassignedRow는 정렬 대상이 아니며 항상 맨 아래 고정된다', () => {
    const items = [groupItem({ id: 'g1', name: '세무 서비스', turnCount: 100 })];
    render(
      <SortableBreakdownTable
        items={items}
        othersRow={{ count: 3, turnCount: 50, answeredCount: 40, unansweredCount: 10, sessionCount: 20, responseRate: 0.8, share: 0.05 }}
        unassignedRow={{ turnCount: 10, answeredCount: 8, unansweredCount: 2, sessionCount: 5, responseRate: 0.6, share: 0.01 }}
        kind="GROUP"
        onRowClick={vi.fn()}
      />,
    );

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText('기타 3개')).toBeInTheDocument();
    expect(within(rows[2]).getByText('정리 중(미귀속)')).toBeInTheDocument();
    expect(screen.getByText(/그룹 정보를 아직 채우지 못한 과거 대화입니다/)).toBeInTheDocument();
  });

  it('othersRow는 응답률·세션 수·미응답을 백엔드가 보낸 실값으로 보여준다(설계 §5.5, status/현재 소속 열만 "-")', () => {
    const items = [groupItem({ id: 'g1', name: '세무 서비스', turnCount: 100 })];
    render(
      <SortableBreakdownTable
        items={items}
        othersRow={{ count: 3, turnCount: 50, answeredCount: 40, unansweredCount: 7, sessionCount: 22, responseRate: 0.8, share: 0.05 }}
        kind="GROUP"
        onRowClick={vi.fn()}
      />,
    );

    const row = screen.getAllByRole('row')[2]; // 헤더 + 정렬된 items[0] 다음
    expect(within(row).getByText('80.0%')).toBeInTheDocument();
    expect(within(row).getByText('22')).toBeInTheDocument();
    expect(within(row).getByText('7')).toBeInTheDocument();
    expect(within(row).getByText(MESSAGES.integratedStats.breakdownNoStatusValue)).toBeInTheDocument(); // 상태 열은 대시
  });

  it('CHATBOT kind에서 othersRow는 "현재 소속" 열도 대시("-")로 두고 나머지 지표는 실값을 보여준다', () => {
    const items = [chatbotItem({ id: 'b1', name: '연말정산봇', turnCount: 100 })];
    render(
      <SortableBreakdownTable
        items={items}
        othersRow={{ count: 2, turnCount: 30, answeredCount: 20, unansweredCount: 4, sessionCount: 9, responseRate: 0.66, share: 0.03 }}
        kind="CHATBOT"
        onRowClick={vi.fn()}
      />,
    );

    const row = screen.getAllByRole('row')[2];
    expect(within(row).getByText('66.0%')).toBeInTheDocument();
    expect(within(row).getByText('9')).toBeInTheDocument();
    expect(within(row).getByText('4')).toBeInTheDocument();
    const dashCells = within(row).getAllByText(MESSAGES.integratedStats.breakdownNoStatusValue);
    expect(dashCells).toHaveLength(2); // 상태 + 현재 소속
  });

  it('보관된 그룹은 "보관된 그룹" 배지를, 미귀속(missing) 행은 아이디 접두사를 링크 없이 보여준다', () => {
    const items = [
      groupItem({ id: 'g1', name: '2024 이벤트', archived: true }),
      groupItem({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: null, missing: true }),
    ];
    render(<SortableBreakdownTable items={items} kind="GROUP" onRowClick={vi.fn()} />);

    expect(screen.getByText('보관된 그룹')).toBeInTheDocument();
    expect(screen.getByText('알 수 없는 그룹')).toBeInTheDocument();
    expect(screen.getByText('aaaaaaaa')).toBeInTheDocument();
  });

  it('그룹 행(보관되지 않음)을 클릭하면 onRowClick이 호출된다', () => {
    const onRowClick = vi.fn();
    render(<SortableBreakdownTable items={[groupItem()]} kind="GROUP" onRowClick={onRowClick} />);
    fireEvent.click(screen.getByRole('button', { name: /세무 서비스/ }));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1' }));
  });

  it('행이 없으면 빈 상태를 보여준다', () => {
    render(<SortableBreakdownTable items={[]} kind="GROUP" onRowClick={vi.fn()} />);
    expect(screen.getByText('기여 데이터가 없습니다.')).toBeInTheDocument();
  });
});

describe('SortableBreakdownTable — CHATBOT kind(GROUP 스코프)', () => {
  it('"현재 소속" 열을 보여주고, 다른 그룹 소속이면 배지를 표시한다', () => {
    const items = [chatbotItem({ currentGroupId: 'group-2', currentGroupName: '사업자 서비스' })];
    render(<SortableBreakdownTable items={items} kind="CHATBOT" onRowClick={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: '현재 소속' })).toBeInTheDocument();
    expect(screen.getByText('현재: 사업자 서비스')).toBeInTheDocument();
  });

  it('보관된 챗봇은 "보관됨 · 날짜" 배지를 보여준다', () => {
    const items = [chatbotItem({ status: 'ARCHIVED', archivedAt: new Date('2025-02-10T00:00:00.000Z') })];
    render(<SortableBreakdownTable items={items} kind="CHATBOT" onRowClick={vi.fn()} />);
    expect(screen.getByText(/보관됨 · 2025/)).toBeInTheDocument();
  });

  it('턴 수 0건인 행은 응답률에 "-"를 보여준다', () => {
    const items = [chatbotItem({ turnCount: 0, responseRate: 0 })];
    render(<SortableBreakdownTable items={items} kind="CHATBOT" onRowClick={vi.fn()} />);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getAllByText('-').length).toBeGreaterThan(0);
  });
});
