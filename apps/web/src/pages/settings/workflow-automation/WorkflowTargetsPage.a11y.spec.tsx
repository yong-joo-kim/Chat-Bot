import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';
import { MemoryRouter } from 'react-router-dom';
import type { WorkflowTarget } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { WorkflowTargetsPage } from './WorkflowTargetsPage';

expect.extend(toHaveNoViolations);

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockTest = vi.fn();
const mockPause = vi.fn();
const mockResume = vi.fn();

vi.mock('../../../api/workflowTargets', () => ({
  workflowTargetsApi: {
    list: (...args: unknown[]) => mockList(...args),
    picker: vi.fn().mockResolvedValue({ items: [] }),
    findOne: vi.fn(),
    create: (...args: unknown[]) => mockCreate(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    remove: (...args: unknown[]) => mockRemove(...args),
    test: (...args: unknown[]) => mockTest(...args),
    pause: (...args: unknown[]) => mockPause(...args),
    resume: (...args: unknown[]) => mockResume(...args),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

const mockSummary = vi.fn();
vi.mock('../../../api/workflowRuns', () => ({
  workflowRunsApi: { summary: (...args: unknown[]) => mockSummary(...args) },
}));

function makeTarget(overrides: Partial<WorkflowTarget> = {}): WorkflowTarget {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: '그룹웨어 결재 흐름',
    description: null,
    baseUrl: 'https://flow.corp.internal/hooks/abc',
    baseUrlHost: 'flow.corp.internal',
    authType: 'BEARER',
    authHeaderName: null,
    secretRef: 'GW_LEAVE',
    signingEnabled: true,
    signingSecretRef: 'GW_SIGN',
    urlSecretRef: null,
    timeoutMs: 5000,
    maxAttempts: 5,
    allowRawPersonalData: false,
    enabled: true,
    pausedAt: null,
    secretStates: { auth: 'CONFIGURED', signing: 'CONFIGURED', url: 'NOT_REQUIRED', signingWeak: false },
    insecureHttp: false,
    egressDecision: 'ALLOWED',
    consecutiveFailures: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    referencingNodeCount: 1,
    subscriptionCount: 2,
    stats24h: { succeeded: 10, failed: 1 },
    pendingCount: 0,
    heldCount: 0,
    failedRetainedCount: 0,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

/** WF1 — 발송 대상 관리(`workflow-automation-ui-spec.md` §3.1). */
describe('WorkflowTargetsPage', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockRemove.mockReset();
    mockTest.mockReset();
    mockSummary.mockReset();
    mockSummary.mockResolvedValue({ featureEnabled: true, attention: {} });
  });

  it('WORKFLOW_ENABLED=false(featureEnabled:false)면 상시 배너를 보여준다', async () => {
    mockList.mockResolvedValue({ items: [makeTarget()] });
    mockSummary.mockResolvedValue({ featureEnabled: false, attention: {} });

    render(
      <MemoryRouter>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText('서버 설정으로 업무 자동화 기능이 꺼져 있습니다 — 등록·수정은 가능하지만 발송되지 않습니다.'),
    ).toBeInTheDocument();
  });

  it('featureEnabled:true면 배너가 보이지 않는다', async () => {
    mockList.mockResolvedValue({ items: [makeTarget()] });
    render(
      <MemoryRouter>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('그룹웨어 결재 흐름');
    expect(screen.queryByText(/서버 설정으로 업무 자동화 기능이 꺼져 있습니다/)).not.toBeInTheDocument();
  });

  it('대상 목록이 있는 화면에 구조적 접근성 위반이 없다', async () => {
    mockList.mockResolvedValue({ items: [makeTarget()] });
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('그룹웨어 결재 흐름');
    expect(await axe(container, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();
  });

  it('빈 상태(대상 0건)에도 접근성 위반이 없고 안내 문구가 보인다', async () => {
    mockList.mockResolvedValue({ items: [] });
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findByText('등록된 발송 대상이 없습니다.');
    expect(await axe(container, { rules: { 'color-contrast': { enabled: false } } })).toHaveNoViolations();
  });

  it('삭제 시 409 WORKFLOW_TARGET_IN_USE면 참조 목록 배너를 보여준다', async () => {
    const { ApiError } = await import('../../../api/client');
    mockList.mockResolvedValue({ items: [makeTarget()] });
    mockRemove.mockRejectedValue(
      new ApiError(409, '사용 중', 'WORKFLOW_TARGET_IN_USE', [{ field: 'node-1', message: '인사도우미 › 휴가신청완료' }]),
    );

    render(
      <MemoryRouter>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getAllByRole('button', { name: /관리/ })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(screen.getByText('이 대상을 사용하는 노드·구독이 1건 있습니다.')).toBeInTheDocument());
    expect(screen.getByText('인사도우미 › 휴가신청완료')).toBeInTheDocument();
  });

  it('일시 정지 클릭 시 확인 없이 즉시 반영되고 토스트가 뜬다', async () => {
    mockList.mockResolvedValue({ items: [makeTarget()] });
    mockPause.mockResolvedValue({ heldCount: 3 });

    render(
      <MemoryRouter>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    await screen.findAllByText('그룹웨어 결재 흐름');

    fireEvent.click(screen.getAllByRole('button', { name: /관리/ })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: '일시 정지' }));

    await waitFor(() => expect(mockPause).toHaveBeenCalledWith(makeTarget().id));
    expect(await screen.findByText('일시 정지했습니다(보류 3건).')).toBeInTheDocument();
  });

  it('코드리뷰 R1 M-1 — ?attention=consecutiveFailures로 들어오면 연속 실패 10회 이상 대상만 남긴다(WF1-c 이동)', async () => {
    mockList.mockResolvedValue({
      items: [makeTarget({ id: 't-ok', name: '정상 대상', consecutiveFailures: 0 }), makeTarget({ id: 't-bad', name: '문제 대상', consecutiveFailures: 12 })],
    });

    render(
      <MemoryRouter initialEntries={['/settings/workflow-automation/targets?attention=consecutiveFailures']}>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );

    await screen.findAllByText('문제 대상');
    expect(screen.queryByText('정상 대상')).not.toBeInTheDocument();
  });

  it('코드리뷰 R1 M-1 — ?attention=secretMissing으로 들어오면 시크릿 미설정 대상만 남긴다', async () => {
    mockList.mockResolvedValue({
      items: [
        makeTarget({ id: 't-ok', name: '정상 대상' }),
        makeTarget({ id: 't-missing', name: '비밀 미설정 대상', secretStates: { auth: 'MISSING', signing: 'CONFIGURED', url: 'NOT_REQUIRED', signingWeak: false } }),
      ],
    });

    render(
      <MemoryRouter initialEntries={['/settings/workflow-automation/targets?attention=secretMissing']}>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );

    await screen.findAllByText('비밀 미설정 대상');
    expect(screen.queryByText('정상 대상')).not.toBeInTheDocument();
  });

  it('코드리뷰 R1 M-1 — ?q=로 들어오면 검색어가 초기값으로 채워진다', async () => {
    mockList.mockResolvedValue({ items: [makeTarget()] });

    render(
      <MemoryRouter initialEntries={['/settings/workflow-automation/targets?q=%EA%B7%B8%EB%A3%B9%EC%9B%A8%EC%96%B4']}>
        <ToastProvider>
          <WorkflowTargetsPage />
        </ToastProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('검색')).toHaveValue('그룹웨어');
  });
});
