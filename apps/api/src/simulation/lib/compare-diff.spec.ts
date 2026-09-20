import type { DialogOutput } from '@chat-bot/shared-types';
import { compareDiff } from './compare-diff';

function turn(outputs: DialogOutput[], overrides: Partial<{ matchedNodeId: string; matchedFaqId: string; matchedIntentId: string }> = {}) {
  return { outputs, ...overrides };
}

describe('compareDiff — FR-10-27', () => {
  it('아웃풋과 매칭 결과가 동일하면 SAME이다', () => {
    const outputs: DialogOutput[] = [{ type: 'TEXT', payload: { text: '안녕' } }];
    const diff = compareDiff(turn(outputs, { matchedNodeId: 'n1' }), turn(outputs, { matchedNodeId: 'n1' }));
    expect(diff.status).toBe('SAME');
    expect(diff.outputsChanged).toBe(false);
    expect(diff.matchChanged).toBe(false);
  });

  it('아웃풋 문구가 다르면 DIFFERENT다', () => {
    const diff = compareDiff(
      turn([{ type: 'TEXT', payload: { text: '안녕' } }]),
      turn([{ type: 'TEXT', payload: { text: '반가워요' } }]),
    );
    expect(diff.status).toBe('DIFFERENT');
    expect(diff.outputsChanged).toBe(true);
  });

  it('아웃풋 문구가 같아도 매칭 결과가 다르면 DIFFERENT다(AC-10B-8)', () => {
    const outputs: DialogOutput[] = [{ type: 'TEXT', payload: { text: '동일 문구' } }];
    const diff = compareDiff(turn(outputs, { matchedNodeId: 'n1' }), turn(outputs, { matchedNodeId: 'n2' }));
    expect(diff.status).toBe('DIFFERENT');
    expect(diff.matchChanged).toBe(true);
    expect(diff.outputsChanged).toBe(false);
  });

  it('키 순서가 달라도 정규화 비교로 SAME 판정된다', () => {
    const a: DialogOutput[] = [{ type: 'CARD', payload: { title: 'T', description: 'D' } }];
    const b: DialogOutput[] = [{ type: 'CARD', payload: { description: 'D', title: 'T' } }];
    const diff = compareDiff(turn(a), turn(b));
    expect(diff.status).toBe('SAME');
  });
});
