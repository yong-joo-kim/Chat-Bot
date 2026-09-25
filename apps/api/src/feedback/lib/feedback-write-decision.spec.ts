import { decideFeedbackWrite } from './feedback-write-decision';

const TURN_CREATED_AT = new Date('2026-09-25T00:00:00.000Z');
const WITHIN_WINDOW = new Date('2026-09-25T12:00:00.000Z');
const AFTER_WINDOW = new Date('2026-09-26T01:00:00.000Z'); // 25시간 뒤

describe('decideFeedbackWrite (FR-FB4-\\*, ADR-0038 §7.3)', () => {
  it('CREATE when no existing row and within window', () => {
    expect(
      decideFeedbackWrite({ existing: null, requested: 'DOWN', turnCreatedAt: TURN_CREATED_AT, now: WITHIN_WINDOW, windowHours: 24, maxChanges: 5 }),
    ).toBe('CREATE');
  });

  it('CLOSED when no existing row and window has passed', () => {
    expect(
      decideFeedbackWrite({ existing: null, requested: 'DOWN', turnCreatedAt: TURN_CREATED_AT, now: AFTER_WINDOW, windowHours: 24, maxChanges: 5 }),
    ).toBe('CLOSED');
  });

  it('NOOP when same value requested, even after window (idempotent — D-17)', () => {
    expect(
      decideFeedbackWrite({
        existing: { rating: 'DOWN', changeCount: 1 },
        requested: 'DOWN',
        turnCreatedAt: TURN_CREATED_AT,
        now: AFTER_WINDOW,
        windowHours: 24,
        maxChanges: 5,
      }),
    ).toBe('NOOP');
  });

  it('CHANGE when different value requested, within window, under maxChanges', () => {
    expect(
      decideFeedbackWrite({
        existing: { rating: 'UP', changeCount: 1 },
        requested: 'DOWN',
        turnCreatedAt: TURN_CREATED_AT,
        now: WITHIN_WINDOW,
        windowHours: 24,
        maxChanges: 5,
      }),
    ).toBe('CHANGE');
  });

  it('CLOSED when maxChanges reached', () => {
    expect(
      decideFeedbackWrite({
        existing: { rating: 'UP', changeCount: 5 },
        requested: 'DOWN',
        turnCreatedAt: TURN_CREATED_AT,
        now: WITHIN_WINDOW,
        windowHours: 24,
        maxChanges: 5,
      }),
    ).toBe('CLOSED');
  });

  it('CLOSED when different value requested after window has passed', () => {
    expect(
      decideFeedbackWrite({
        existing: { rating: 'UP', changeCount: 1 },
        requested: 'DOWN',
        turnCreatedAt: TURN_CREATED_AT,
        now: AFTER_WINDOW,
        windowHours: 24,
        maxChanges: 5,
      }),
    ).toBe('CLOSED');
  });
});
