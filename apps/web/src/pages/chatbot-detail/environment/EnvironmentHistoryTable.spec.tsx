import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { EnvironmentSwitchLogItem } from '@chat-bot/shared-types';
import { EnvironmentHistoryTable } from './EnvironmentHistoryTable';

expect.extend(toHaveNoViolations);

const mockHistory = vi.fn();
vi.mock('../../../api/environment', () => ({
  environmentApi: {
    history: (...args: unknown[]) => mockHistory(...args),
  },
}));

const ITEMS: EnvironmentSwitchLogItem[] = [
  {
    id: 'log-1',
    environment: 'PROD',
    method: 'IMMEDIATE',
    fromVersionNo: 44,
    toVersionNo: 43,
    toVersionId: 'ver-43',
    deployScheduleId: null,
    disableMode: null,
    actorEmail: 'admin@example.com',
    reason: '환불 정책 개정',
    createdAt: new Date('2026-09-25T14:02:00.000Z'),
  },
  {
    id: 'log-2',
    environment: 'STAGING',
    method: 'PROMOTE',
    fromVersionNo: 43,
    toVersionNo: 44,
    toVersionId: 'ver-44',
    deployScheduleId: null,
    disableMode: null,
    actorEmail: 'editor-a@example.com',
    reason: null,
    createdAt: new Date('2026-09-24T15:10:00.000Z'),
  },
  // 과거 운영 이력(현재 운영은 ver-43) — [R1 L-4] 케밥 메뉴 진입점을 검증하는 유일한 행.
  {
    id: 'log-0',
    environment: 'PROD',
    method: 'IMMEDIATE',
    fromVersionNo: 42,
    toVersionNo: 42,
    toVersionId: 'ver-42',
    deployScheduleId: null,
    disableMode: null,
    actorEmail: 'admin@example.com',
    reason: null,
    createdAt: new Date('2026-09-20T09:00:00.000Z'),
  },
];

/**
 * `EnvironmentHistoryTable` — EN1-f 전환 이력(`environment-separation-ui-spec.md` §4.8·§11 1차 편차 (a)).
 * 640px 미만에서 표 대신 카드 목록으로 전환한다(가로 스크롤 표를 만들지 않는다).
 */
describe('EnvironmentHistoryTable', () => {
  beforeEach(() => {
    mockHistory.mockReset().mockResolvedValue({ items: ITEMS, total: 3, page: 1, pageSize: 20 });
  });

  it('데스크톱 표(desktop-only)와 모바일 카드 목록(mobile-only)을 함께 렌더한다(§11 (a))', async () => {
    const { container } = render(
      <EnvironmentHistoryTable chatbotId="bot-1" canDeploy={false} onRollbackRequested={vi.fn()} onScheduleSwitchRequested={vi.fn()} currentProdVersionId="ver-43" />,
    );

    await screen.findAllByText('환불 정책 개정');

    const table = container.querySelector('table.environment-history-table-el');
    expect(table).toHaveClass('desktop-only');

    const cardList = container.querySelector('ul.settings-card-list');
    expect(cardList).toHaveClass('mobile-only');
    expect(cardList?.querySelectorAll('li.settings-card')).toHaveLength(3);
    // 카드에도 표와 같은 정보(시각·환경·방식·버전·주체·사유)가 라벨+값 스택으로 들어간다.
    expect(cardList?.textContent).toContain('환불 정책 개정');
    expect(cardList?.textContent).toContain('admin@example.com');
  });

  it('과거 운영 이력이 아닌 행(현재 운영과 같거나 STAGING)에는 canDeploy=true여도 케밥 메뉴가 없다', async () => {
    const { container } = render(
      <EnvironmentHistoryTable chatbotId="bot-1" canDeploy onRollbackRequested={vi.fn()} onScheduleSwitchRequested={vi.fn()} currentProdVersionId="ver-43" />,
    );

    await screen.findAllByText('환불 정책 개정');

    // log-1(PROD, toVersionId=ver-43)은 현재 운영과 같으므로 케밥이 없고, log-2(STAGING)에도 롤백 대상
    // 케밥은 없다 — 과거 운영 이력(log-0)에만 케밥이 뜬다는 사실은 다음 테스트에서 별도로 확인한다.
    expect(screen.queryByRole('button', { name: 'v43 관리' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'v44 관리' })).not.toBeInTheDocument();
  });

  // [R1 L-4] §4.6.2 — 롤백/예약전환 인라인 버튼을 `KebabMenu`로 옮긴다. 데스크톱 표·모바일 카드 모두 동일하다.
  it('과거 운영 이력 행은 케밥 메뉴 안에 롤백/예약 전환 항목이 있고, 선택하면 각 콜백이 그 항목의 버전으로 호출된다', async () => {
    const user = userEvent.setup();
    const onRollback = vi.fn();
    const onSchedule = vi.fn();
    render(
      <EnvironmentHistoryTable chatbotId="bot-1" canDeploy onRollbackRequested={onRollback} onScheduleSwitchRequested={onSchedule} currentProdVersionId="ver-43" />,
    );

    await screen.findAllByText('환불 정책 개정');

    // 데스크톱 표 행의 케밥 트리거는 인라인 버튼이 아니라 메뉴 하나뿐이다(먼저 열어야 항목이 보인다).
    const kebabTriggers = screen.getAllByRole('button', { name: 'v42 관리' });
    expect(kebabTriggers.length).toBeGreaterThan(0);
    await user.click(kebabTriggers[0]);

    const rollbackItems = screen.getAllByRole('menuitem', { name: '이 버전으로 롤백...' });
    await user.click(rollbackItems[0]);
    expect(onRollback).toHaveBeenCalledWith(expect.objectContaining({ id: 'log-0', toVersionId: 'ver-42' }));

    await user.click(kebabTriggers[0]);
    const scheduleItems = screen.getAllByRole('menuitem', { name: '이 버전으로 예약 전환...' });
    await user.click(scheduleItems[0]);
    expect(onSchedule).toHaveBeenCalledWith(expect.objectContaining({ id: 'log-0', toVersionId: 'ver-42' }));
  });

  it('axe 스캔 위반 0건', async () => {
    const { container } = render(
      <EnvironmentHistoryTable chatbotId="bot-1" canDeploy onRollbackRequested={vi.fn()} onScheduleSwitchRequested={vi.fn()} currentProdVersionId="ver-43" />,
    );
    await screen.findAllByText('환불 정책 개정');
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
