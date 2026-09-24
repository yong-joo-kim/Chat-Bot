import type { TestRun as PrismaTestRun, TestRunResult as PrismaTestRunResult } from '@prisma/client';
import type {
  TestCaseExpectedKind,
  TestCaseResultKind,
  TestRun,
  TestRunEnvFingerprint,
  TestRunMode,
  TestRunOverlaySource,
  TestRunResult,
  TestRunResultBand,
  TestRunStatus,
  TestRunSummary,
} from '@chat-bot/shared-types';

function parseJson<T>(json: string | null | undefined): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export function toTestRunDto(row: PrismaTestRun): TestRun {
  const elapsedMs =
    row.startedAt && row.finishedAt ? Math.max(0, row.finishedAt.getTime() - row.startedAt.getTime()) : null;
  return {
    id: row.id,
    chatbotId: row.chatbotId,
    setId: row.setId,
    mode: row.mode as TestRunMode,
    overlaySource: row.overlaySource as TestRunOverlaySource,
    status: row.status as TestRunStatus,
    progress: row.progress,
    totalCount: row.totalCount,
    processedCount: row.processedCount,
    summary: parseJson<TestRunSummary>(row.summary),
    envFingerprint: parseJson<TestRunEnvFingerprint>(row.envFingerprint),
    degradedMode: row.degradedMode,
    useRag: row.useRag,
    ragCallCount: row.ragCallCount,
    pinned: row.pinned,
    failureReason: row.failureReason ?? null,
    elapsedMs,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    createdAt: row.createdAt,
  };
}

export function toTestRunResultDto(row: PrismaTestRunResult, nameById?: ReadonlyMap<string, string>): TestRunResult {
  const expectedTargetId = row.expectedTargetId ?? null;
  const matchedId = row.matchedIntentIdA ?? row.matchedFaqIdA ?? row.matchedNodeIdA ?? null;
  const matchedIdB = row.matchedIntentIdB ?? row.matchedFaqIdB ?? row.matchedNodeIdB ?? null;
  return {
    id: row.id,
    runId: row.runId,
    caseId: row.caseId,
    seq: row.seq,
    questionText: row.questionText,
    expectedKind: row.expectedKind as TestCaseExpectedKind,
    expectedTargetId,
    expectedTargetName: expectedTargetId ? (nameById?.get(expectedTargetId) ?? null) : null,
    resultA: row.resultA as TestCaseResultKind,
    matchedIntentIdA: row.matchedIntentIdA ?? null,
    matchedFaqIdA: row.matchedFaqIdA ?? null,
    matchedNodeIdA: row.matchedNodeIdA ?? null,
    matchedNameA: matchedId ? (nameById?.get(matchedId) ?? null) : null,
    bandA: (row.bandA as TestRunResultBand | null) ?? null,
    top1ScoreA: row.top1ScoreA ?? null,
    top1KindA: (row.top1KindA as 'FAQ' | 'INTENT' | null) ?? null,
    top1IdA: row.top1IdA ?? null,
    marginToTop2A: row.marginToTop2A ?? null,
    outputsPreviewA: row.outputsPreviewA ?? null,
    unsupportedCountA: row.unsupportedCountA,
    blockedByFilterA: row.blockedByFilterA,
    elapsedMsA: row.elapsedMsA,
    resultB: (row.resultB as TestCaseResultKind | null) ?? undefined,
    matchedIntentIdB: row.matchedIntentIdB ?? undefined,
    matchedFaqIdB: row.matchedFaqIdB ?? undefined,
    matchedNodeIdB: row.matchedNodeIdB ?? undefined,
    matchedNameB: matchedIdB ? (nameById?.get(matchedIdB) ?? null) : undefined,
    bandB: (row.bandB as TestRunResultBand | null) ?? undefined,
    top1ScoreB: row.top1ScoreB ?? undefined,
    outputsPreviewB: row.outputsPreviewB ?? undefined,
    diffStatus: (row.diffStatus as 'SAME' | 'DIFFERENT' | null) ?? undefined,
    wouldUseRag: row.wouldUseRag,
    ragAttempted: row.ragAttempted,
    ragLatencyMs: row.ragLatencyMs ?? undefined,
    ragSourceCount: row.ragSourceCount ?? undefined,
    apiMockA: row.apiMockA ?? null,
    apiMockB: row.apiMockB ?? undefined,
    surveyPreviewA: row.surveyPreviewA,
    surveyPreviewB: row.surveyPreviewB,
    createdAt: row.createdAt,
  };
}
