import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GovernanceMapResponse } from '@chat-bot/shared-types';
import { DataGovernanceMapPage } from './DataGovernanceMapPage';

const mockMap = vi.fn();

vi.mock('../../../api/governance', () => ({
  governanceApi: { map: (...args: unknown[]) => mockMap(...args) },
}));

function makeMapResponse(overrides: Partial<GovernanceMapResponse> = {}): GovernanceMapResponse {
  return {
    mode: 'OFF',
    generatedAt: new Date('2026-09-27T00:00:00.000Z'),
    storage: {
      kind: 'SQLITE_FILE',
      location: '/secure/chatbot/prod.db',
      residency: 'ALLOWED',
      allowedDirs: ['/secure/chatbot'],
      allowedDbHosts: [],
      atRestEncryptionDeclared: true,
    },
    egress: {
      allowedHosts: ['ml-worker.internal'],
      exits: [{ exitId: 'EMBEDDING', configured: true, host: 'ml-worker.internal', dataKind: 'QUERY_RAW', masked: 'NO', decision: 'ALLOWED' }],
      legacyConnections: [],
    },
    encryption: { enabled: false, writeKeyId: null, keyIds: [], fields: [], statsComputedAt: null, passInProgress: false },
    retention: {
      global: [{ kind: 'CONVERSATION_TEXT', days: 180, source: 'GLOBAL' }],
      chatbotOverrideCount: 0,
      nextWindowStartAt: null,
      jobEnabled: true,
      lastRuns: [],
      bounds: { minConversationDays: 7, minAuditDays: 365, maxDays: 3650, shortenGraceDays: 7 },
    },
    auditChain: { method: 'HMAC', signingKeyId: 'k1', head: null, lastVerification: null },
    risks: { v1PlainHeaderNodes: 0, v1PlainHeaderSnapshots: 0, snapshotScanAt: null, rawPersonalDataConnections: 0, externalLlmAugmentation: false, piiMaskMode: 'PARTIAL' },
    ...overrides,
  } as GovernanceMapResponse;
}

/** KB11 — 데이터 지도: 지식베이스 동기화 절(kb-crawling-ui-spec.md §3.8). */
describe('DataGovernanceMapPage — 지식베이스 동기화 절(No.43)', () => {
  beforeEach(() => {
    mockMap.mockReset();
  });

  it('소스가 있으면 "지식베이스 동기화" 절이 소스별 호스트·판정·마스킹·전송 전제를 보여준다', async () => {
    mockMap.mockResolvedValue(
      makeMapResponse({
        kbSources: [
          {
            sourceId: 's1',
            name: '인사규정 게시판',
            hosts: ['intra.example.local'],
            enabled: true,
            decision: 'ALLOWED',
            piiMask: true,
            allowRawFileIngest: false,
            ingestDataKind: 'DOCUMENT_BODY',
            scopeCompany: '예시공사',
            ingestAck: 'INTERNAL_NETWORK',
          },
        ],
      }),
    );
    render(<DataGovernanceMapPage />);

    await screen.findByText('지식베이스 동기화');
    expect(screen.getAllByText('인사규정 게시판').length).toBeGreaterThan(0);
    expect(screen.getAllByText('intra.example.local').length).toBeGreaterThan(0);
    expect(screen.getAllByText('내부망(운영자 확인)').length).toBeGreaterThan(0);
  });

  it('선택 키(kbSources) 자체가 없으면(하위 호환 — 소스 0개 설치) 절이 렌더되지 않는다', async () => {
    const base = makeMapResponse();
    // `kbSources` 필드를 아예 응답에 포함하지 않는다(구버전 서버·소스 0개 설치와 동일한 형태).
    mockMap.mockResolvedValue(base);
    render(<DataGovernanceMapPage />);

    await screen.findAllByText('임베딩');
    expect(screen.queryByText('지식베이스 동기화')).not.toBeInTheDocument();
  });

  it('kbSources가 빈 배열이어도 절이 렌더되지 않는다', async () => {
    mockMap.mockResolvedValue(makeMapResponse({ kbSources: [] }));
    render(<DataGovernanceMapPage />);

    await screen.findAllByText('임베딩');
    expect(screen.queryByText('지식베이스 동기화')).not.toBeInTheDocument();
  });

  it('전송 전제 미확인(ingestAck=null) 소스는 "전송 전제 미확인"으로 표시된다', async () => {
    mockMap.mockResolvedValue(
      makeMapResponse({
        kbSources: [
          {
            sourceId: 's2',
            name: '공지사항',
            hosts: [],
            enabled: true,
            decision: 'ALLOWED',
            piiMask: true,
            allowRawFileIngest: false,
            ingestDataKind: 'DOCUMENT_BODY',
            scopeCompany: '예시공사',
            ingestAck: null,
          },
        ],
      }),
    );
    render(<DataGovernanceMapPage />);

    await screen.findByText('지식베이스 동기화');
    expect(screen.getAllByText('전송 전제 미확인').length).toBeGreaterThan(0);
    expect(screen.getAllByText('(호스트 없음)').length).toBeGreaterThan(0);
  });
});
