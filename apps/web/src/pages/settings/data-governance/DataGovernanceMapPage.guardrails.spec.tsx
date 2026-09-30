import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GovernanceMapResponse } from '@chat-bot/shared-types';
import { DataGovernanceMapPage } from './DataGovernanceMapPage';

const mockMap = vi.fn();
vi.mock('../../../api/governance', () => ({ governanceApi: { map: (...args: unknown[]) => mockMap(...args) } }));

function makeMapResponse(overrides: Partial<GovernanceMapResponse> = {}): GovernanceMapResponse {
  return {
    mode: 'OFF',
    generatedAt: new Date('2026-09-30T00:00:00.000Z'),
    storage: { kind: 'SQLITE_FILE', location: '/secure/chatbot/prod.db', residency: 'ALLOWED', allowedDirs: ['/secure/chatbot'], allowedDbHosts: [], atRestEncryptionDeclared: true },
    egress: { allowedHosts: ['ml-worker.internal'], exits: [{ exitId: 'EMBEDDING', configured: true, host: 'ml-worker.internal', dataKind: 'QUERY_RAW', masked: 'NO', decision: 'ALLOWED' }], legacyConnections: [] },
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

/** DM-1 — 데이터 지도 "위험 응답 규칙·개인정보 가림·운영 전환 2인 승인" 절(ai-guardrails-ui-spec.md §10.2). */
describe('DataGovernanceMapPage — 위험 응답 규칙 절(No.36)', () => {
  beforeEach(() => mockMap.mockReset());

  it('선택 키(guardrails)가 있으면 절을 그린다', async () => {
    mockMap.mockResolvedValue(
      makeMapResponse({
        guardrails: {
          chatbotsWithRules: 1,
          rules: 3,
          enabledRules: 2,
          events: 40,
          eventsStoreText: false,
          exits: [],
          piiExitDefaultKinds: ['RRN', 'CARD'],
          piiExitCustomizedChatbots: 0,
          approvalPolicyChatbots: 1,
          serverEnabled: true,
        },
      }),
    );
    render(<DataGovernanceMapPage />);
    expect(await screen.findByRole('heading', { name: '위험 응답 규칙·개인정보 가림·운영 전환 2인 승인' })).toBeInTheDocument();
    expect(screen.getByText('서버 스위치: 켜짐')).toBeInTheDocument();
  });

  it('키가 없으면(0건 = 바이트 동일) 절을 그리지 않는다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);
    await screen.findAllByText('임베딩');
    expect(screen.queryByRole('heading', { name: '위험 응답 규칙·개인정보 가림·운영 전환 2인 승인' })).not.toBeInTheDocument();
  });
});
