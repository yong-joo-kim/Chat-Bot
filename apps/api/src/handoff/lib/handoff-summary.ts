export interface HandoffSummaryRow {
  connectedAt: Date | null;
  firstAgentReplyAt: Date | null;
  endedAt: Date | null;
  endReason: string | null;
}

export interface HandoffSummaryResult {
  count: number;
  connectedCount: number;
  avgFirstResponseSec: number | null;
  firstResponseSamples: number;
  avgDurationSec: number | null;
  durationSamples: number;
  endReasonCounts: Record<string, number>;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * 이력 요약 조립(순수 함수, §13). 첫 응답 = `max(0, firstAgentReplyAt − connectedAt)`(연결된 상담만) ·
 * 상담 시간 = `endedAt − connectedAt`(연결·종료된 것만) · 종료 사유 분포 · 표본 수. 상담원별
 * 비교·순위는 만들지 않는다(P-15).
 */
export function buildHandoffSummary(rows: readonly HandoffSummaryRow[]): HandoffSummaryResult {
  const count = rows.length;
  const connectedRows = rows.filter((r) => r.connectedAt !== null);
  const connectedCount = connectedRows.length;

  const firstResponseSecs = connectedRows
    .filter((r) => r.firstAgentReplyAt !== null)
    .map((r) => Math.max(0, (r.firstAgentReplyAt!.getTime() - r.connectedAt!.getTime()) / 1000));

  const durationSecs = rows
    .filter((r) => r.connectedAt !== null && r.endedAt !== null)
    .map((r) => Math.max(0, (r.endedAt!.getTime() - r.connectedAt!.getTime()) / 1000));

  const endReasonCounts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.endReason) continue;
    endReasonCounts[row.endReason] = (endReasonCounts[row.endReason] ?? 0) + 1;
  }

  return {
    count,
    connectedCount,
    avgFirstResponseSec: average(firstResponseSecs),
    firstResponseSamples: firstResponseSecs.length,
    avgDurationSec: average(durationSecs),
    durationSamples: durationSecs.length,
    endReasonCounts,
  };
}
