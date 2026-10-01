import { HALLUCINATION_PHRASES, cleanupTranscript, collapseRepetitions, isHallucinatedPhrase } from './transcript-cleanup';

describe('transcript-cleanup(§7.4 후처리)', () => {
  it('앞뒤·연속 공백과 제어 문자를 정리한다', () => {
    expect(cleanupTranscript('  안녕하세요 \t\n 반갑습니다  ').text).toBe('안녕하세요 반갑습니다');
    expect(cleanupTranscript('\u0000\u0007').text).toBe('');
    expect(cleanupTranscript('').text).toBe('');
  });

  it('같은 구절(2~30자)이 연속 3회 이상이면 1회로 줄인다', () => {
    expect(collapseRepetitions('감사합니다감사합니다감사합니다')).toBe('감사합니다');
    expect(collapseRepetitions('네 알겠습니다 네 알겠습니다 네 알겠습니다 끝')).toBe('네 알겠습니다 끝');
    expect(cleanupTranscript('네 알겠습니다 네 알겠습니다 네 알겠습니다 끝').text).toBe('네 알겠습니다 끝');
  });

  it('2회 반복·1글자 반복은 줄이지 않는다', () => {
    expect(collapseRepetitions('안녕 안녕')).toBe('안녕 안녕');
    expect(collapseRepetitions('아아아아')).toBe('아아아아');
  });

  it('반복 축약 입력 상한(20,000자) 이후는 잘려도 선형 시간에 끝난다', () => {
    const t0 = Date.now();
    collapseRepetitions('가나다라마바사'.repeat(5000));
    expect(Date.now() - t0).toBeLessThan(30_000); // 10배 여유 — 부하 플래키 방어(선형 방어 의도 유지)
  });

  it('숫자열은 반복 축약에서 제외한다(M-2)', () => {
    expect(collapseRepetitions('00000000')).toBe('00000000');
    expect(collapseRepetitions('0101 0101 0101')).toBe('0101 0101 0101');
    expect(cleanupTranscript('일일일일 일일일일 일일일일').text).toBe('1111-1111-1111');
    expect(cleanupTranscript('공일공일공일공일공일공일').text).toBe('010101010101');
  });

  it('상투 문장 목록은 1차 비어 있다(K-7) — 구조만 있다', () => {
    expect(HALLUCINATION_PHRASES).toEqual([]);
    expect(isHallucinatedPhrase('시청해 주셔서 감사합니다')).toBe(false);
  });

  it('목록이 주어지면 전사 전체가 정규화 일치할 때만 빈 글자로 바꾼다', () => {
    const phrases = ['시청해 주셔서 감사합니다.'];
    expect(cleanupTranscript('시청해 주셔서 감사합니다', phrases).text).toBe('');
    expect(cleanupTranscript('  시청해주셔서  감사합니다!! ', phrases).text).toBe('');
    expect(cleanupTranscript('시청해 주셔서 감사합니다 그런데 환불은요', phrases).text).not.toBe('');
  });

  it('한글 숫자열을 정규화한다(AC-VO2-10)', () => {
    expect(cleanupTranscript('구공공일일이 다시 일이삼사오육칠').text).toBe('900112-1234567');
  });

  it('2,000자 상한', () => {
    const long = '가'.repeat(3000);
    expect(cleanupTranscript(long).text.length).toBeLessThanOrEqual(2000);
  });

  it('금지어·개인정보는 처리하지 않는다(FR-VO2-9) — 전송 시 기존 경로가 한다', () => {
    expect(cleanupTranscript('내 번호는 010-1234-5678').text).toBe('내 번호는 010-1234-5678');
  });
});
