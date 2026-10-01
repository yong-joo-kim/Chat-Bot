import { maskPii } from '@chat-bot/pii-mask';
import { KOREAN_DIGITS_MIN_LENGTH, normalizeKoreanDigits } from './korean-digits';

/**
 * 한글 숫자 정규화 — 규칙 표(voice-ai-설계.md §7.4 ④ · P-16). 규칙은 "확정 대기(3050 실측 후)"라 이 표가 현재 제안 규칙을 고정한다.
 */
describe('normalizeKoreanDigits', () => {
  const convert: Array<[string, string]> = [
    ['공일공 일이삼사 오육칠팔', '010-1234-5678'],
    ['영일영 일이삼사 오육칠팔', '010-1234-5678'],
    ['공일공-일이삼사-오육칠팔', '010-1234-5678'],
    ['구공공일일이 다시 일이삼사오육칠', '900112-1234567'],
    ['구공공일일이 일이삼사오육칠', '900112-1234567'],
    ['일이삼사오육', '123456'],
    ['공공일 륙칠팔구', '001-6789'],
    ['제 번호는 공일공 일이삼사 오육칠팔 입니다', '제 번호는 010-1234-5678 입니다'],
    ['전화번호 공일공 일이삼사 오육칠팔', '전화번호 010-1234-5678'],
  ];
  it.each(convert)('변환: %s → %s', (input, expected) => {
    expect(normalizeKoreanDigits(input)).toBe(expected);
  });

  const unchanged = [
    '사이사이', // 4자리
    '이사', // 2자리
    '일이삼사오', // 5자리(경계)
    '오육십', // 십은 숫자 음절이 아니다
    '천이백삼십사', // 자릿값 읽기
    '일 이 삼', // 낱자 분리 3자리
    '010 일이삼사 오육칠팔', // 한글·숫자 혼합(아라비아 숫자 토큰과 맞닿음)
    '일이삼사 오육칠팔 010', // 한글·숫자 혼합(뒤쪽)
    '공1공 일이삼사 오육칠팔', // 한 토큰 안의 혼합
    '이 사이에 일이 있어요',
    '',
    '안녕하세요',
  ];
  it.each(unchanged)('비변환: %s', (input) => {
    expect(normalizeKoreanDigits(input)).toBe(input);
  });

  it('알려진 한계(K-6): 조사가 붙은 토큰은 숫자 음절 토큰이 아니라 그 앞의 순수 숫자 구간만 변환된다', () => {
    expect(normalizeKoreanDigits('공일공 일이삼사 오육칠팔로 전화해 주세요')).toBe('010-1234 오육칠팔로 전화해 주세요');
  });

  it('최소 자릿수 상수 = 6(확정 대기)', () => {
    expect(KOREAN_DIGITS_MIN_LENGTH).toBe(6);
  });

  it('"다시"가 구간 끝·시작에 있으면 하이픈으로 바꾸지 않고 그대로 둔다', () => {
    expect(normalizeKoreanDigits('일이삼사오육 다시 해주세요')).toBe('123456 다시 해주세요');
    expect(normalizeKoreanDigits('다시 일이삼사오육')).toBe('다시 123456');
  });

  it('두 개의 독립된 숫자열(사이에 일반 낱말)은 각각 판정한다', () => {
    expect(normalizeKoreanDigits('공일공 일이삼사 오육칠팔 그리고 구공공일일이 일이삼사오육칠')).toBe('010-1234-5678 그리고 900112-1234567');
  });

  it('낱글자를 공백으로 끊어 읽으면 군집 없이 이어 붙이고 pii-mask가 가린다(M-1)', () => {
    const converted = normalizeKoreanDigits('공 일 공 일 이 삼 사 오 육 칠 팔');
    expect(converted).toBe('01012345678');
    const masked = maskPii(`번호는 ${converted} 입니다`).maskedText;
    expect(masked).not.toContain('1234');
    expect(masked).toContain('*');
    // 군집(2글자 이상) 토큰이 섞이면 기존 군집 하이픈 규칙 유지
    expect(normalizeKoreanDigits('공일공 일 이 삼 사 오 육 칠 팔')).toBe('010-1-2-3-4-5-6-7-8');
  });

  it('긴 입력도 선형 시간에 끝난다(10배 여유 — 부하 플래키 방어)', () => {
    const input = `${'일이삼사오육 '.repeat(5000)}끝`;
    const t0 = Date.now();
    normalizeKoreanDigits(input);
    expect(Date.now() - t0).toBeLessThan(20_000);
  });
});
