import type { DeployScheduleResultSummary, PostRunTestOutcome, RestoreResponse } from '@chat-bot/shared-types';

/**
 * [신규 2026-09-23 No.28] `resultSummary` 조립(§7.4) — number/boolean/uuid/enum만 담는다(NFR-DS4,
 * 원문 없음). 동작 리터럴 분기가 허용되는 파일 중 하나다(§16 D-10).
 */

export interface RestoreSummaryInput {
  /** APPLIED·RECOVERED일 때만 안다(§7.6 M2) — NOOP은 백업이 없으므로 생략한다(0/'' 자리표시값 금지). */
  fromVersionNo?: number;
  backupVersionNo?: number;
  backupVersionId?: string;
  counts: Record<string, { added: number; removed: number; modified: number }>;
  reindexWasRunning: boolean;
  classifierDeleted: boolean;
}

export function buildRestoreSummary(input: RestoreSummaryInput, postRunTest?: PostRunTestOutcome): DeployScheduleResultSummary {
  return { kind: 'RESTORE', ...input, ...(postRunTest ? { postRunTest } : {}) };
}

export function restoreSummaryFromResponse(response: RestoreResponse, postRunTest?: PostRunTestOutcome): DeployScheduleResultSummary {
  return buildRestoreSummary(
    {
      fromVersionNo: response.restoredFromVersionNo,
      backupVersionNo: response.backupVersionNo,
      backupVersionId: response.backupVersionId,
      counts: response.summary,
      reindexWasRunning: response.reindexWasRunning,
      classifierDeleted: response.classifierDeleted,
    },
    postRunTest,
  );
}

export function buildPublishSummary(input: {
  statusBefore: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  statusAfter: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  channelBefore: boolean | null;
  channelAfter: boolean | null;
  postRunTest?: PostRunTestOutcome;
}): DeployScheduleResultSummary {
  return { kind: 'PUBLISH', ...input };
}

export function buildSetWebChannelSummary(channelBefore: boolean | null, channelAfter: boolean): DeployScheduleResultSummary {
  return { kind: 'SET_WEB_CHANNEL', channelBefore, channelAfter };
}
