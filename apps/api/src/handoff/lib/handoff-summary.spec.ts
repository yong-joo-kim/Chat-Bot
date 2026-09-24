import { buildHandoffSummary } from './handoff-summary';
import type { HandoffSummaryRow } from './handoff-summary';

describe('buildHandoffSummary — §13', () => {
  it('표본이 없으면 평균은 null이고 표본 수는 0이다', () => {
    const result = buildHandoffSummary([]);
    expect(result.avgFirstResponseSec).toBeNull();
    expect(result.avgDurationSec).toBeNull();
    expect(result.firstResponseSamples).toBe(0);
    expect(result.durationSamples).toBe(0);
  });

  it('연결·응답·종료가 모두 있는 행에서 초 단위 평균을 계산한다', () => {
    const rows: HandoffSummaryRow[] = [
      {
        connectedAt: new Date('2026-01-01T00:00:00Z'),
        firstAgentReplyAt: new Date('2026-01-01T00:00:10Z'),
        endedAt: new Date('2026-01-01T00:05:00Z'),
        endReason: 'AGENT_ENDED',
      },
    ];
    const result = buildHandoffSummary(rows);
    expect(result.avgFirstResponseSec).toBe(10);
    expect(result.avgDurationSec).toBe(300);
    expect(result.endReasonCounts).toEqual({ AGENT_ENDED: 1 });
  });

  it('연결되지 않은 상담(NOT_DELIVERED)은 첫 응답·상담 시간 표본에서 제외된다', () => {
    const rows: HandoffSummaryRow[] = [{ connectedAt: null, firstAgentReplyAt: null, endedAt: new Date(), endReason: 'NOT_DELIVERED' }];
    const result = buildHandoffSummary(rows);
    expect(result.connectedCount).toBe(0);
    expect(result.firstResponseSamples).toBe(0);
    expect(result.durationSamples).toBe(0);
    expect(result.endReasonCounts).toEqual({ NOT_DELIVERED: 1 });
  });

  it('count·connectedCount를 정확히 센다', () => {
    const rows: HandoffSummaryRow[] = [
      { connectedAt: new Date(), firstAgentReplyAt: null, endedAt: null, endReason: null },
      { connectedAt: null, firstAgentReplyAt: null, endedAt: null, endReason: null },
    ];
    const result = buildHandoffSummary(rows);
    expect(result.count).toBe(2);
    expect(result.connectedCount).toBe(1);
  });
});
