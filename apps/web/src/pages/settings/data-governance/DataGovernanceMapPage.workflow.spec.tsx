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
        { exitId: 'EMBEDDING', configured: true, host: 'ml-worker.internal', dataKind: 'QUERY_RAW', masked: 'NO', decision: 'ALLOWED' },
        {
          exitId: 'WORKFLOW_WEBHOOK',
          configured: true,
          host: null,
          dataKind: 'WORKFLOW_PAYLOAD',
          masked: 'PER_CONNECTION',
          decision: 'ALLOWED',
        },
      ],
      legacyConnections: [],
      workflowTargets: [
        { targetId: 't1', name: '그룹웨어결재', host: 'flow.corp.internal', enabled: true, paused: false, decision: 'ALLOWED', allowRawPersonalData: false, failedLast24h: 0, payloadRetained: 0 },
        { targetId: 't2', name: '품질티켓봇', host: 'ticket.corp.internal', enabled: true, paused: false, decision: 'ALLOWED', allowRawPersonalData: true, failedLast24h: 3, payloadRetained: 1 },
      ],
    },
    encryption: {
      enabled: true,
      writeKeyId: 'k2',
      keyIds: ['k1', 'k2'],
      fields: [{ field: 'WORKFLOW_PAYLOAD', plaintextRows: 0, byKey: { k2: 100 }, unknownKeyRows: 0 }],
      statsComputedAt: new Date('2026-09-26T00:00:00.000Z'),
      passInProgress: false,
    },
    retention: {
      global: [{ kind: 'CONVERSATION_TEXT', days: 180, source: 'GLOBAL' }],
      chatbotOverrideCount: 0,
      nextWindowStartAt: null,
      jobEnabled: true,
      lastRuns: [],
      bounds: { minConversationDays: 7, minAuditDays: 365, maxDays: 3650, shortenGraceDays: 7 },
    },
    auditChain: { method: 'HMAC', signingKeyId: 'k1', head: null, lastVerification: null },
    risks: {
      v1PlainHeaderNodes: 0,
      v1PlainHeaderSnapshots: 0,
      snapshotScanAt: null,
      rawPersonalDataConnections: 0,
      rawPersonalDataWorkflowTargets: 1,
      externalLlmAugmentation: false,
      piiMaskMode: 'PARTIAL',
    },
    ...overrides,
  } as GovernanceMapResponse;
}

/** WF8 — 데이터 지도 출구 6번째 클래스(`WORKFLOW_WEBHOOK`, workflow-automation-ui-spec.md §3.10). */
describe('DataGovernanceMapPage — 업무 자동화 웹훅(WF8)', () => {
  beforeEach(() => {
    mockMap.mockReset();
  });

  it('출구 표에 "업무 자동화 웹훅" 행(6번째 클래스)이 렌더된다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);

    await screen.findAllByText('업무 자동화 웹훅');
  });

  it('대상별 하위 목록이 레거시 연결과 같은 펼침 방식으로 렌더된다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);

    await screen.findByText('대상 2개 — 아래 상세');
    expect(screen.getAllByText('그룹웨어결재').length).toBeGreaterThan(0);
    expect(screen.getAllByText('품질티켓봇').length).toBeGreaterThan(0);
  });

  it('원문 개인정보 전송 허용 업무 자동화 대상 잔존위험 줄을 보여준다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);

    await screen.findByText(/원문 개인정보 전송 허용 업무 자동화 대상: 1개/);
  });

  it('마스킹 열은 서버가 무엇을 보내든 "대상별"(PER_TARGET)로 고정 표시한다(No.41 2차)', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);

    await screen.findAllByText('업무 자동화 웹훅');
    expect(screen.getAllByText('대상별').length).toBeGreaterThan(0);
    expect(screen.queryByText('연결별')).not.toBeInTheDocument();
  });

  it('대상이 0개면(선택 키 부재) 업무 자동화 웹훅 하위 목록이 렌더되지 않는다', async () => {
    const base = makeMapResponse();
    mockMap.mockResolvedValue({ ...base, egress: { ...base.egress, workflowTargets: undefined } });
    render(<DataGovernanceMapPage />);

    await screen.findAllByText('임베딩');
    expect(screen.queryByText('대상 2개 — 아래 상세')).not.toBeInTheDocument();
  });
});
