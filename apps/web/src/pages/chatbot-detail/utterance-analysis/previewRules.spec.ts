import { describe, expect, it } from 'vitest';
import { checkTooFew, minValidFactor } from './previewRules';

describe('previewRules — 발화 부족 클라이언트 재계산(§4.4·§12-6)', () => {
  it('서버가 준 minValidCount에서 배수를 역산한다(규칙을 복제하지 않는다)', () => {
    expect(minValidFactor({ minValidCount: 10 }, 5)).toBe(2);
    expect(minValidFactor({ minValidCount: 30 }, 10)).toBe(3);
  });

  it('최소 발화 수를 보내지 않았다면 기본값(5)을 기준으로 역산한다', () => {
    expect(minValidFactor({ minValidCount: 10 }, undefined)).toBe(2);
  });

  it('minValidCount가 없는 응답이면 2배로 본다', () => {
    expect(minValidFactor({}, 5)).toBe(2);
  });

  it('유효 발화가 부족하면 줄여야 하는 상한을 알려 주고 충분하면 null이다', () => {
    const preview = { validCount: 9, minValidCount: 10 };
    expect(checkTooFew(preview, 5, 5)).toEqual({ validCount: 9, maxMin: 4 });
    expect(checkTooFew(preview, 5, 4)).toBeNull();
    expect(checkTooFew({ validCount: 10, minValidCount: 10 }, 5, 5)).toBeNull();
  });
});
