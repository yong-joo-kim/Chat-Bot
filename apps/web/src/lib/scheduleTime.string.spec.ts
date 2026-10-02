import { describe, expect, it } from 'vitest';
import { formatInZone, formatScheduleDateTime, toInstant } from './scheduleTime';

// [DHX-5] 웹 apiClient는 날짜를 복원하지 않아 API의 ISO 문자열이 Date 자리에 그대로 들어온다 — 예약 상세·목록이 `Invalid time value`로 비지 않아야 한다.
describe('scheduleTime — API가 준 ISO 문자열 입력(DHX-5)', () => {
  const iso = '2026-10-02T03:30:00.000Z';

  it('toInstant는 문자열과 Date를 같은 순간으로 만든다', () => {
    expect(toInstant(iso).getTime()).toBe(new Date(iso).getTime());
    const d = new Date(iso);
    expect(toInstant(d)).toBe(d);
  });

  it('formatInZone·formatScheduleDateTime이 문자열에서도 던지지 않고 Date와 같은 결과를 낸다', () => {
    expect(() => formatInZone(iso, 'Asia/Seoul')).not.toThrow();
    expect(formatInZone(iso, 'Asia/Seoul')).toBe(formatInZone(new Date(iso), 'Asia/Seoul'));
    expect(formatInZone(iso, 'Asia/Seoul')).toContain('2026-10-02');
    expect(formatScheduleDateTime(iso, 'Asia/Seoul')).toBe(formatScheduleDateTime(new Date(iso), 'Asia/Seoul'));
  });
});
