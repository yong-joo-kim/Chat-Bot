import { checkSuggestedName, normalizeSuggestedName } from './name-sanitize';

/** 정규화 → 검사(금지어 탐지 결과는 인자로 주입). */
function sanitize(raw: string, banned = false): string | null {
  return checkSuggestedName(normalizeSuggestedName(raw), banned);
}

describe('name-sanitize — 묶음 이름(AI 제안) 출력 검사(설계서 §16.5)', () => {
  it('① 줄바꿈·탭·마크다운 기호·앞뒤 따옴표를 정리한다', () => {
    expect(normalizeSuggestedName('  "**환불 문의**"\n')).toBe('환불 문의');
    expect(normalizeSuggestedName('# 배송\t지연 `문의`')).toBe('배송 지연 문의');
    expect(normalizeSuggestedName('「로그인 오류」')).toBe('로그인 오류');
    expect(normalizeSuggestedName('> 결제   실패')).toBe('결제 실패');
  });

  it('정상적인 한국어 명사구는 통과한다', () => {
    expect(sanitize('환불 신청 문의')).toBe('환불 신청 문의');
    expect(sanitize('"배송 지연"')).toBe('배송 지연');
    expect(sanitize('ATM 이용 문의')).toBe('ATM 이용 문의'); // 한글 비율 50% 이상
  });

  it('② 길이 2~30자(경계)', () => {
    expect(sanitize('가')).toBeNull();
    expect(sanitize('가나')).toBe('가나');
    expect(sanitize('가'.repeat(30))).toBe('가'.repeat(30));
    expect(sanitize('가'.repeat(31))).toBeNull();
  });

  it('③ 한글이 50% 미만이면(영문 출력) 탈락한다', () => {
    expect(sanitize('Refund inquiry')).toBeNull();
    expect(sanitize('Refund 문의 request')).toBeNull();
  });

  it('④ 금지어가 탐지되면 탈락한다', () => {
    expect(sanitize('환불 문의', true)).toBeNull();
  });

  it('⑤ 개인정보 모양(전화·이메일·주민번호 등)은 탈락한다', () => {
    expect(sanitize('연락처 010-1234-5678 문의')).toBeNull();
    expect(sanitize('상담 900101-1234567 확인')).toBeNull();
  });

  it('⑥ 마스킹 표식·`*`·대괄호가 남아 있으면 탈락한다', () => {
    expect(sanitize('[전화번호] 문의')).toBeNull();
    expect(sanitize('***문의 안내')).toBe('문의 안내'); // 마크다운 기호 제거 후 통과
    expect(sanitize('[안내] 문의 처리')).toBeNull();
  });

  it('⑦ URL·@가 있으면 탈락한다', () => {
    expect(sanitize('http://example.com 안내 문의')).toBeNull();
    expect(sanitize('문의 안내 @담당자')).toBeNull();
    expect(sanitize('www.example.com 문의 안내')).toBeNull();
  });

  it('빈 문자열·공백만 있으면 탈락한다', () => {
    expect(sanitize('')).toBeNull();
    expect(sanitize('   \n ')).toBeNull();
  });
});
