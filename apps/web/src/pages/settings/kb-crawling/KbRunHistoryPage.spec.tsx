import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import type { KbMetaResponse, KbRunView, KbSourceResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { KbRunHistoryPage } from './KbRunHistoryPage';
import type { KbSourceOutletContext } from './KbSourceShell';

const mockListRuns = vi.fn();
const mockCancelRun = vi.fn();

vi.mock('../../../api/kbSources', () => ({
  kbSourcesApi: {
    listRuns: (...args: unknown[]) => mockListRuns(...args),
    cancelRun: (...args: unknown[]) => mockCancelRun(...args),
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

function makeRun(overrides: Partial<KbRunView> = {}): KbRunView {
  return {
    id: 'run-1',
    sourceId: 's1',
    sourceName: '인사규정 게시판',
    kind: 'SYNC',
    trigger: 'SCHEDULED',
    status: 'SUCCEEDED',
    crawl: { discovered: 312, visited: 312, unchanged: 312, added: 0, changed: 0, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 0, excluded: {}, outOfScopeLinks: 0 },
    ingest: null,
    progress: null,
    etaSeconds: null,
    waitingReason: null,
    maxPagesReached: false,
    demotedReason: null,
    failureCode: null,
    resumedCount: 0,
    startedAt: new Date('2026-09-27T00:00:00.000Z'),
    crawlFinishedAt: new Date('2026-09-27T00:04:00.000Z'),
    finishedAt: new Date('2026-09-27T00:04:00.000Z'),
    createdAt: new Date('2026-09-27T00:00:00.000Z'),
    ...overrides,
  };
}

function OutletWrapper({ ctx }: { ctx: KbSourceOutletContext }): JSX.Element {
  return <Outlet context={ctx} />;
}

function renderPage(meta: Partial<KbMetaResponse> = {}) {
  const fullMeta: KbMetaResponse = {
    enabled: true,
    ragConfigured: true,
    ingestAck: 'INTERNAL_NETWORK',
    ragReady: true,
    ragCheckedAt: null,
    htmlFormat: 'DOCX',
    caps: { maxPages: 5000, maxFileBytes: 20971520 },
    privateAllowlistConfigured: true,
    governanceMode: 'OFF',
    rawFileIngestAllowedByServer: false,
    bulkWindow: null,
    failedSourceCount: 0,
    needsCleanupSourceCount: 0,
    ...meta,
  };
  return render(
    <MemoryRouter initialEntries={['/settings/kb-crawling/s1/runs']}>
      <ToastProvider>
        <Routes>
          <Route path="/settings/kb-crawling/:sourceId" element={<OutletWrapper ctx={{ source: makeSource(), meta: fullMeta, reloadSource: vi.fn() }} />}>
            <Route path="runs" element={<KbRunHistoryPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/**
 * KB4 — 소스 상세: 실행 이력(kb-crawling-ui-spec.md §3.4). 5초 폴링은 진행 중 실행이 있을 때만,
 * 언마운트 시 정리되어야 한다(설계서 §12 화면 5).
 *
 * `window.setInterval`/`clearInterval`을 스파이해 등록·해제 여부와 콜백을 직접 검증한다 — 실제
 * 타이머(가짜/실제 모두)를 흘려보내는 방식은 다른 시험 파일과 병렬 실행될 때 CPU 경합으로 결과가
 * 흔들릴 수 있어 쓰지 않는다(결정적 검증).
 */
describe('KbRunHistoryPage', () => {
  beforeEach(() => {
    mockListRuns.mockReset();
    mockCancelRun.mockReset();
    canWrite = true;
  });

  // testing-library의 `waitFor`/`findBy*`는 내부적으로 자체 폴링용 `setInterval(fn, 50)`을 쓴다
  // (가짜 타이머 감지용 `checkRealTimersCallback` 포함) — 그 잡음을 제외하고 우리 컴포넌트가 실제로
  // 등록한 5초 간격 호출만 골라낸다.
  function ownIntervalCalls(spy: ReturnType<typeof vi.spyOn>): typeof spy.mock.calls {
    return spy.mock.calls.filter(([, delay]) => delay === 5000);
  }

  /**
   * 폴링 등록은 데이터가 반영된 뒤 커밋되는 `useEffect`에서 일어난다 — `findAllByText`가 텍스트를
   * 찾은 시점과 effect 플러시 시점 사이에는(특히 전체 스위트를 병렬로 돌릴 때 CPU 경합이 있으면)
   * 미세한 간격이 생길 수 있어, 등록 자체도 `waitFor`로 기다린다(결과를 고정된 타이밍에 의존하지 않음).
   */
  async function waitForOwnIntervalCall(spy: ReturnType<typeof vi.spyOn>) {
    await waitFor(() => expect(ownIntervalCalls(spy).length).toBeGreaterThan(0));
    return ownIntervalCalls(spy)[0];
  }

  it('진행 중 실행이 없으면 폴링 타이머를 등록하지 않는다', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockListRuns.mockResolvedValue({ items: [makeRun()], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findAllByText(/성공/);
    // 데이터가 안정된 뒤에도 등록되지 않았음을 확인하기 위해 잠깐의 유예를 둔다.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ownIntervalCalls(setIntervalSpy)).toHaveLength(0);
    setIntervalSpy.mockRestore();
  });

  it('진행 중 실행(CRAWLING)이 있으면 5초 간격 타이머를 등록하고, 콜백이 실행되면 다시 조회한다', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockListRuns.mockResolvedValue({ items: [makeRun({ status: 'CRAWLING', progress: null })], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findAllByText(/수집 중/);
    const ownCall = await waitForOwnIntervalCall(setIntervalSpy);
    const callback = ownCall[0] as () => void;

    expect(mockListRuns).toHaveBeenCalledTimes(1);
    await act(async () => {
      callback();
      await Promise.resolve();
    });
    expect(mockListRuns).toHaveBeenCalledTimes(2);

    setIntervalSpy.mockRestore();
  });

  it('언마운트하면 등록된 타이머를 정리한다', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    mockListRuns.mockResolvedValue({ items: [makeRun({ status: 'CRAWLING' })], total: 1, page: 1, pageSize: 20 });
    const { unmount } = renderPage();

    await screen.findAllByText(/수집 중/);
    const ownCall = await waitForOwnIntervalCall(setIntervalSpy);
    const ownCallIndex = setIntervalSpy.mock.calls.indexOf(ownCall);
    const timerId = setIntervalSpy.mock.results[ownCallIndex].value;

    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('security:write가 없으면(VIEWER 등) 진행 중 실행에도 "중지" 버튼이 보이지 않는다(읽기 전용)', async () => {
    canWrite = false;
    mockListRuns.mockResolvedValue({ items: [makeRun({ status: 'CRAWLING' })], total: 1, page: 1, pageSize: 20 });
    renderPage();

    await screen.findAllByText(/수집 중/);
    expect(screen.queryByRole('button', { name: '중지' })).not.toBeInTheDocument();
  });

  it('상태가 실제로 바뀔 때만 aria-live 영역 텍스트가 갱신된다(진행률 숫자 변화는 재낭독하지 않음)', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mockListRuns
      .mockResolvedValueOnce({ items: [makeRun({ status: 'CRAWLING', progress: null })], total: 1, page: 1, pageSize: 20 })
      .mockResolvedValueOnce({ items: [makeRun({ status: 'CRAWLING', progress: null })], total: 1, page: 1, pageSize: 20 })
      .mockResolvedValue({ items: [makeRun({ status: 'SUCCEEDED' })], total: 1, page: 1, pageSize: 20 });
    const { container } = renderPage();

    await screen.findAllByText(/수집 중/);
    const liveRegion = container.querySelector('[aria-live="polite"].sr-only') as HTMLElement;
    // 최초 마운트 시점에는 전환 문구를 만들지 않는다(불필요한 낭독 방지).
    expect(liveRegion.textContent).toBe('');

    const ownCall = await waitForOwnIntervalCall(setIntervalSpy);
    const callback = ownCall[0] as () => void;

    await act(async () => {
      callback();
      await Promise.resolve();
    });
    // 같은 상태(수집 중 → 수집 중)로는 여전히 낭독 문구가 비어 있다.
    expect(liveRegion.textContent).toBe('');

    await act(async () => {
      callback();
      await Promise.resolve();
    });
    expect(liveRegion.textContent).toBe('수집 중 → 성공');

    setIntervalSpy.mockRestore();
  });
});
