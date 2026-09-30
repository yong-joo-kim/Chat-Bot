import { ANSWER_MAX_LENGTH, truncateAnswer } from './truncate-answer';

describe('truncateAnswer — 2,000자 절단(L-3 공용)', () => {
  it('상한 이하는 그대로', () => {
    expect(truncateAnswer('가'.repeat(ANSWER_MAX_LENGTH))).toBe('가'.repeat(ANSWER_MAX_LENGTH));
    expect(truncateAnswer('')).toBe('');
  });

  it('상한 초과는 2,000자 + …', () => {
    const out = truncateAnswer('가'.repeat(ANSWER_MAX_LENGTH + 1));
    expect(out).toBe(`${'가'.repeat(ANSWER_MAX_LENGTH)}…`);
    expect(out.length).toBe(ANSWER_MAX_LENGTH + 1);
  });

  it('상한은 2000(문서·계약 값)', () => {
    expect(ANSWER_MAX_LENGTH).toBe(2000);
  });
});
