import { assertMergeAllowed } from './merge-rule';
import type { MergeCandidate } from './merge-rule';

const ACTIVE = (kind: 'IDENTIFIED' | 'ANONYMOUS' | 'TEST'): MergeCandidate => ({ kind, status: 'ACTIVE', identityPurgedAt: null });

describe('assertMergeAllowed(순수 함수, §7.4)', () => {
  it('익명 → 식별은 허용된다', () => {
    expect(assertMergeAllowed('s', ACTIVE('ANONYMOUS'), 't', ACTIVE('IDENTIFIED')).ok).toBe(true);
  });

  it('익명 ↔ 익명은 허용된다', () => {
    expect(assertMergeAllowed('s', ACTIVE('ANONYMOUS'), 't', ACTIVE('ANONYMOUS')).ok).toBe(true);
  });

  it('식별 → 식별은 거부된다(AC-OC3-2)', () => {
    const r = assertMergeAllowed('s', ACTIVE('IDENTIFIED'), 't', ACTIVE('IDENTIFIED'));
    expect(r.ok).toBe(false);
  });

  it('식별 → 익명(방향 오류)도 거부된다', () => {
    const r = assertMergeAllowed('s', ACTIVE('IDENTIFIED'), 't', ACTIVE('ANONYMOUS'));
    expect(r.ok).toBe(false);
  });

  it('시험 고객이 관련되면 거부된다(AC-OC5-3)', () => {
    expect(assertMergeAllowed('s', ACTIVE('TEST'), 't', ACTIVE('ANONYMOUS')).ok).toBe(false);
    expect(assertMergeAllowed('s', ACTIVE('ANONYMOUS'), 't', ACTIVE('TEST')).ok).toBe(false);
  });

  it('이미 병합된 고객은 원본·대상 모두 거부된다', () => {
    expect(assertMergeAllowed('s', { kind: 'ANONYMOUS', status: 'MERGED', identityPurgedAt: null }, 't', ACTIVE('ANONYMOUS')).ok).toBe(false);
    expect(assertMergeAllowed('s', ACTIVE('ANONYMOUS'), 't', { kind: 'ANONYMOUS', status: 'MERGED', identityPurgedAt: null }).ok).toBe(false);
  });

  it('대상의 식별 정보가 소거되었으면 거부된다(EX-OC-14)', () => {
    const r = assertMergeAllowed('s', ACTIVE('ANONYMOUS'), 't', { kind: 'IDENTIFIED', status: 'ACTIVE', identityPurgedAt: new Date() });
    expect(r.ok).toBe(false);
  });

  it('자기 자신은 거부된다', () => {
    expect(assertMergeAllowed('same', ACTIVE('ANONYMOUS'), 'same', ACTIVE('ANONYMOUS')).ok).toBe(false);
  });
});
