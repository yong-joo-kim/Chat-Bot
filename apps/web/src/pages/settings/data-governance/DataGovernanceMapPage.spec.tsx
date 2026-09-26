import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { GovernanceMapResponse } from '@chat-bot/shared-types';
import { DataGovernanceMapPage } from './DataGovernanceMapPage';

expect.extend(toHaveNoViolations);

const mockMap = vi.fn();

vi.mock('../../../api/governance', () => ({
  governanceApi: { map: (...args: unknown[]) => mockMap(...args) },
}));

function makeMapResponse(overrides: Partial<GovernanceMapResponse> = {}): GovernanceMapResponse {
  return {
    mode: 'ON',
    generatedAt: new Date('2026-09-26T00:00:00.000Z'),
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
      exits: [
        {
          exitId: 'EMBEDDING',
          configured: true,
          host: 'ml-worker.internal',
          dataKind: 'QUERY_RAW',
          masked: 'NO',
          decision: 'ALLOWED',
          rawTextOffHost: true,
        },
        {
          exitId: 'RAG',
          configured: false,
          host: null,
          dataKind: 'QUESTION_MASKED',
          masked: 'YES',
          decision: 'NOT_CONFIGURED',
        },
      ],
      legacyConnections: [
        { connectionId: 'c1', name: '파트너 조회 API', host: 'api.partner.com', enabled: true, decision: 'BLOCKED', allowRawPersonalData: false, blockedLast24h: 3 },
      ],
    },
    encryption: {
      enabled: true,
      writeKeyId: 'k2',
      keyIds: ['k1', 'k2'],
      fields: [{ field: 'HANDOFF_TEXT', plaintextRows: 0, byKey: { k2: 812004 }, unknownKeyRows: 0 }],
      statsComputedAt: new Date('2026-09-26T00:00:00.000Z'),
      passInProgress: false,
    },
    retention: {
      global: [{ kind: 'CONVERSATION_TEXT', days: 180, source: 'GLOBAL' }],
      chatbotOverrideCount: 2,
      nextWindowStartAt: new Date('2026-09-27T02:00:00.000Z'),
      jobEnabled: true,
      lastRuns: [],
      bounds: { minConversationDays: 7, minAuditDays: 365, maxDays: 3650, shortenGraceDays: 7 },
    },
    auditChain: {
      method: 'HMAC',
      signingKeyId: 'k1',
      head: { seq: 1882410, hash: '9f3a7c000000000000000000000000' },
      lastVerification: { at: new Date('2026-09-26T02:10:00.000Z'), status: 'OK', checkedRows: 412003 },
    },
    risks: {
      v1PlainHeaderNodes: 2,
      v1PlainHeaderSnapshots: 3,
      snapshotScanAt: new Date('2026-09-20T00:00:00.000Z'),
      rawPersonalDataConnections: 1,
      externalLlmAugmentation: false,
      piiMaskMode: 'PARTIAL',
    },
    ...overrides,
  };
}

/** G1 — 데이터 지도(data-governance-ui-spec.md §3.1). */
describe('DataGovernanceMapPage', () => {
  beforeEach(() => {
    mockMap.mockReset();
  });

  it('조회 성공 시 출구·암호화·보존·잔존위험 카드를 렌더한다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);

    await screen.findAllByText('ml-worker.internal');
    expect(screen.getAllByText('허용').length).toBeGreaterThan(0);
    expect(screen.getAllByText('차단').length).toBeGreaterThan(0);
    expect(screen.getByText(/평문 잔존: 0행/)).toBeInTheDocument();
    expect(screen.getByText(/재정의 챗봇 2곳/)).toBeInTheDocument();
    expect(screen.getByText(/v1 노드 평문 토큰: 2개 노드/)).toBeInTheDocument();
  });

  it('모드 OFF면 상단에 거버넌스 모드 꺼짐 배너를 표시한다', async () => {
    mockMap.mockResolvedValue(makeMapResponse({ mode: 'OFF' }));
    render(<DataGovernanceMapPage />);

    await screen.findByText(/거버넌스 모드 꺼짐/);
  });

  it('필드 암호화 fields가 빈 배열이어도(백엔드 채우는 중) 오류 없이 렌더한다', async () => {
    mockMap.mockResolvedValue(makeMapResponse({ encryption: { enabled: false, writeKeyId: null, keyIds: [], fields: [], statsComputedAt: null, passInProgress: false } }));
    render(<DataGovernanceMapPage />);

    await screen.findByText('필드 암호화');
    expect(screen.queryByText(/평문 잔존/)).not.toBeInTheDocument();
  });

  /** [신규 No.45 2차] `encryption.fields[].byKey`/`unknownKeyRows`/`statsComputedAt`(§4). */
  it('필드별 키별 행 수·통계 산출 시각을 보여주고, unknownKeyRows가 0보다 크면 경고를 표시한다', async () => {
    mockMap.mockResolvedValue(
      makeMapResponse({
        encryption: {
          enabled: true,
          writeKeyId: 'k2',
          keyIds: ['k1', 'k2'],
          fields: [
            { field: 'HANDOFF_TEXT', plaintextRows: 0, byKey: { k2: 812004, k1: 3201 }, unknownKeyRows: 7 },
            { field: 'HANDOFF_RAW_TEXT', plaintextRows: 0, byKey: { k2: 100 }, unknownKeyRows: 0 },
          ],
          statsComputedAt: new Date('2026-09-26T01:00:00.000Z'),
          passInProgress: false,
        },
      }),
    );
    render(<DataGovernanceMapPage />);

    await screen.findByText('필드 암호화');
    expect(screen.getByText(/키별 행 수: k2 812,004행 · k1 3,201행/)).toBeInTheDocument();
    expect(screen.getByText(/알 수 없는 키로 암호화된 행 7행/)).toBeInTheDocument();
    // 두 번째 필드(unknownKeyRows=0)는 경고가 뜨지 않는다 — 경고 문구가 정확히 1건만 있어야 한다.
    expect(screen.getAllByText(/알 수 없는 키로 암호화된 행/)).toHaveLength(1);
    expect(screen.getByText(/통계 산출 시각:/)).toBeInTheDocument();
  });

  it('조회 실패 시 오류 상태와 재시도 버튼을 보여주고, 재시도하면 다시 조회한다', async () => {
    const user = userEvent.setup();
    mockMap.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(makeMapResponse());
    render(<DataGovernanceMapPage />);

    await screen.findByText('데이터 지도를 불러오지 못했습니다.');
    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    await screen.findAllByText('ml-worker.internal');
    expect(mockMap).toHaveBeenCalledTimes(2);
  });

  /** [코드 리뷰 R1 M-2] axe 접근성 스캔. */
  it('데이터 지도 화면에 구조적 접근성 위반이 없다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    const { container } = render(<DataGovernanceMapPage />);
    await screen.findAllByText('ml-worker.internal');

    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results).toHaveNoViolations();
  });
});
