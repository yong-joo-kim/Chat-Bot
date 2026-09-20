import { describe, expect, it } from 'vitest';
import { planPauseSchedule } from './pause-schedule';
import type { OutputView } from '@chat-bot/shared-types/output-view';

describe('widget core/pause-schedule — PAUSE 지연 일정(FR-W-7)', () => {
  it('PAUSE가 아닌 아웃풋은 지연 0이다', () => {
    const views: OutputView[] = [{ type: 'TEXT', payload: { text: '안녕하세요' } }];
    expect(planPauseSchedule(views)).toEqual([0]);
  });

  it('PAUSE는 durationMs만큼 지연시킨다', () => {
    const views: OutputView[] = [
      { type: 'TEXT', payload: { text: '첫 문장' } },
      { type: 'PAUSE', payload: { durationMs: 1000 } },
      { type: 'TEXT', payload: { text: '둘째 문장' } },
    ];
    expect(planPauseSchedule(views)).toEqual([0, 1000, 0]);
  });

  it('누적 지연이 5초를 넘지 않도록 상한을 둔다(한 턴당 최대 5초)', () => {
    const views: OutputView[] = [
      { type: 'PAUSE', payload: { durationMs: 3000 } },
      { type: 'PAUSE', payload: { durationMs: 3000 } },
    ];
    const delays = planPauseSchedule(views);
    expect(delays[0]).toBe(3000);
    expect(delays[1]).toBe(2000); // 남은 예산만큼만 지연(5000 - 3000)
    expect(delays.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5000);
  });
});
