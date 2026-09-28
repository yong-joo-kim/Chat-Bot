import { computeIngestBackoffMs, isIngestRetryExhausted } from './backoff';

describe('computeIngestBackoffMs', () => {
  it('1·5·30분 순서다', () => {
    expect(computeIngestBackoffMs(1)).toBe(60_000);
    expect(computeIngestBackoffMs(2)).toBe(5 * 60_000);
    expect(computeIngestBackoffMs(3)).toBe(30 * 60_000);
  });
  it('3회를 넘으면 null(소진)', () => {
    expect(computeIngestBackoffMs(4)).toBeNull();
  });
});

describe('isIngestRetryExhausted', () => {
  it('3회까지는 소진 아님, 4회부터 소진', () => {
    expect(isIngestRetryExhausted(3)).toBe(false);
    expect(isIngestRetryExhausted(4)).toBe(true);
  });
});
