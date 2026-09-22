import { decide, detect, maskText } from './banned-word-filter';
import type { BannedWordEntry } from './banned-word-filter';

const BLOCK_WORD: BannedWordEntry = { word: '나쁜말', wordNormalized: '나쁜말', matchType: 'CONTAINS', policy: 'BLOCK' };
const WARN_WORD: BannedWordEntry = { word: '경고어', wordNormalized: '경고어', matchType: 'CONTAINS', policy: 'WARN' };
const EXACT_WORD: BannedWordEntry = { word: '완전일치', wordNormalized: '완전일치', matchType: 'EXACT', policy: 'BLOCK' };

describe('detect — FR-12-43', () => {
  it('사전이 비어 있으면 정규화 없이 즉시 빈 배열을 반환한다(FR-12-46)', () => {
    expect(detect('아무 문장', [])).toEqual([]);
  });

  it('CONTAINS는 부분 문자열 포함을 탐지한다', () => {
    const matches = detect('이런 나쁜말이 섞인 문장', [BLOCK_WORD]);
    expect(matches).toHaveLength(1);
    expect(matches[0].word).toBe('나쁜말');
  });

  it('EXACT는 공백 분리 토큰 완전 일치만 탐지한다(부분 포함은 탐지하지 않는다)', () => {
    expect(detect('완전일치 단어', [EXACT_WORD])).toHaveLength(1);
    expect(detect('완전일치성 검토', [EXACT_WORD])).toHaveLength(0);
  });

  it('여러 단어가 동시에 탐지될 수 있다', () => {
    const matches = detect('나쁜말과 경고어가 함께 있는 문장', [BLOCK_WORD, WARN_WORD]);
    expect(matches).toHaveLength(2);
  });
});

describe('decide — FR-12-38', () => {
  it('BLOCK 단어가 있으면 다른 매치와 무관하게 BLOCK이다', () => {
    expect(decide([BLOCK_WORD, WARN_WORD])).toBe('BLOCK');
  });

  it('WARN 단어만 있으면 WARN이다', () => {
    expect(decide([WARN_WORD])).toBe('WARN');
  });

  it('매치가 없으면 PASS다', () => {
    expect(decide([])).toBe('PASS');
  });
});

describe('maskText — FR-12-40', () => {
  it('탐지된 단어를 원문 위치에서 *** 로 치환한다', () => {
    const matches = detect('이런 나쁜말이 섞인 문장', [BLOCK_WORD]);
    expect(maskText('이런 나쁜말이 섞인 문장', matches)).toBe('이런 ***이 섞인 문장');
  });

  it('매치가 없으면 원문을 그대로 반환한다', () => {
    expect(maskText('평범한 문장', [])).toBe('평범한 문장');
  });

  it('같은 단어가 여러 번 등장하면 전부 마스킹한다', () => {
    const matches = detect('나쁜말 나쁜말', [BLOCK_WORD]);
    expect(maskText('나쁜말 나쁜말', matches)).toBe('*** ***');
  });
});
