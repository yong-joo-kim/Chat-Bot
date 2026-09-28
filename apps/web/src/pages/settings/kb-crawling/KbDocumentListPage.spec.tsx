import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import type { KbDocumentView, KbMetaResponse, KbSourceResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { KbDocumentListPage } from './KbDocumentListPage';
import type { KbSourceOutletContext } from './KbSourceShell';

const mockListDocuments = vi.fn();
const mockCreateRun = vi.fn();

vi.mock('../../../api/kbSources', () => ({
  kbSourcesApi: {
    listDocuments: (...args: unknown[]) => mockListDocuments(...args),
    createRun: (...args: unknown[]) => mockCreateRun(...args),
  },
}));

let canWrite = true;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'security:write' ? canWrite : true) }),
}));

function makeSource(overrides: Partial<KbSourceResponse> = {}): KbSourceResponse {
  return {
    id: 's1',
    name: '인사규정 게시판',
    seedUrls: [],
    sitemapUrls: [],
    allowedHosts: [],
    pathPrefixes: [],
    excludePatterns: [],
    noisePatterns: [],
    allowQueryUrls: false,
    maxDepth: 3,
    maxPages: 500,
    fileTypes: [],
    maxFileBytes: 20971520,
    minIntervalMs: 1000,
    scope: { company: '예시공사', category: '인사', subcategory: '크롤_인사규정' },
    schedule: { kind: 'DAILY', time: '03:00' },
    authKind: 'NONE',
    authHeaderName: null,
    authSecretRef: null,
    piiMask: true,
    allowRawFileIngest: false,
    enabled: true,
    configVersion: 1,
    ingestApproved: true,
    needsPreview: false,
    reviewRequiredReason: null,
    activeRun: null,
    lastRun: null,
    nextRunAt: null,
    needsCleanupCount: 0,
    repeatedFailureCount: 0,
    activeDocumentCount: 312,
    previewStale: false,
    rightsConfirmedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

function makeDoc(overrides: Partial<KbDocumentView> = {}): KbDocumentView {
  return {
    id: 'd1',
    displayUrl: 'intra.example.local/hr/rules/2019-05.html',
    kind: 'HTML',
    state: 'GONE',
    excludeReason: null,
    cleanupReason: 'GONE',
    observedChange: null,
    title: '2019년 규정',
    lastIngestedAt: null,
    lastSeenAt: new Date('2026-09-25T00:00:00.000Z'),
    consecutiveIngestFailures: 0,
    externalFileName: 'kb_a1b2c3d4_0123456789abcdef.docx',
    ...overrides,
  };
}

function OutletWrapper({ ctx }: { ctx: KbSourceOutletContext }): JSX.Element {
  return <Outlet context={ctx} />;
}

function renderPage(source: KbSourceResponse, initialPath = '/settings/kb-crawling/s1/documents', meta: Partial<KbMetaResponse> = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <Routes>
          <Route
            path="/settings/kb-crawling/:sourceId"
            element={<OutletWrapper ctx={{ source, meta: meta as KbMetaResponse, reloadSource: vi.fn() }} />}
          >
            <Route path="documents" element={<KbDocumentListPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** KB5 — 소스 상세: 문서 목록·정리 필요(kb-crawling-ui-spec.md §3.5). */
describe('KbDocumentListPage', () => {
  beforeEach(() => {
    mockListDocuments.mockReset();
    mockCreateRun.mockReset();
    canWrite = true;
  });

  it('security:write가 없으면(VIEWER 등) 정리 필요 배너는 보이되 전체 다시 적재 버튼은 보이지 않는다(읽기 전용)', async () => {
    canWrite = false;
    mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    renderPage(makeSource({ needsCleanupCount: 1 }));

    expect(await screen.findByText(/정리 필요 1건/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '전체 다시 적재' })).not.toBeInTheDocument();
  });

  it('정리 필요 문서가 있으면 배너와 전체 다시 적재 버튼을 보여준다', async () => {
    mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    renderPage(makeSource({ needsCleanupCount: 1 }));

    expect(await screen.findByText(/정리 필요 1건/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전체 다시 적재' })).toBeInTheDocument();
  });

  it('정리 필요 문서가 0건이면 배너를 보여주지 않는다', async () => {
    mockListDocuments.mockResolvedValue({ items: [makeDoc({ state: 'ACTIVE', cleanupReason: null })], total: 1, page: 1, pageSize: 50 });
    renderPage(makeSource({ needsCleanupCount: 0 }));

    await screen.findAllByText('intra.example.local/hr/rules/2019-05.html', { exact: false });
    expect(screen.queryByText(/외부 RAG에 이 문서의 옛 내용이 남아 있어/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '전체 다시 적재' })).not.toBeInTheDocument();
  });

  /** [No.43 R1 M3] 필터로 인해 0건이 된 경우는 "아직 수집된 문서가 없습니다"와 다른 문구를 쓴다. */
  it('필터 결과가 0건이면 "아직 수집된 문서가 없습니다"와 다른 문구를 보여주고, 필터 초기화 버튼을 제공한다', async () => {
    const user = userEvent.setup();
    mockListDocuments
      .mockResolvedValueOnce({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 50 })
      .mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    renderPage(makeSource());

    await screen.findAllByText('intra.example.local/hr/rules/2019-05.html', { exact: false });
    await user.selectOptions(screen.getByLabelText('상태'), 'EXCLUDED');

    expect(await screen.findByText('필터 조건에 맞는 문서가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText('아직 수집된 문서가 없습니다. 먼저 실행하세요.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '필터 초기화' }));
    expect(mockListDocuments).toHaveBeenLastCalledWith('s1', expect.objectContaining({ state: undefined, cleanupOnly: undefined, excludeReason: undefined }));
  });

  it('?cleanupOnly=true 딥링크로 들어오면 "정리 필요만" 체크박스가 초기값부터 체크되어 있다', async () => {
    mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    renderPage(makeSource({ needsCleanupCount: 1 }), '/settings/kb-crawling/s1/documents?cleanupOnly=true');

    await screen.findByText(/정리 필요 1건/);
    expect(screen.getByLabelText('정리 필요만')).toBeChecked();
    expect(mockListDocuments).toHaveBeenCalledWith('s1', expect.objectContaining({ cleanupOnly: true }));
  });

  it('전체 다시 적재 확인 체크 없이 진행하면 인라인 오류를 보여주고 요청을 보내지 않는다', async () => {
    const user = userEvent.setup();
    mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    renderPage(makeSource({ needsCleanupCount: 1 }));

    await user.click(await screen.findByRole('button', { name: '전체 다시 적재' }));
    const dialog = screen.getByRole('dialog', { name: '전체 다시 적재' });
    await user.click(within(dialog).getByRole('button', { name: '전체 다시 적재' }));

    expect(await screen.findByText('확인란에 체크해야 진행할 수 있습니다.')).toBeInTheDocument();
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it('확인 체크 후 진행하면 FULL_RESEND 실행을 요청한다', async () => {
    const user = userEvent.setup();
    mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    mockCreateRun.mockResolvedValue({ runId: 'run-x' });
    renderPage(makeSource({ needsCleanupCount: 1 }));

    await user.click(await screen.findByRole('button', { name: '전체 다시 적재' }));
    const dialog = screen.getByRole('dialog', { name: '전체 다시 적재' });
    await user.click(within(dialog).getByLabelText(/외부 RAG에서 이 서브카테고리를 정리했습니다/));
    await user.click(within(dialog).getByRole('button', { name: '전체 다시 적재' }));

    expect(mockCreateRun).toHaveBeenCalledWith('s1', { kind: 'FULL_RESEND', acknowledgeCleanup: true });
  });

  /** [3차 보완] KB9 확인 문구는 `activeDocumentCount`(실제 활성 문서 수)를 써야 한다 —
   * `needsCleanupCount`(정리 필요 건수)나 현재 필터링된 문서 목록의 `total`과는 다른 숫자다. */
  it('전체 다시 적재 확인 문구는 activeDocumentCount를 쓴다(정리 필요 건수·목록 total과 다름)', async () => {
    const user = userEvent.setup();
    mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    renderPage(makeSource({ needsCleanupCount: 1, activeDocumentCount: 500 }));

    await user.click(await screen.findByRole('button', { name: '전체 다시 적재' }));

    const dialog = await screen.findByRole('dialog', { name: '전체 다시 적재' });
    expect(within(dialog).getByText(/활성 문서 500건/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/활성 문서 1건/)).not.toBeInTheDocument();
  });

  /** [3차 보완] `REVIEW_REQUIRED`는 이제 서버가 실제로 보내는 코드다 — 방어 코드가 아니라 정식
   * 분기(개요 탭 재확인 안내)로 처리해야 한다. */
  it('REVIEW_REQUIRED(자동 강등 후 재확인 필요) 오류는 전용 안내 토스트를 보여준다', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../../../api/client');
    mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
    mockCreateRun.mockRejectedValue(
      new ApiError(409, '내용이 크게 바뀌어 미리보기를 다시 확인해야 합니다.', 'KB_INGEST_NOT_ALLOWED', [{ field: 'kind', message: 'REVIEW_REQUIRED' }]),
    );
    renderPage(makeSource({ needsCleanupCount: 1, reviewRequiredReason: 'NEW_RATIO' }));

    await user.click(await screen.findByRole('button', { name: '전체 다시 적재' }));
    const dialog = screen.getByRole('dialog', { name: '전체 다시 적재' });
    await user.click(within(dialog).getByLabelText(/외부 RAG에서 이 서브카테고리를 정리했습니다/));
    await user.click(within(dialog).getByRole('button', { name: '전체 다시 적재' }));

    expect(await screen.findByText('자동 점검 결과 확인이 필요합니다 — 개요 탭에서 다시 확인한 뒤 전체 다시 적재를 진행하세요.')).toBeInTheDocument();
  });

  /** [No.43 pass 10 후속] 거버넌스 규칙 위반이면 "전체 다시 적재"를 미리 비활성으로 하고 사유를 보인다. */
  describe('거버넌스 위반 시 전체 다시 적재 사전 비활성', () => {
    it('거버넌스 ON + 마스킹 끔이면 버튼이 비활성이고 보이는 사유가 aria-describedby로 연결된다', async () => {
      mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
      renderPage(makeSource({ needsCleanupCount: 1, piiMask: false }), undefined, { governanceMode: 'ON', rawFileIngestAllowedByServer: false });

      const button = await screen.findByRole('button', { name: '전체 다시 적재' });
      expect(button).toBeDisabled();
      const reason = document.getElementById(button.getAttribute('aria-describedby') as string);
      expect(reason).not.toBeNull();
      expect(reason).toHaveTextContent('거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다.');
      expect(reason).toBeVisible();
    });

    it('원본 파일 전달 켬 + 서버 허용 없음이면 원본 파일 사유로 비활성이다', async () => {
      mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
      renderPage(makeSource({ needsCleanupCount: 1, allowRawFileIngest: true }), undefined, { governanceMode: 'ON', rawFileIngestAllowedByServer: false });

      const button = await screen.findByRole('button', { name: '전체 다시 적재' });
      expect(button).toBeDisabled();
      expect(document.getElementById(button.getAttribute('aria-describedby') as string)).toHaveTextContent('원본 파일 전달을 꺼 주세요');
    });

    it('위반이 아니면 활성이다(거버넌스 OFF)', async () => {
      mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
      renderPage(makeSource({ needsCleanupCount: 1, piiMask: false }), undefined, { governanceMode: 'OFF', rawFileIngestAllowedByServer: false });

      const button = await screen.findByRole('button', { name: '전체 다시 적재' });
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute('aria-describedby');
    });

    it('메타를 모르면(governanceMode 없음) 활성을 유지한다(서버 409 폴백)', async () => {
      mockListDocuments.mockResolvedValue({ items: [makeDoc()], total: 1, page: 1, pageSize: 50 });
      renderPage(makeSource({ needsCleanupCount: 1, piiMask: false }));

      expect(await screen.findByRole('button', { name: '전체 다시 적재' })).not.toBeDisabled();
    });
  });
});
