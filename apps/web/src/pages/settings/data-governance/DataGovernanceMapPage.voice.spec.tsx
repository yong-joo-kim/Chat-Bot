import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { GovernanceMapResponse } from '@chat-bot/shared-types';
import { DataGovernanceMapPage } from './DataGovernanceMapPage';
import { VoiceGovernanceCard } from '../../chatbot-detail/voice/VoiceGovernanceCard';

const mockMap = vi.fn();
vi.mock('../../../api/governance', () => ({ governanceApi: { map: (...args: unknown[]) => mockMap(...args) } }));

function makeMapResponse(overrides: Partial<GovernanceMapResponse> = {}): GovernanceMapResponse {
  return {
    mode: 'OFF',
    generatedAt: new Date('2026-10-01T00:00:00.000Z'),
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

const SPEECH = {
  serverEnabled: true,
  provider: 'local' as const,
  chatbotsInputEnabled: 3,
  chatbotsTtsEnabled: 5,
  audioStored: false as const,
  audioDiskWrite: false as const,
  transcriptStored: 'ONLY_WHEN_SENT' as const,
  ttsLocation: 'USER_DEVICE' as const,
  ttsServerEgress: false as const,
  onlineVoicesExcluded: true as const,
  counters: 'CHATBOT_DAILY_COUNTS_ONLY' as const,
};

const SPEECH_EXIT = { exitId: 'SPEECH_LOCAL' as const, configured: true, host: 'ml-worker.internal', dataKind: 'AUDIO_RAW' as const, masked: 'NO' as const, decision: 'ALLOWED' as const };

/** VO-C8 — 데이터 지도 음성 카드 · 출구 행(voice-ai-ui-spec §3.8). */
describe('DataGovernanceMapPage — 음성 카드·출구 행(No.32)', () => {
  beforeEach(() => mockMap.mockReset());

  it('기본 설치(speech 키·SPEECH_LOCAL 행 없음)는 화면이 바뀌지 않는다', async () => {
    mockMap.mockResolvedValue(makeMapResponse());
    render(<DataGovernanceMapPage />);
    await screen.findAllByText('임베딩');
    expect(screen.queryByRole('heading', { name: /음성\(눌러서 말하기/ })).not.toBeInTheDocument();
    expect(screen.queryByText('음성 인식(ml-worker)')).not.toBeInTheDocument();
  });

  it('speech 키가 있으면 카드를 그리고 서버가 준 값으로 고정 문구를 고른다', async () => {
    mockMap.mockResolvedValue(makeMapResponse({ speech: SPEECH }));
    render(<DataGovernanceMapPage />);
    const heading = await screen.findByRole('heading', { name: '음성(눌러서 말하기 · 답변 듣기)' });
    const card = heading.closest('section') as HTMLElement;
    expect(within(card).getByText('서버 음성 인식: 켜짐 · 방식: 사내 음성 인식(local)')).toBeInTheDocument();
    expect(within(card).getByText('음성 입력을 켠 챗봇 3개 · 답변 듣기를 켠 챗봇 5개')).toBeInTheDocument();
    expect(within(card).getByText('음성 원본: 저장 0 · 디스크 기록 0 · 사내 음성 인식 프로세스로만 전송 · 가림 불가')).toBeInTheDocument();
    expect(within(card).getByText('인식된 글자: 사용자가 전송할 때만 대화 기록으로 저장(기존 마스킹 적용)')).toBeInTheDocument();
    expect(within(card).getByText('답변 읽기: 사용자 기기 안에서 처리(기기 안 음성만) · 서버 전송 0')).toBeInTheDocument();
    expect(within(card).getByText('기록하는 숫자: 챗봇·일별 인식 횟수만')).toBeInTheDocument();
    expect(within(card).getByText(/음성은 개인정보를 가릴 수 없어/)).toBeInTheDocument();
  });

  it('mock 방식은 "모의 인식(실제 인식 아님)"을 경고 글자와 함께 보인다', async () => {
    render(<VoiceGovernanceCard map={{ ...SPEECH, provider: 'mock' }} />);
    expect(screen.getByText(/방식: 모의 인식\(실제 인식 아님\)/)).toBeInTheDocument();
  });

  it('알 수 없는 값은 "확인 필요"로 표시하고 오류로 죽지 않는다', () => {
    render(
      <VoiceGovernanceCard
        map={{ ...SPEECH, audioStored: true as never, transcriptStored: 'ALWAYS' as never, ttsLocation: 'SERVER' as never, counters: 'ALL' as never, provider: 'cloud' as never }}
      />,
    );
    expect(screen.getByText('음성 원본: 확인 필요')).toBeInTheDocument();
    expect(screen.getByText('인식된 글자: 확인 필요')).toBeInTheDocument();
    expect(screen.getByText('답변 읽기: 확인 필요')).toBeInTheDocument();
    expect(screen.getByText('기록하는 숫자: 확인 필요')).toBeInTheDocument();
    expect(screen.getByText(/방식: 확인 필요/)).toBeInTheDocument();
  });

  it('SPEECH_LOCAL 출구 행: 라벨 · 음성 원본(가림 불가) · 마스킹 안 함 · 경고 문구(허용 호스트) — TS7053 없이 렌더', async () => {
    mockMap.mockResolvedValue(
      makeMapResponse({
        egress: { allowedHosts: ['ml-worker.internal'], exits: [SPEECH_EXIT], legacyConnections: [] },
        speech: SPEECH,
      }),
    );
    render(<DataGovernanceMapPage />);
    expect((await screen.findAllByText('음성 인식(ml-worker)')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/음성 원본\(가림 불가\)/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('안 함').length).toBeGreaterThan(0);
    expect(screen.getByText('음성 인식: 음성 원본이 음성 인식 프로세스(허용 호스트 ml-worker.internal)로 전송됩니다. 저장하지 않습니다.')).toBeInTheDocument();
  });
});
