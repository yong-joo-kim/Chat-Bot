import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { KbMetaResponse, KbSourceListItem } from '@chat-bot/shared-types';
import { ToastProvider } from '../../../components/Toast';
import { KbSourcesPage } from './KbSourcesPage';

const mockMeta = vi.fn();
const mockList = vi.fn();

vi.mock('../../../api/kbSources', () => ({
  kbSourcesApi: {
    meta: (...args: unknown[]) => mockMeta(...args),
    list: (...args: unknown[]) => mockList(...args),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    createRun: vi.fn(),
  },
}));

let canWrite = true;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'security:write' ? canWrite : true) }),
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

function makeItem(overrides: Partial<KbSourceListItem> = {}): KbSourceListItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: '인사규정 게시판',
    allowedHosts: ['intra.example.local'],
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
    configVersion: 1,
    ingestApproved: true,
    needsPreview: false,
    reviewRequiredReason: null,
    activeRun: null,
    lastRun: { id: 'r1', status: 'SUCCEEDED', finishedAt: new Date('2026-09-27T00:00:00.000Z') },
    nextRunAt: new Date('2026-09-28T03:00:00.000Z'),
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

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <KbSourcesPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** KB2 — 소스 목록(kb-crawling-ui-spec.md §3.1). */
describe('KbSourcesPage', () => {
  beforeEach(() => {
    mockMeta.mockReset();
    mockList.mockReset();
    canWrite = true;
  });

  it('meta·목록 조회에 성공하면 소스 행과 배지를 렌더한다', async () => {
    mockMeta.mockResolvedValue(makeMeta());
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 50 });
    renderPage();

    // 640px 이하 카드형 반응형 대응으로 데스크톱 표·모바일 카드 둘 다 렌더되어(jsdom은 미디어 쿼리를
    // 적용하지 않음) 이름·적재 위치가 각 2건씩 나타난다(DataGovernanceMapPage 선례와 같은 검증 방식).
    expect((await screen.findAllByText('인사규정 게시판')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('예시공사 / 인사 / 크롤_인사규정').length).toBeGreaterThan(0);
    // "사용 중"은 필터 체크박스 라벨과 배지 둘 다에 나타난다(≥ 1건이면 배지가 렌더된 것으로 본다).
    expect(screen.getAllByText('사용 중').length).toBeGreaterThan(0);
  });

  it('소스 0건이면 빈 상태 안내를 보여준다', async () => {
    mockMeta.mockResolvedValue(makeMeta());
    mockList.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 });
    renderPage();

    expect(await screen.findByText('등록된 지식베이스 소스가 없습니다.')).toBeInTheDocument();
  });

  /** [No.43 R1 M3] 검색·필터 결과 0건은 "소스 없음"과 다른 문구를 쓴다(§3.1). */
  it('검색 결과가 0건이면 "소스 없음"과 다른 문구(검색 결과가 없습니다)를 보여준다', async () => {
    const user = userEvent.setup();
    mockMeta.mockResolvedValue(makeMeta());
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 50 });
    renderPage();

    await screen.findAllByText('인사규정 게시판');
    await user.type(screen.getByLabelText('검색'), '없는이름');

    expect(await screen.findByText('검색 결과가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText('등록된 지식베이스 소스가 없습니다.')).not.toBeInTheDocument();
  });

  it('meta가 404면(KB_SYNC_ENABLED=false) 기능 꺼짐 상태를 보여주고 목록을 조회하지 않는다', async () => {
    const { ApiError } = await import('../../../api/client');
    mockMeta.mockRejectedValue(new ApiError(404, '지식베이스 동기화 기능이 꺼져 있습니다.', 'NOT_FOUND'));
    renderPage();

    expect(await screen.findByText('지식베이스 동기화 기능을 사용할 수 없습니다')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '설정 메인으로' })).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('security:write가 없으면(VIEWER 등) "+ 소스 추가" 버튼이 보이지 않는다(읽기 전용)', async () => {
    canWrite = false;
    mockMeta.mockResolvedValue(makeMeta());
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 50 });
    renderPage();

    await screen.findAllByText('인사규정 게시판');
    expect(screen.queryByRole('button', { name: '+ 소스 추가' })).not.toBeInTheDocument();
  });

  it('전송 전제 미확인(ingestAck=null)이면 상시 배너를 보여준다', async () => {
    mockMeta.mockResolvedValue(makeMeta({ ingestAck: null }));
    mockList.mockResolvedValue({ items: [makeItem()], total: 1, page: 1, pageSize: 50 });
    renderPage();

    expect(await screen.findByText(/서버 운영자가 외부 RAG 전송 전제를 아직 확인하지 않았습니다/)).toBeInTheDocument();
  });

  it('"정리 필요" 배지는 문서 목록 탭 "정리 필요만" 필터로 가는 딥링크다(§13.1 사용자 결정 2)', async () => {
    mockMeta.mockResolvedValue(makeMeta());
    mockList.mockResolvedValue({
      items: [makeItem({ needsCleanupCount: 1 })],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    renderPage();

    const links = await screen.findAllByRole('link', { name: /인사규정 게시판.*정리 필요 1건/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute('href', `/settings/kb-crawling/${makeItem().id}/documents?cleanupOnly=true`);
    }
  });

  it('실행 중인 소스(activeRun 있음)는 케밥 메뉴에서 삭제 항목이 비활성화된다', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    mockMeta.mockResolvedValue(makeMeta());
    mockList.mockResolvedValue({
      items: [
        makeItem({
          activeRun: {
            id: 'run-1',
            sourceId: '11111111-1111-4111-8111-111111111111',
            sourceName: '인사규정 게시판',
            kind: 'SYNC',
            trigger: 'SCHEDULED',
            status: 'CRAWLING',
            crawl: { discovered: 0, visited: 0, unchanged: 0, added: 0, changed: 0, missing: 0, gone: 0, needsCleanup: 0, piiMasked: 0, excluded: {}, outOfScopeLinks: 0 },
            ingest: null,
            progress: null,
            etaSeconds: null,
            waitingReason: null,
            maxPagesReached: false,
            demotedReason: null,
            failureCode: null,
            resumedCount: 0,
            startedAt: new Date(),
            crawlFinishedAt: null,
            finishedAt: null,
            createdAt: new Date(),
          },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    renderPage();

    await screen.findAllByText('인사규정 게시판');
    await user.click(screen.getAllByRole('button', { name: /관리/ })[0]);
    expect(screen.getByRole('menuitem', { name: '삭제' })).toBeDisabled();
  });

  /**
   * [No.43 pass 10 후속] 거버넌스 규칙 위반 소스는 서버가 실행을 409로 거부하므로, 클라이언트가 같은 규칙을
   * 확실히 계산할 수 있을 때만 "지금 실행"을 미리 비활성으로 하고 보이는 사유 텍스트를 aria-describedby로 잇는다.
   */
  describe('거버넌스 위반 시 "지금 실행" 사전 비활성', () => {
    async function openRunNowItem(meta: KbMetaResponse, item: KbSourceListItem) {
      const user = userEvent.setup();
      mockMeta.mockResolvedValue(meta);
      mockList.mockResolvedValue({ items: [item], total: 1, page: 1, pageSize: 50 });
      renderPage();
      await screen.findAllByText('인사규정 게시판');
      await user.click(screen.getAllByRole('button', { name: /관리/ })[0]);
      return screen.getByRole('menuitem', { name: '지금 실행' });
    }

    it('거버넌스 ON + 마스킹 끔이면 비활성이고 보이는 사유 텍스트가 aria-describedby로 연결된다', async () => {
      const menuItem = await openRunNowItem(makeMeta({ governanceMode: 'ON' }), makeItem({ piiMask: false }));

      expect(menuItem).toBeDisabled();
      const describedBy = menuItem.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const reason = document.getElementById(describedBy as string);
      expect(reason).not.toBeNull();
      expect(reason).toHaveTextContent('거버넌스 모드에서는 개인정보 마스킹을 끌 수 없습니다. 소스를 수정해 마스킹을 켜 주세요.');
      expect(screen.getAllByText(/개인정보 마스킹을 끌 수 없습니다/).length).toBeGreaterThan(0);
    });

    it('거버넌스 ON + 원본 파일 전달 켬 + 서버 허용 없음이면 원본 파일 사유로 비활성이다', async () => {
      const menuItem = await openRunNowItem(
        makeMeta({ governanceMode: 'ON', rawFileIngestAllowedByServer: false }),
        makeItem({ allowRawFileIngest: true }),
      );

      expect(menuItem).toBeDisabled();
      expect(document.getElementById(menuItem.getAttribute('aria-describedby') as string)).toHaveTextContent('원본 파일 전달을 꺼 주세요');
    });

    it('거버넌스 OFF이면 마스킹 끔 소스도 기존대로 활성이고 사유가 없다', async () => {
      const menuItem = await openRunNowItem(makeMeta({ governanceMode: 'OFF' }), makeItem({ piiMask: false }));

      expect(menuItem).not.toBeDisabled();
      expect(menuItem).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(/개인정보 마스킹을 끌 수 없습니다/)).not.toBeInTheDocument();
    });

    it('서버가 원본 파일 전달을 허용하면(rawFileIngestAllowedByServer=true) 활성이다', async () => {
      const menuItem = await openRunNowItem(
        makeMeta({ governanceMode: 'ON', rawFileIngestAllowedByServer: true }),
        makeItem({ allowRawFileIngest: true }),
      );

      expect(menuItem).not.toBeDisabled();
    });

    it('메타가 서버 허용 여부를 알려 주지 않으면(모름) 활성을 유지한다(서버 409 폴백)', async () => {
      const menuItem = await openRunNowItem(
        makeMeta({ governanceMode: 'ON', rawFileIngestAllowedByServer: undefined as never }),
        makeItem({ allowRawFileIngest: true }),
      );

      expect(menuItem).not.toBeDisabled();
      expect(menuItem).not.toHaveAttribute('aria-describedby');
    });
  });
});
