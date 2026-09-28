import { looksLikeContactInfo } from './contact-like';

describe('looksLikeContactInfo — 경고만(차단 아님)', () => {
  it.each(['010-1234-5678', '02-123-4567', '01012345678', '+82-10-1234-5678'])('전화번호처럼 보이는 문자열 %s는 true', (text) => {
    expect(looksLikeContactInfo(text)).toBe(true);
  });

  it.each(['help@example.com', '문의: support@company.co.kr'])('이메일처럼 보이는 문자열 %s는 true', (text) => {
    expect(looksLikeContactInfo(text)).toBe(true);
  });

  it('평범한 안내 문구는 false', () => {
    expect(looksLikeContactInfo('주문·배송 조회를 도와드릴까요?')).toBe(false);
  });
});
