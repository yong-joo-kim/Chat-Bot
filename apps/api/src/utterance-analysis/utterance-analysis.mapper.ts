import type { AnalyzedUtterance as AnalyzedUtteranceRow, UtteranceAnalysis as UtteranceAnalysisRow, UtteranceCluster as UtteranceClusterRow } from '@prisma/client';
import type {
  AnalyzedUtterance,
  UtteranceAnalysisConditions,
  UtteranceAnalysisCounts,
  UtteranceAnalysisDetail,
  UtteranceAnalysisListItem,
  UtteranceAnalysisNotice,
  UtteranceAnalysisStage,
  UtteranceAnalysisStatus,
  UtteranceCluster,
  UtteranceClusterKeyword,
} from '@chat-bot/shared-types';
import { UtteranceAnalysisConditionsSchema } from '@chat-bot/shared-types';

/** JSON 컬럼 파싱 — 손상되어도 응답이 깨지지 않게 폴백한다. */
function parseJson<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

const EMPTY_COUNTS: UtteranceAnalysisCounts = {
  totalRows: 0,
  validCount: 0,
  mergedCount: 0,
  excluded: { EMPTY: 0, TOO_LONG: 0, TOO_SHORT: 0, NO_CONTENT: 0 },
  maskedRowCount: 0,
  bannedRowCount: 0,
  invalidCountRows: 0,
  occurrenceTotal: 0,
};

export function parseCounts(json: string): UtteranceAnalysisCounts {
  const parsed = parseJson<Partial<UtteranceAnalysisCounts>>(json, {});
  return { ...EMPTY_COUNTS, ...parsed, excluded: { ...EMPTY_COUNTS.excluded, ...(parsed.excluded ?? {}) } };
}

export function parseConditions(json: string): UtteranceAnalysisConditions {
  const result = UtteranceAnalysisConditionsSchema.safeParse(parseJson<unknown>(json, {}));
  return result.success ? result.data : UtteranceAnalysisConditionsSchema.parse({});
}

export function toListItem(row: UtteranceAnalysisRow): UtteranceAnalysisListItem {
  const counts = parseCounts(row.counts);
  return {
    id: row.id,
    status: row.status as UtteranceAnalysisStatus,
    stage: (row.stage as UtteranceAnalysisStage | null) ?? null,
    progress: row.progress,
    fileName: row.fileName,
    requestedByEmail: row.requestedByEmail,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    validCount: counts.validCount,
    clusterCount: row.clusterCount,
    candidateCount: row.candidateCount,
    appliedCount: row.appliedCount,
    expiresAt: row.expiresAt,
    failureReason: row.failureReason,
  };
}

export interface ClusterRepresentativeTexts {
  /** seq → { utteranceId, text }. */
  readonly bySeq: ReadonlyMap<number, { utteranceId: string; text: string }>;
}

export function toClusterDto(row: UtteranceClusterRow, reps: ClusterRepresentativeTexts, probeDone: boolean): UtteranceCluster {
  const seqs = parseJson<number[]>(row.representativeSeqs, []);
  const representatives = seqs
    .map((s) => reps.bySeq.get(s))
    .filter((r): r is { utteranceId: string; text: string } => r !== undefined)
    .slice(0, 3);
  return {
    id: row.id,
    ordinal: row.ordinal,
    unassigned: row.unassigned,
    displayName: row.customName ?? row.autoName,
    autoName: row.autoName,
    customName: row.customName,
    suggestedName: row.suggestedName,
    keywords: parseJson<UtteranceClusterKeyword[]>(row.keywords, []),
    utteranceCount: row.utteranceCount,
    occurrenceSum: row.occurrenceSum,
    candidateCount: row.candidateCount,
    candidateRatio: probeDone && row.utteranceCount > 0 ? row.candidateCount / row.utteranceCount : null,
    appliedCount: row.appliedCount,
    representatives,
  };
}

export function toDetail(
  row: UtteranceAnalysisRow,
  clusters: UtteranceCluster[],
  extra: { staleModel: boolean; wouldUseRagCount: number },
): UtteranceAnalysisDetail {
  const base = toListItem(row);
  return {
    ...base,
    failureReason: row.failureReason,
    fileKind: row.fileKind === 'CSV' ? 'CSV' : 'XLSX',
    conditions: parseConditions(row.conditions),
    counts: parseCounts(row.counts),
    notices: parseJson<UtteranceAnalysisNotice[]>(row.notices, []),
    embeddingModelId: row.embeddingModelId,
    staleModel: extra.staleModel,
    algorithmVersion: row.algorithmVersion,
    analyzerId: row.analyzerId,
    probe: {
      status: row.probeStatus as 'OFF' | 'DONE' | 'FAILED',
      failureReason: row.probeFailureReason,
      targetKind: (row.probeTargetKind as 'LIVE' | 'PROD' | null) ?? null,
      versionNo: row.probeVersionNo,
      threshold: row.probeThreshold,
      wouldUseRagCount: extra.wouldUseRagCount,
    },
    nameSuggest: {
      status: row.nameSuggestStatus as 'OFF' | 'DONE' | 'PARTIAL' | 'FAILED',
      failureReason: row.nameSuggestFailureReason,
    },
    unassignedCount: row.unassignedCount,
    clusters,
    startedAt: row.startedAt,
    durationMs: row.startedAt && row.finishedAt ? Math.max(0, row.finishedAt.getTime() - row.startedAt.getTime()) : null,
  };
}

export function toUtteranceDto(row: AnalyzedUtteranceRow, cluster: { ordinal: number; displayName: string }, probeDone: boolean): AnalyzedUtterance {
  return {
    id: row.id,
    seq: row.seq,
    clusterId: row.clusterId,
    clusterOrdinal: cluster.ordinal,
    clusterDisplayName: cluster.displayName,
    text: row.text,
    occurrenceCount: row.occurrenceCount,
    sourceMemo: row.sourceMemo,
    hasBannedWord: row.hasBannedWord,
    hasMaskToken: row.hasMaskToken,
    probe:
      probeDone && row.probeAnswered !== null
        ? {
            answered: row.probeAnswered,
            matchKind: (row.probeMatchKind as 'INTENT' | 'FAQ' | 'NODE' | null) ?? null,
            matchId: row.probeMatchId,
            matchName: row.probeMatchName,
            band: row.probeBand,
            score: row.probeScore,
            wouldUseRag: row.wouldUseRag,
          }
        : null,
    learningCandidate: row.learningCandidate,
    suggestedIntents: parseJson<AnalyzedUtterance['suggestedIntents']>(row.suggestedIntents, []),
    applied:
      row.appliedAt && row.appliedIntentId
        ? { intentId: row.appliedIntentId, intentName: row.appliedIntentName ?? '', byEmail: row.appliedByEmail, at: row.appliedAt }
        : null,
  };
}
