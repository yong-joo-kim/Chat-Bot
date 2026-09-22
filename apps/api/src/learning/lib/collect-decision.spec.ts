import { shouldCollect } from './collect-decision';

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
