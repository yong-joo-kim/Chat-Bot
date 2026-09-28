import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useOutletContext } from 'react-router-dom';
import type { KbMetaResponse, KbSourceResponse } from '@chat-bot/shared-types';
import { KbSourceShell } from './KbSourceShell';
import type { KbSourceOutletContext } from './KbSourceShell';
import { ApiError } from '../../../api/client';

const mockMeta = vi.fn();
const mockFindOne = vi.fn();

vi.mock('../../../api/kbSources', () => ({
  kbSourcesApi: {
    meta: (...args: unknown[]) => mockMeta(...args),
    findOne: (...args: unknown[]) => mockFindOne(...args),
  },
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
    activeDocumentCount: 0,
    previewStale: false,
    rightsConfirmedAt: new Date('2026-09-01T00:00:00.000Z'),
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

function ChildProbe(): JSX.Element {
  const ctx = useOutletContext<KbSourceOutletContext>();
  return <p>자식 화면 — 소스명: {ctx.source.name}</p>;
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/settings/kb-crawling/s1/overview']}>
      <Routes>
        <Route path="/settings/kb-crawling/:sourceId" element={<KbSourceShell />}>
          <Route path="overview" element={<ChildProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * [No.43 R1 M4] `KbSourceShell`의 기능 꺼짐/소스 없음 판별은 메시지 문자열 비교가 아니라 호출
 * 순서(=구조)로 결정한다: `meta()`가 먼저이고, 그것이 성공한 뒤에만 `findOne()`을 부른다 —
 * `meta()`의 404는 항상 "기능 꺼짐", `meta()` 통과 후 `findOne()`의 404(`code: 'NOT_FOUND'`)는
 * 항상 "소스 없음"이다(같은 가드가 두 라우트를 함께 지키므로).
 */
describe('KbSourceShell', () => {
  beforeEach(() => {
    mockMeta.mockReset();
    mockFindOne.mockReset();
  });

  it('meta·findOne 둘 다 성공하면 탭·헤더를 렌더하고 자식 라우트에 outlet context를 넘긴다', async () => {
    mockMeta.mockResolvedValue(makeMeta());
    mockFindOne.mockResolvedValue(makeSource());
    renderShell();

    expect(await screen.findByRole('heading', { name: '인사규정 게시판' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '개요' })).toBeInTheDocument();
    expect(await screen.findByText('자식 화면 — 소스명: 인사규정 게시판')).toBeInTheDocument();
  });

  it('meta()가 404면(기능 꺼짐) findOne을 호출하지 않고 기능 꺼짐 화면을 보여준다', async () => {
    mockMeta.mockRejectedValue(new ApiError(404, '지식베이스 동기화 기능이 꺼져 있습니다.', 'NOT_FOUND'));
    renderShell();

    expect(await screen.findByText('지식베이스 동기화 기능을 사용할 수 없습니다')).toBeInTheDocument();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it('meta()는 성공하고 findOne()이 404(code: NOT_FOUND)면 "소스 없음"으로 판별한다(메시지 비교 아님)', async () => {
    mockMeta.mockResolvedValue(makeMeta());
    // 메시지 문자열은 일부러 다르게 줘도(예: 서버 문구가 바뀌어도) code만으로 판별되어야 한다.
    mockFindOne.mockRejectedValue(new ApiError(404, '메시지가 달라도 code만 본다.', 'NOT_FOUND'));
    renderShell();

    expect(await screen.findByText('요청하신 지식베이스 소스를 찾을 수 없습니다.')).toBeInTheDocument();
    // "소스 없음"은 재시도로 해결되지 않는 상태라 다시 시도 버튼이 없다.
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument();
  });

  it('findOne()이 404가 아닌 오류(예: 500)면 일반 오류 상태(다시 시도 가능)로 처리한다', async () => {
    mockMeta.mockResolvedValue(makeMeta());
    mockFindOne.mockRejectedValue(new ApiError(500, '서버 오류', 'INTERNAL_ERROR' as never));
    renderShell();

    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument();
  });

  it('meta()가 404가 아닌 오류면 일반 오류 상태로 처리하고 findOne을 호출하지 않는다', async () => {
    mockMeta.mockRejectedValue(new ApiError(500, '서버 오류', 'INTERNAL_ERROR' as never));
    renderShell();

    expect(await screen.findByRole('button', { name: '다시 시도' })).toBeInTheDocument();
    expect(mockFindOne).not.toHaveBeenCalled();
  });
});
