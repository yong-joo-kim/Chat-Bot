import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import type { KbMetaResponse, KbRunView, KbSourceResponse } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { ApiError } from '../../../api/client';
import { KbSourceOverviewPage } from './KbSourceOverviewPage';
import type { KbSourceOutletContext } from './KbSourceShell';

const mockListRuns = vi.fn();
const mockApproveIngest = vi.fn();
const mockCreateRun = vi.fn();

vi.mock('../../../api/kbSources', () => ({
  kbSourcesApi: {
    listRuns: (...args: unknown[]) => mockListRuns(...args),
    approveIngest: (...args: unknown[]) => mockApproveIngest(...args),
    createRun: (...args: unknown[]) => mockCreateRun(...args),
    cancelRun: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));

function makeMeta(overrides: Partial<KbMetaResponse> = {}): KbMetaResponse {
  return {
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
    ...overrides,
  };
}

function makeSource(overrides: Partial<KbSourceResponse> = {}): KbSourceResponse {
  return {
    id: 's1',
    name: '인사규정 게시판',
    seedUrls: ['https://intra.example.local/hr/'],
    sitemapUrls: [],
    allowedHosts: ['intra.example.local'],
    pathPrefixes: [],
    excludePatterns: [],
    noisePatterns: [],
    allowQueryUrls: false,
    maxDepth: 3,
    maxPages: 500,
    fileTypes: ['PDF'],
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
    configVersion: 2,
    ingestApproved: false,
    needsPreview: true,
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

function makePreviewRun(overrides: Partial<KbRunView> = {}): KbRunView {
  return {
    id: 'run-preview-1',
    sourceId: 's1',
    sourceName: '인사규정 게시판',
    kind: 'PREVIEW',
    trigger: 'MANUAL',
    status: 'SUCCEEDED',
    crawl: { discovered: 53, visited: 53, unchanged: 259, added: 41, changed: 12, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 9, excluded: {}, outOfScopeLinks: 0 },
    ingest: null,
    progress: null,
    etaSeconds: null,
    waitingReason: null,
    maxPagesReached: false,
    demotedReason: null,
    failureCode: null,
    resumedCount: 0,
    startedAt: new Date('2026-09-27T00:00:00.000Z'),
    crawlFinishedAt: new Date('2026-09-27T00:08:00.000Z'),
    finishedAt: new Date('2026-09-27T00:08:00.000Z'),
    createdAt: new Date('2026-09-27T00:00:00.000Z'),
    ...overrides,
  };
}

function OutletWrapper({ ctx }: { ctx: KbSourceOutletContext }): JSX.Element {
  return <Outlet context={ctx} />;
}

function renderWithContext(source: KbSourceResponse, meta: KbMetaResponse, reloadSource = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/settings/kb-crawling/s1/overview']}>
      <ToastProvider>
        <Routes>
          <Route path="/settings/kb-crawling/:sourceId" element={<OutletWrapper ctx={{ source, meta, reloadSource }} />}>
            <Route path="overview" element={<KbSourceOverviewPage />} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** KB3 — 소스 상세: 개요·미리보기(kb-crawling-ui-spec.md §3.3). "적재 시작" 비활성 사유(§3.3.1)가 핵심. */
describe('KbSourceOverviewPage', () => {
  beforeEach(() => {
    mockListRuns.mockReset();
    mockApproveIngest.mockReset();
    mockCreateRun.mockReset();
  });

  it('전송 전제 미확인(ingestAck=null)이면 적재 시작 버튼이 비활성화되고 사유가 보인다', async () => {
    mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
    renderWithContext(makeSource(), makeMeta({ ingestAck: null }));

    await screen.findByText(/새로 41/);
    const approveButton = screen.getByRole('button', { name: '적재 시작' });
    expect(approveButton).toBeDisabled();
    expect(screen.getByText('서버 운영자가 외부 RAG 전송 전제(내부망/인증/TLS)를 아직 확인하지 않았습니다.')).toBeInTheDocument();
  });

  it('외부 RAG 미설정(ragConfigured=false)이면 적재 시작 버튼이 비활성화된다', async () => {
    mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
    renderWithContext(makeSource(), makeMeta({ ragConfigured: false }));

    await screen.findByText(/새로 41/);
    expect(screen.getByRole('button', { name: '적재 시작' })).toBeDisabled();
    expect(screen.getByText('외부 RAG 서버가 설정되어 있지 않습니다.')).toBeInTheDocument();
  });

  /** [No.43 R1 M1] 서버가 미리 계산한 `previewStale`을 그대로 써서 승인 요청·거절 왕복 없이
   * 미리 비활성으로 보여준다(§3.3.1). */
  it('previewStale=true면 적재 시작 버튼이 미리 비활성화되고 PREVIEW_STALE 사유가 보인다', async () => {
    mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
    renderWithContext(makeSource({ previewStale: true }), makeMeta());

    await screen.findByText(/새로 41/);
    const approveButton = screen.getByRole('button', { name: '적재 시작' });
    expect(approveButton).toBeDisabled();
    expect(screen.getByText('설정이 바뀌어 이전 미리보기가 유효하지 않습니다. 다시 미리보기를 실행하세요.')).toBeInTheDocument();
    expect(mockApproveIngest).not.toHaveBeenCalled();
  });

  it('previewStale=false면(다른 게이트도 통과) 적재 시작 버튼이 활성화된다', async () => {
    mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
    renderWithContext(makeSource({ previewStale: false }), makeMeta());

    const approveButton = await screen.findByRole('button', { name: '적재 시작' });
    expect(approveButton).not.toBeDisabled();
  });

  it('성공한 미리보기 실행이 없으면 "지금 미리보기 실행" 버튼만 보이고 적재 시작 버튼은 없다', async () => {
    mockListRuns.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderWithContext(makeSource(), makeMeta());

    await screen.findByText('먼저 미리보기를 실행하세요.');
    expect(screen.getByRole('button', { name: '지금 미리보기 실행' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '적재 시작' })).not.toBeInTheDocument();
  });

  it('게이트를 모두 통과하면 적재 시작이 활성화되고, 클릭하면 확인 다이얼로그가 뜬다', async () => {
    mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
    renderWithContext(makeSource(), makeMeta());

    const approveButton = await screen.findByRole('button', { name: '적재 시작' });
    expect(approveButton).not.toBeDisabled();

    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(approveButton);

    expect(await screen.findByRole('dialog', { name: '적재를 시작할까요?' })).toBeInTheDocument();
    expect(screen.getByText(/새로 41개 · 바뀜 12개 = 총 53개/)).toBeInTheDocument();
  });

  /** [3차 보완] 서버 `etaSeconds`(> 0)가 있으면 "문서당 평균 1분" 어림값 대신 실측 기반 문구를 쓴다. */
  it('미리보기 실행에 etaSeconds가 있으면(서버 실측) 어림값 대신 그 값 기반 문구를 보여준다', async () => {
    mockListRuns.mockResolvedValue({ items: [makePreviewRun({ etaSeconds: 5400 })], total: 1, page: 1, pageSize: 20 });
    renderWithContext(makeSource(), makeMeta());

    const approveButton = await screen.findByRole('button', { name: '적재 시작' });
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(approveButton);

    expect(await screen.findByRole('dialog', { name: '적재를 시작할까요?' })).toBeInTheDocument();
    // 5400초 = 약 2시간 — "문서당 평균 약 1분" 어림값 문구는 나오지 않는다.
    expect(screen.getByText(/예상 소요 약 2시간/)).toBeInTheDocument();
    expect(screen.queryByText(/문서당 평균 약 1분/)).not.toBeInTheDocument();
  });

  /** [3차 보완] etaSeconds가 0 이하(=서버가 계산할 근거 없음, PREVIEW 실행 특성상 항상 0)면 기존
   * 클라이언트 어림값(문서당 평균 1분)으로 대체한다. */
  it('미리보기 실행의 etaSeconds가 0이면(서버 근거 없음) 기존 어림값 문구로 대체한다', async () => {
    mockListRuns.mockResolvedValue({ items: [makePreviewRun({ etaSeconds: 0 })], total: 1, page: 1, pageSize: 20 });
    renderWithContext(makeSource(), makeMeta());

    const approveButton = await screen.findByRole('button', { name: '적재 시작' });
    const user = (await import('@testing-library/user-event')).default.setup();
    await user.click(approveButton);

    expect(await screen.findByText(/문서당 평균 약 1분 → 예상 소요 약 53분/)).toBeInTheDocument();
  });

  it('진행 중인 실행(activeRun)이 있으면 진행 표시와 중지 버튼을 보여준다', async () => {
    mockListRuns.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    renderWithContext(
      makeSource({
        needsPreview: false,
        activeRun: makePreviewRun({ kind: 'SYNC', status: 'CRAWLING', crawl: { ...makePreviewRun().crawl, visited: 10 } }),
      }),
      makeMeta(),
    );

    expect(await screen.findByRole('button', { name: '중지' })).toBeInTheDocument();
  });

  /** [No.43 M-1] 거버넌스 409 — 매핑 표에 없던 코드도 원인·해결 방법을 배너(role=alert)로 보여 준다. */
  describe('적재 승인 409 오류 표시', () => {
    async function approveWith409(code: string, serverMessage: string) {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      mockApproveIngest.mockRejectedValue(new ApiError(409, serverMessage, 'KB_INGEST_NOT_ALLOWED' as never, [{ field: 'piiMask', message: code }]));
      renderWithContext(makeSource(), makeMeta());
      const user = (await import('@testing-library/user-event')).default.setup();
      await user.click(await screen.findByRole('button', { name: '적재 시작' }));
      const dialog = await screen.findByRole('dialog', { name: '적재를 시작할까요?' });
      await user.click(within(dialog).getByRole('button', { name: '적재 시작' }));
    }

    it('GOVERNANCE_MASK_REQUIRED면 마스킹을 켜라는 안내가 role=alert에 표시된다', async () => {
      await approveWith409('GOVERNANCE_MASK_REQUIRED', '서버 메시지');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다. 소스를 수정해 마스킹을 켜 주세요.');
    });

    it('GOVERNANCE_RAW_FILE_NOT_ALLOWED면 원본 파일 전달을 끄라는 안내가 role=alert에 표시된다', async () => {
      await approveWith409('GOVERNANCE_RAW_FILE_NOT_ALLOWED', '서버 메시지');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('원본 파일 전달을 꺼 주세요');
    });

    it('설정 변경 경우(서버 기본 문구 "유효한 미리보기 실행이 아닙니다.")의 PREVIEW_STALE은 종전 "설정이 바뀌어…" 문구를 그대로 보여 준다', async () => {
      await approveWith409('PREVIEW_STALE', '유효한 미리보기 실행이 아닙니다.');
      expect(await screen.findByRole('alert')).toHaveTextContent('설정이 바뀌어 이전 미리보기가 유효하지 않습니다. 다시 미리보기를 실행하세요.');
    });

    it('빈 서버 문구의 PREVIEW_STALE도 종전 문구로 채워 빈 알림이 되지 않는다', async () => {
      await approveWith409('PREVIEW_STALE', '');
      expect(await screen.findByRole('alert')).toHaveTextContent('설정이 바뀌어 이전 미리보기가 유효하지 않습니다.');
    });

    /** [RG-27] 강등 뒤 새 미리보기가 없는 경우 서버 문구(원인·해결 방법)를 "설정이 바뀌어…"로 덮어쓰지 않는다. */
    it('강등 뒤 미리보기 없음 경우의 PREVIEW_STALE은 서버 문구(원인·해결)를 role=alert에 그대로 보여 준다', async () => {
      const serverText = '내용이 크게 바뀌어 적재가 보류된 뒤에 확인한 미리보기가 아닙니다. 미리보기를 다시 실행해 결과를 확인한 뒤 승인해 주세요.';
      await approveWith409('PREVIEW_STALE', serverText);
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(serverText);
      expect(alert).not.toHaveTextContent('설정이 바뀌어');
    });

    it('알 수 없는 message 코드는 서버가 준 e.message로 폴백해 빈 알림이 되지 않는다', async () => {
      await approveWith409('SOMETHING_NEW', '서버가 준 한글 문구입니다.');
      expect(await screen.findByRole('alert')).toHaveTextContent('서버가 준 한글 문구입니다.');
    });
  });

  /** [No.43 M-2] 최근 미리보기 실행이 로그인 벽으로 강등된 경우 승인 화면에서 미리 알린다(승인 버튼은 막지 않는다). */
  describe('미리보기 강등(demotedReason) 경고', () => {
    it('latestPreviewRun.demotedReason=AUTH_WALL이면 로그인 필요 경고가 role=status로 보이고 적재 시작은 활성 상태다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun({ demotedReason: 'AUTH_WALL' })], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource(), makeMeta());

      const warning = await screen.findByText(/로그인 필요로 보임/);
      expect(warning.closest('[role="status"]')).not.toBeNull();
      expect(warning).toHaveTextContent('자동 점검 결과 확인이 필요합니다');
      expect(screen.getByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });

    it('demotedReason이 없으면 경고가 없다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource(), makeMeta());

      await screen.findByRole('button', { name: '적재 시작' });
      expect(screen.queryByText(/로그인 필요로 보임/)).not.toBeInTheDocument();
    });

    it('소스 배너가 이미 같은 사유를 보여 주면 카드에서 중복 표시하지 않는다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun({ demotedReason: 'AUTH_WALL' })], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource({ reviewRequiredReason: 'AUTH_WALL' }), makeMeta());

      await screen.findByRole('button', { name: '적재 시작' });
      expect(screen.getAllByText(/자동 점검 결과 확인이 필요합니다/)).toHaveLength(1);
    });
  });

  /** [RG-27 · pass 11 L-B] 강등 뒤에 끝난 미리보기가 없으면 서버가 409로 거절하므로 미리 비활성 + 사유를 보인다(§3.3.1). */
  describe('강등 뒤 미리보기 없음 — 적재 시작 사전 비활성', () => {
    const DEMOTION_HINT = '내용이 크게 바뀌어 적재가 보류되었습니다.';
    const oldPreview = makePreviewRun({ id: 'run-preview-old', finishedAt: new Date('2026-09-27T00:08:00.000Z'), createdAt: new Date('2026-09-27T00:00:00.000Z') });
    const demotingSync = makePreviewRun({
      id: 'run-sync-1',
      kind: 'SYNC',
      trigger: 'SCHEDULED',
      demotedReason: 'NEW_RATIO',
      finishedAt: new Date('2026-09-28T03:10:00.000Z'),
      createdAt: new Date('2026-09-28T03:00:00.000Z'),
    });

    function runsPage(items: KbRunView[], total = items.length) {
      return { items, total, page: 1, pageSize: 20 };
    }

    it('강등(SYNC) 뒤에 끝난 미리보기가 없으면 적재 시작이 비활성이고 사유가 aria-describedby로 연결되어 보인다', async () => {
      mockListRuns.mockResolvedValue(runsPage([demotingSync, oldPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: 'NEW_RATIO' }), makeMeta());

      const button = await screen.findByRole('button', { name: '적재 시작' });
      expect(button).toBeDisabled();
      const ids = (button.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
      const texts = ids.map((id) => document.getElementById(id)?.textContent ?? '');
      expect(texts.some((t) => t.includes(DEMOTION_HINT) && t.includes('미리보기를 다시 실행해'))).toBe(true);
      expect(screen.getByText(new RegExp(DEMOTION_HINT))).toBeVisible();
    });

    it('강등 뒤에 새 미리보기가 끝났으면 활성이다', async () => {
      const newPreview = makePreviewRun({ id: 'run-preview-new', finishedAt: new Date('2026-09-28T04:00:00.000Z'), createdAt: new Date('2026-09-28T03:50:00.000Z') });
      mockListRuns.mockResolvedValue(runsPage([newPreview, demotingSync, oldPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: 'NEW_RATIO' }), makeMeta());

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
      expect(screen.queryByText(new RegExp(DEMOTION_HINT))).not.toBeInTheDocument();
    });

    it('강등을 만든 실행이 그 미리보기 자신이면(NEW_RATIO 미리보기) 활성이다', async () => {
      const self = makePreviewRun({ id: 'run-preview-self', demotedReason: 'NEW_RATIO', finishedAt: new Date('2026-09-28T04:00:00.000Z') });
      mockListRuns.mockResolvedValue(runsPage([self, oldPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: 'NEW_RATIO' }), makeMeta());

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });

    it('PREVIEW의 AUTH_WALL 강등은 승인을 해제하지 않으므로(기록만) 강등 시각으로 세지 않는다 — 활성이다', async () => {
      // 최근 미리보기(생성 순)는 latest지만, 더 일찍 만들어져 더 늦게 끝난 AUTH_WALL 미리보기가 있다.
      const latest = makePreviewRun({ id: 'run-preview-latest', createdAt: new Date('2026-09-28T04:00:00.000Z'), finishedAt: new Date('2026-09-28T04:05:00.000Z') });
      const authWallPreview = makePreviewRun({ id: 'run-preview-aw', demotedReason: 'AUTH_WALL', createdAt: new Date('2026-09-28T03:00:00.000Z'), finishedAt: new Date('2026-09-28T04:30:00.000Z') });
      mockListRuns.mockResolvedValue(runsPage([latest, authWallPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: 'AUTH_WALL' }), makeMeta());

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });

    it('SYNC의 AUTH_WALL 강등 뒤에도 옛 미리보기만 있으면 비활성이다', async () => {
      const authWallSync = { ...demotingSync, demotedReason: 'AUTH_WALL' as const };
      mockListRuns.mockResolvedValue(runsPage([authWallSync, oldPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: 'AUTH_WALL' }), makeMeta());

      expect(await screen.findByRole('button', { name: '적재 시작' })).toBeDisabled();
      expect(screen.getByText(new RegExp(DEMOTION_HINT))).toBeVisible();
    });

    it('모르는 경우 — 실행 이력 창에 강등 실행이 없으면(reviewRequiredReason만 있음) 활성을 유지한다', async () => {
      mockListRuns.mockResolvedValue(runsPage([oldPreview], 45));
      renderWithContext(makeSource({ reviewRequiredReason: 'NEW_RATIO' }), makeMeta());

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });

    it('모르는 경우 — 강등 실행의 종료 시각이 없으면 활성을 유지한다', async () => {
      mockListRuns.mockResolvedValue(runsPage([{ ...demotingSync, finishedAt: null }, oldPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: 'NEW_RATIO' }), makeMeta());

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });

    it('소스에 강등 사유(reviewRequiredReason)가 없으면 옛 강등 이력이 있어도 활성이다(서버도 검사하지 않는다)', async () => {
      mockListRuns.mockResolvedValue(runsPage([demotingSync, oldPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: null }), makeMeta());

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });

    it('설정 변경(previewStale)과 함께면 설정 변경 사유가 우선한다', async () => {
      mockListRuns.mockResolvedValue(runsPage([demotingSync, oldPreview]));
      renderWithContext(makeSource({ reviewRequiredReason: 'NEW_RATIO', previewStale: true }), makeMeta());

      await screen.findByText(/새로 41/);
      expect(screen.getByText('설정이 바뀌어 이전 미리보기가 유효하지 않습니다. 다시 미리보기를 실행하세요.')).toBeInTheDocument();
      expect(screen.queryByText(new RegExp(DEMOTION_HINT))).not.toBeInTheDocument();
    });
  });

  /** [No.43 pass 10 후속] 거버넌스 규칙 위반이면 미리보기·적재 시작을 미리 비활성으로 하고 사유를 보인다. */
  describe('거버넌스 위반 시 버튼 사전 비활성', () => {
    function expectReasonLinked(button: HTMLElement, textPart: string) {
      expect(button).toBeDisabled();
      const ids = (button.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
      const texts = ids.map((id) => document.getElementById(id)?.textContent ?? '');
      expect(texts.some((t) => t.includes(textPart))).toBe(true);
    }

    it('미리보기 결과가 있을 때 마스킹 끔 소스는 적재 시작이 비활성이고 사유가 aria-describedby로 연결된다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource({ piiMask: false }), makeMeta({ governanceMode: 'ON' }));

      const button = await screen.findByRole('button', { name: '적재 시작' });
      expectReasonLinked(button, '개인정보 마스킹을 끌 수 없습니다');
      expect(screen.getByText(/개인정보 마스킹을 끌 수 없습니다/)).toBeVisible();
    });

    it('원본 파일 전달 켬 + 서버 허용 없음도 적재 시작을 막고 원본 파일 사유를 보인다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource({ allowRawFileIngest: true }), makeMeta({ governanceMode: 'ON', rawFileIngestAllowedByServer: false }));

      expectReasonLinked(await screen.findByRole('button', { name: '적재 시작' }), '원본 파일 전달을 꺼 주세요');
    });

    it('다른 비활성 사유(전송 전제 미확인)가 함께 있으면 두 사유 모두 aria-describedby에 연결된다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource({ piiMask: false }), makeMeta({ governanceMode: 'ON', ingestAck: null }));

      const button = await screen.findByRole('button', { name: '적재 시작' });
      expect((button.getAttribute('aria-describedby') ?? '').split(' ')).toHaveLength(2);
      expectReasonLinked(button, '서버 운영자가 외부 RAG 전송 전제');
    });

    it('미리보기가 아직 없을 때 "지금 미리보기 실행"도 비활성이고 사유가 연결된다(눌러도 요청하지 않는다)', async () => {
      const user = (await import('@testing-library/user-event')).default.setup();
      mockListRuns.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
      renderWithContext(makeSource({ piiMask: false }), makeMeta({ governanceMode: 'ON' }));

      const button = await screen.findByRole('button', { name: '지금 미리보기 실행' });
      expectReasonLinked(button, '개인정보 마스킹을 끌 수 없습니다');
      await user.click(button);
      expect(mockCreateRun).not.toHaveBeenCalled();
    });

    it('위반이 아니면 기존 동작 그대로 활성이고 aria-describedby가 없다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource(), makeMeta({ governanceMode: 'ON' }));

      const button = await screen.findByRole('button', { name: '적재 시작' });
      expect(button).not.toBeDisabled();
      expect(button).not.toHaveAttribute('aria-describedby');
    });

    it('거버넌스 OFF이면 마스킹 끔 소스도 활성이다', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      renderWithContext(makeSource({ piiMask: false }), makeMeta({ governanceMode: 'OFF' }));

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });

    it('메타가 서버 허용 여부를 알려 주지 않으면(모름) 활성을 유지한다(서버 409 폴백)', async () => {
      mockListRuns.mockResolvedValue({ items: [makePreviewRun()], total: 1, page: 1, pageSize: 20 });
      renderWithContext(
        makeSource({ allowRawFileIngest: true }),
        makeMeta({ governanceMode: 'ON', rawFileIngestAllowedByServer: undefined as never }),
      );

      expect(await screen.findByRole('button', { name: '적재 시작' })).not.toBeDisabled();
    });
  });
});
