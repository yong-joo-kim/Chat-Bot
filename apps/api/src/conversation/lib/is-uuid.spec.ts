import { isUuid } from './is-uuid';

describe('isUuid', () => {
  it('올바른 UUID v4 형식을 통과시킨다', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it('대문자도 허용한다(zod .uuid()와 동일한 관대함)', () => {
    expect(isUuid('11111111-1111-4111-8111-111111111111'.toUpperCase())).toBe(true);
  });

  it('형식이 다르면 거부한다', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid('11111111-1111-1111-1111-11111111111')).toBe(false); // 자릿수 부족
  });
});
