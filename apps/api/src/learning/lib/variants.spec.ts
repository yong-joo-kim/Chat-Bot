import { mergeVariants } from './variants';

describe('mergeVariants (FR-15-4)', () => {
  it('keeps the newest variant first and deduplicates exact matches', () => {
    const result = mergeVariants(['해외배송 되나요', '배송 조회'], '해외배송 되나요');
    expect(result).toEqual(['해외배송 되나요', '배송 조회']);
  });

  it('prepends a new variant and caps the list at `max`', () => {
    const current = ['v1', 'v2', 'v3', 'v4', 'v5'];
    const result = mergeVariants(current, 'v6', 5);
    expect(result).toEqual(['v6', 'v1', 'v2', 'v3', 'v4']);
    expect(result).toHaveLength(5);
  });

  it('truncates an overly long variant to maxLen', () => {
    const result = mergeVariants([], 'a'.repeat(300), 5, 200);
    expect(result[0]).toHaveLength(200);
  });
});
