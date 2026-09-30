import type {
  AnalyzedUtterance,
  UtteranceAnalysisCapability,
  UtteranceAnalysisDetail,
  UtteranceAnalysisListItem,
  UtteranceCluster,
  UtterancePreviewResponse,
} from '@chat-bot/shared-types';

/** 발화 묶음 분석 화면 시험 전용 픽스처(운영 코드에서 import하지 않는다). 타입은 shared-types 계약을 그대로 따른다. */

export const CHATBOT_ID = '33333333-3333-4333-8333-333333333333';
export const ANALYSIS_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export function makeCapability(overrides: Partial<UtteranceAnalysisCapability> = {}): UtteranceAnalysisCapability {
  return {
    embeddingAvailable: true,
    nameSuggestAvailable: false,
    busy: { server: false, chatbot: false },
    stored: { count: 4, max: 20 },
    limits: { maxFileBytes: 5 * 1024 * 1024, maxRows: 5000, maxChars: 300 },
    retentionDays: 90,
    envModeEnabled: false,
    ...overrides,
  };
}

export function makeListItem(overrides: Partial<UtteranceAnalysisListItem> = {}): UtteranceAnalysisListItem {
  return {
    id: ANALYSIS_ID,
    status: 'SUCCEEDED',
    stage: null,
    progress: 100,
    fileName: '3월_VOC.xlsx',
    requestedByEmail: 'kim@example.com',
    createdAt: new Date('2026-09-29T05:02:00.000Z'),
    finishedAt: new Date('2026-09-29T05:06:00.000Z'),
    validCount: 2870,
    clusterCount: 10,
    candidateCount: 412,
    appliedCount: 35,
    expiresAt: new Date('2026-12-28T05:02:00.000Z'),
    failureReason: null,
    ...overrides,
  };
}

export function makeCluster(overrides: Partial<UtteranceCluster> = {}): UtteranceCluster {
  return {
    id: 'c1c1c1c1-0000-4000-8000-000000000001',
    ordinal: 1,
    unassigned: false,
    displayName: '해지 · 환급 · 위약금',
    autoName: '해지 · 환급 · 위약금',
    customName: null,
    suggestedName: null,
    keywords: [
      { term: '해지', score: 0.9, count: 120 },
      { term: '환급', score: 0.8, count: 80 },
    ],
    utteranceCount: 380,
    occurrenceSum: 1204,
    candidateCount: 274,
    candidateRatio: 0.72,
    appliedCount: 12,
    representatives: [
      { utteranceId: 'u-rep-1', text: '해지하고 싶어요' },
      { utteranceId: 'u-rep-2', text: '환급은 언제 되나요' },
    ],
    ...overrides,
  };
}

export const UNASSIGNED_CLUSTER_ID = 'c9c9c9c9-0000-4000-8000-000000000009';

export function makeUnassignedCluster(overrides: Partial<UtteranceCluster> = {}): UtteranceCluster {
  return makeCluster({
    id: UNASSIGNED_CLUSTER_ID,
    ordinal: 11,
    unassigned: true,
    displayName: '미분류',
    autoName: '미분류',
    keywords: [],
    utteranceCount: 45,
    occurrenceSum: 60,
    candidateCount: 0,
    candidateRatio: null,
    appliedCount: 0,
    representatives: [],
    ...overrides,
  });
}

export function makeDetail(overrides: Partial<UtteranceAnalysisDetail> = {}): UtteranceAnalysisDetail {
  const base = makeListItem();
  return {
    ...base,
    fileKind: 'XLSX',
    conditions: {
      targetClusterCount: 10,
      minClusterSize: 5,
      keywordCount: 10,
      nounsOnly: true,
      probe: { enabled: true, target: 'SERVING', scoreThreshold: null },
      nameSuggest: false,
    },
    counts: {
      totalRows: 3020,
      validCount: 2870,
      mergedCount: 110,
      excluded: { EMPTY: 8, TOO_LONG: 2, TOO_SHORT: 6, NO_CONTENT: 4 },
      maskedRowCount: 214,
      bannedRowCount: 3,
      invalidCountRows: 1,
      occurrenceTotal: 5932,
    },
    notices: [],
    failureReason: null,
    embeddingModelId: 'ko-sbert-v1',
    staleModel: false,
    algorithmVersion: 'v1',
    analyzerId: 'kiwi',
    probe: { status: 'DONE', failureReason: null, targetKind: 'PROD', versionNo: 7, threshold: 0.6, wouldUseRagCount: 0 },
    nameSuggest: { status: 'OFF', failureReason: null },
    unassignedCount: 45,
    clusters: [makeUnassignedCluster(), makeCluster({ id: 'c2c2c2c2-0000-4000-8000-000000000002', ordinal: 2, displayName: '배송 · 지연', autoName: '배송 · 지연', utteranceCount: 200 }), makeCluster()],
    startedAt: new Date('2026-09-29T05:02:10.000Z'),
    durationMs: 192_000,
    ...overrides,
  };
}

export function makeUtterance(overrides: Partial<AnalyzedUtterance> = {}): AnalyzedUtterance {
  return {
    id: 'u0000000-0000-4000-8000-000000000001',
    seq: 1,
    clusterId: 'c1c1c1c1-0000-4000-8000-000000000001',
    clusterOrdinal: 1,
    clusterDisplayName: '해지 · 환급 · 위약금',
    text: '환불 어떻게 받아요',
    occurrenceCount: 12,
    sourceMemo: null,
    hasBannedWord: false,
    hasMaskToken: false,
    probe: { answered: false, matchKind: null, matchId: null, matchName: null, band: null, score: 0.41, wouldUseRag: false },
    learningCandidate: true,
    suggestedIntents: [{ intentId: 'i1', name: '해지문의', score: 0.52, source: 'SEMANTIC' }],
    applied: null,
    ...overrides,
  };
}

export function makePreview(overrides: Partial<UtterancePreviewResponse> = {}): UtterancePreviewResponse {
  return {
    totalRows: 3020,
    validCount: 2870,
    mergedCount: 110,
    excluded: { EMPTY: 8, TOO_LONG: 2, TOO_SHORT: 6, NO_CONTENT: 4 },
    maskedRowCount: 214,
    bannedRowCount: 3,
    invalidCountRows: 1,
    occurrenceTotal: 5932,
    fileKind: 'XLSX',
    canAnalyze: true,
    minValidCount: 10,
    ...overrides,
  };
}
