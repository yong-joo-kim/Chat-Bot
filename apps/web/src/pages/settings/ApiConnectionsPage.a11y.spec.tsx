import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../../components/Toast';
import { ApiConnectionsPage } from './ApiConnectionsPage';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();

vi.mock('../../api/apiConnections', () => ({
  apiConnectionsApi: {
    list: (...args: unknown[]) => mockList(...args),
    picker: vi.fn().mockResolvedValue({ items: [] }),
    findOne: vi.fn(),
    samples: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    test: vi.fn(),
  },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'ERP 주문',
    description: null,
    baseUrl: 'https://erp.corp.local/api',
    baseUrlHost: 'erp.corp.local',
    allowedMethods: ['GET', 'POST'],
    authType: 'BEARER',
    authHeaderName: null,
    secretRef: 'ERP',
    timeoutMs: 3000,
    rateLimitPerMin: 120,
    allowRawPersonalData: false,
    personalDataLookup: false,
    sampleCount: 1,
    enabled: true,
    secretStatus: 'CONFIGURED',
    insecureHttp: false,
    circuitOpen: false,
    referencingNodeCount: 2,
    stats24h: { calls: 10, failures: 1 },
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

/** AC1 — API 연결 관리 화면 axe 접근성 스캔(legacy-api-integration-ui-spec.md §3.1, AC-L8-2). */
describe('ApiConnectionsPage — axe 접근성 스캔', () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it('연결 목록이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [makeConnection()] });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <ApiConnectionsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('ERP 주문');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });

  it('빈 상태(연결 0건) 화면에도 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [] });

    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <ApiConnectionsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('등록된 API 연결이 없습니다.');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
