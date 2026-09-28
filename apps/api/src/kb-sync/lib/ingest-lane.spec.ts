import { decideIngestLane, isWithinBulkWindow } from './ingest-lane';

describe('decideIngestLane', () => {
  it('첫 적재·전체 재전송·50건 초과는 BULK', () => {
    expect(decideIngestLane({ jobCountInRun: 5, isFullResend: true, isFirstIngestForSource: false })).toBe('BULK');
    expect(decideIngestLane({ jobCountInRun: 5, isFullResend: false, isFirstIngestForSource: true })).toBe('BULK');
    expect(decideIngestLane({ jobCountInRun: 51, isFullResend: false, isFirstIngestForSource: false })).toBe('BULK');
  });
  it('그 밖에는 INCREMENTAL', () => {
    expect(decideIngestLane({ jobCountInRun: 3, isFullResend: false, isFirstIngestForSource: false })).toBe('INCREMENTAL');
    expect(decideIngestLane({ jobCountInRun: 50, isFullResend: false, isFirstIngestForSource: false })).toBe('INCREMENTAL');
  });
});

describe('isWithinBulkWindow', () => {
  it('빈 값이면 항상 true', () => {
    expect(isWithinBulkWindow('', new Date())).toBe(true);
  });
  it('자정을 넘는 구간(19:00-08:00)도 지원한다', () => {
    const kst2200 = new Date(Date.UTC(2020, 0, 1, 22 - 9, 0)); // KST 22:00
    const kst1000 = new Date(Date.UTC(2020, 0, 1, 10 - 9, 0)); // KST 10:00
    expect(isWithinBulkWindow('19:00-08:00', kst2200)).toBe(true);
    expect(isWithinBulkWindow('19:00-08:00', kst1000)).toBe(false);
  });
});
