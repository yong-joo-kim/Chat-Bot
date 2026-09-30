import { decidePromoteDraftGate } from './promote-draft-gate';

describe('decidePromoteDraftGate — N40-3 결정표', () => {
  const cases: Array<{ mode: 'KEEP_PROD' | 'PROMOTE_DRAFT'; gateMode: 'WARN' | 'BLOCK'; same: boolean; expected: 'OK' | 'GATE_BLOCKED' }> = [];
  for (const mode of ['KEEP_PROD', 'PROMOTE_DRAFT'] as const) {
    for (const gateMode of ['WARN', 'BLOCK'] as const) {
      for (const same of [true, false]) {
        cases.push({ mode, gateMode, same, expected: mode === 'PROMOTE_DRAFT' && gateMode === 'BLOCK' && !same ? 'GATE_BLOCKED' : 'OK' });
      }
    }
  }

  it.each(cases)('$mode × $gateMode × 초안=운영:$same → $expected', ({ mode, gateMode, same, expected }) => {
    expect(decidePromoteDraftGate({ mode, gateMode, draftContentHash: 'a'.repeat(64), prodContentHash: same ? 'a'.repeat(64) : 'b'.repeat(64) })).toBe(expected);
  });

  it('전수 8건 중 GATE_BLOCKED는 정확히 1건', () => {
    expect(cases).toHaveLength(8);
    expect(cases.filter((c) => c.expected === 'GATE_BLOCKED')).toHaveLength(1);
  });
});
