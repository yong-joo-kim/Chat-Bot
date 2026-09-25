import { shouldCollect, shouldQueueNegativeFeedback } from './collect-decision';

const BASE = { isAnswered: false, blockedByFilter: false, inputKind: 'TEXT' as const, questionText: '해외배송 되나요', maxLength: 200 };

describe('shouldCollect (FR-15-1/2, AC-15A-1~6)', () => {
  it('collects when all 5 conditions are satisfied', () => {
    const result = shouldCollect(BASE);
    expect(result).toEqual({ collect: true, normalized: '해외배송 되나요' });
  });

  it('skips answered turns (AC-15A-7)', () => {
    expect(shouldCollect({ ...BASE, isAnswered: true })).toEqual({ collect: false, reason: 'ANSWERED' });
  });

  it('skips banned-word-blocked turns (AC-15A-3)', () => {
    expect(shouldCollect({ ...BASE, blockedByFilter: true })).toEqual({ collect: false, reason: 'BLOCKED' });
  });

  it('skips NODE button turns but not MESSAGE button turns (AC-15A-4)', () => {
    expect(shouldCollect({ ...BASE, inputKind: 'BUTTON_NODE' })).toEqual({ collect: false, reason: 'BUTTON_NODE' });
    expect(shouldCollect({ ...BASE, inputKind: 'BUTTON_MESSAGE' }).collect).toBe(true);
  });

  it('skips blank/whitespace-only input (AC-15A-5)', () => {
    expect(shouldCollect({ ...BASE, questionText: '   ' })).toEqual({ collect: false, reason: 'EMPTY' });
  });

  it('skips input exceeding the configured max length (EX-15-3)', () => {
    expect(shouldCollect({ ...BASE, questionText: 'a'.repeat(201), maxLength: 200 })).toEqual({ collect: false, reason: 'TOO_LONG' });
  });

  it('normalizes the question text via normalizeText (NFKC/trim/lowercase/whitespace collapse)', () => {
    const result = shouldCollect({ ...BASE, questionText: '  해외배송   되나요  ' });
    expect(result).toEqual({ collect: true, normalized: '해외배송 되나요' });
  });
});

/** [신규 No.44] shouldQueueNegativeFeedback — ADR-0038 §4, feedback-loop-설계.md §10.2. */
describe('shouldQueueNegativeFeedback (FR-FB6-1~8)', () => {
  const NEG_BASE = { isAnswered: true, apiNotice: false, inputKind: 'TEXT' as const, questionText: '해외배송 되나요', maxLength: 200 };

  it('queues when answered · not API notice · TEXT input · non-empty non-long', () => {
    expect(shouldQueueNegativeFeedback(NEG_BASE)).toEqual({ queue: true, normalized: '해외배송 되나요' });
  });

  it('queues BUTTON_MESSAGE input (treated as user sentence, same as UNANSWERED rule)', () => {
    expect(shouldQueueNegativeFeedback({ ...NEG_BASE, inputKind: 'BUTTON_MESSAGE' }).queue).toBe(true);
  });

  it('excludes API_NOTICE turns first (외부 장애 — ADR-0034 §5)', () => {
    expect(shouldQueueNegativeFeedback({ ...NEG_BASE, apiNotice: true })).toEqual({ queue: false, reason: 'API_NOTICE' });
  });

  it('excludes fallback turns (isAnswered=false) — already collected as UNANSWERED', () => {
    expect(shouldQueueNegativeFeedback({ ...NEG_BASE, isAnswered: false })).toEqual({ queue: false, reason: 'ALREADY_UNANSWERED' });
  });

  it('excludes BUTTON_NODE input — bot-provided label, not a user sentence', () => {
    expect(shouldQueueNegativeFeedback({ ...NEG_BASE, inputKind: 'BUTTON_NODE' })).toEqual({ queue: false, reason: 'BUTTON_NODE' });
  });

  it('excludes null inputKind conservatively (structurally unreachable in production, defensive)', () => {
    expect(shouldQueueNegativeFeedback({ ...NEG_BASE, inputKind: null })).toEqual({ queue: false, reason: 'BUTTON_NODE' });
  });

  it('excludes blank input', () => {
    expect(shouldQueueNegativeFeedback({ ...NEG_BASE, questionText: '   ' })).toEqual({ queue: false, reason: 'EMPTY' });
  });

  it('excludes overlong input', () => {
    expect(shouldQueueNegativeFeedback({ ...NEG_BASE, questionText: 'a'.repeat(201), maxLength: 200 })).toEqual({ queue: false, reason: 'TOO_LONG' });
  });
});
