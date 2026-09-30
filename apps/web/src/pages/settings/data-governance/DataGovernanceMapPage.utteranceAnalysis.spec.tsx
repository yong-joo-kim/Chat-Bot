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
    generatedAt: new Date('2026-09-30T00:00:00.000Z'),
    storage: { kind: 'SQLITE_FILE', location: '/secure/chatbot/prod.db', residency: 'ALLOWED', allowedDirs: ['/secure/chatbot'], allowedDbHosts: [], atRestEncryptionDeclared: true },
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

/** UA-4 — 데이터 지도: 업로드 발화 분석 절(deep-clustering-ui-spec.md §6.1). */
describe('DataGovernanceMapPage — 업로드 발화 분석 절(No.21)', () => {
  beforeEach(() => mockMap.mockReset());

  it('선택 키(utteranceAnalysis)가 있으면 절이 보이고 저장 범위·보존을 알린다', async () => {
    mockMap.mockResolvedValue(
      makeMapResponse({
        utteranceAnalysis: { analyses: 2, utterances: 5000, retentionDays: 90, storesMaskedOnly: true, originalFileStored: false, exits: ['EMBEDDING'], nameSuggestEnabled: false, retentionJobEnabled: true },
      }),
    );
    render(<DataGovernanceMapPage />);

    expect(await screen.findByRole('heading', { name: '업로드 발화 분석' })).toBeInTheDocument();
    expect(screen.getByText('가려진 문장만 저장합니다. 올린 원본 파일은 저장하지 않습니다.')).toBeInTheDocument();
    expect(screen.getByText('분석 2건 · 발화 5000개')).toBeInTheDocument();
  });

  it('키가 없으면(분석 0건 = 바이트 동일) 절을 그리지 않는다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);

    await screen.findAllByText('임베딩');
    expect(screen.queryByRole('heading', { name: '업로드 발화 분석' })).not.toBeInTheDocument();
  });
});
