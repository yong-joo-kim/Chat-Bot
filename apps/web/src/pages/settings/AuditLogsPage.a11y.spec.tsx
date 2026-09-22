import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { makeAuditLogListItem, makeUser } from '../../test/fixtures';
import { AuditLogsPage } from './AuditLogsPage';

expect.extend(toHaveNoViolations);

const mockAuditLogsList = vi.fn();
const mockUsersList = vi.fn();

vi.mock('../../api/auditLogs', () => ({
  auditLogsApi: {
    list: (...args: unknown[]) => mockAuditLogsList(...args),
    findOne: vi.fn(),
    exportUrl: () => '/api/v1/audit-logs/export',
  },
}));

vi.mock('../../api/users', () => ({
  usersApi: { list: (...args: unknown[]) => mockUsersList(...args) },
}));

// `AuditLogFilterBar`가 `ResourcePickerField(resourceType='chatbot')`를 통해 참조한다(마운트 시
// 호출되지 않지만 모듈 import 자체가 필요하므로 최소 목을 제공한다).
vi.mock('../../api/chatbots', () => ({ chatbotsApi: { list: vi.fn(), findOne: vi.fn() } }));
vi.mock('../../api/dialogue', () => ({
  intentsApi: { list: vi.fn(), findOne: vi.fn() },
  keywordsApi: { list: vi.fn(), findOne: vi.fn() },
  contextsApi: { list: vi.fn(), findOne: vi.fn() },
  dialogNodesApi: { list: vi.fn(), findOne: vi.fn() },
}));

/** A1 이력 관리 화면 axe 접근성 스캔 — AC-U-11. */
describe('AuditLogsPage — axe 접근성 스캔 (AC-U-11)', () => {
  beforeEach(() => {
    mockAuditLogsList.mockReset();
    mockUsersList.mockReset();
    mockUsersList.mockResolvedValue({ items: [makeUser()], total: 1, page: 1, pageSize: 100 });
  });

  it('이력 목록이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    mockAuditLogsList.mockResolvedValue({
      items: [makeAuditLogListItem()],
      total: 1,
      page: 1,
      pageSize: 20,
      appliedFrom: new Date('2026-09-01T00:00:00.000Z'),
      appliedTo: new Date('2026-09-20T00:00:00.000Z'),
      rangeDefaulted: true,
    });

    const { container } = render(
      <MemoryRouter>
        <AuditLogsPage />
      </MemoryRouter>,
    );
    await screen.findAllByText('주문_배송조회');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('필터 조건에 해당하는 이력이 없는 빈 상태에도 접근성 위반이 없다', async () => {
    mockAuditLogsList.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      appliedFrom: new Date('2026-09-01T00:00:00.000Z'),
      appliedTo: new Date('2026-09-20T00:00:00.000Z'),
      rangeDefaulted: true,
    });

    const { container } = render(
      <MemoryRouter>
        <AuditLogsPage />
      </MemoryRouter>,
    );
    await screen.findByText('선택한 조건에 해당하는 이력이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
