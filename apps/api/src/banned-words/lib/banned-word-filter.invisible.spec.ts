import { decide, detect, maskText } from './banned-word-filter';
import type { BannedWordEntry } from './banned-word-filter';
import { normalizeText } from '@chat-bot/shared-types';

/**
 * N36-2 재현 시험 — 제로폭·삽입 문자로 금지어 탐지를 회피하지 못한다.
 * 공유 `normalizeText`는 그대로이고(저장 정규화 컬럼·해시 불변) 이 파일의 로컬 정규화만 강화한다.
 */
const ZW = ['\u200B', '\u200C', '\u200D', '\uFEFF', '\u00AD'];

const contains = (w: string): BannedWordEntry => ({ word: w, wordNormalized: normalizeText(w), matchType: 'CONTAINS', policy: 'BLOCK' });
const exact = (w: string): BannedWordEntry => ({ word: w, wordNormalized: normalizeText(w), matchType: 'EXACT', policy: 'BLOCK' });

describe('제로폭 문자 삽입 회피 차단(N36-2)', () => {
  it.each(ZW)('CONTAINS — 글자 사이에 U+%s 삽입해도 탐지한다', (z) => {
    expect(detect(`이건 금${z}지${z}어 입니다`, [contains('금지어')])).toHaveLength(1);
  });

  it.each(ZW)('CONTAINS — 앞뒤에 삽입해도 탐지한다', (z) => {
    expect(detect(`${z}금지어${z}`, [contains('금지어')])).toHaveLength(1);
  });

  it.each(ZW)('EXACT — 토큰 안 삽입(U+%s)도 탐지한다', (z) => {
    expect(detect(`이 단어 완${z}전${z}일치 입니다`, [exact('완전일치')])).toHaveLength(1);
  });

  it('decide — 삽입 회피 입력도 BLOCK', () => {
    expect(decide(detect('금\u200B지어', [contains('금지어')]))).toBe('BLOCK');
  });

  it('제로폭이 든 사전 항목(저장된 wordNormalized에 포함)도 동작한다 — 재저장·백필 불필요', () => {
    const stored: BannedWordEntry = { word: '금\u200B지어', wordNormalized: '금\u200B지어', matchType: 'CONTAINS', policy: 'BLOCK' };
    expect(detect('평범한 금지어 문장', [stored])).toHaveLength(1);
    expect(detect('금\u200C지어', [stored])).toHaveLength(1);
  });

  it('FEFF가 든 사전 항목(저장 정규화가 공백으로 바꿔 놓은 값)도 원문 word 기준으로 동작한다', () => {
    const stored: BannedWordEntry = { word: '금\uFEFF지어', wordNormalized: normalizeText('금\uFEFF지어'), matchType: 'CONTAINS', policy: 'BLOCK' };
    expect(detect('금지어', [stored])).toHaveLength(1);
  });

  it('보이지 않는 문자만으로 된 사전 항목은 모든 입력에 적중하지 않는다', () => {
    const empty: BannedWordEntry = { word: '\u200B', wordNormalized: '\u200B', matchType: 'CONTAINS', policy: 'BLOCK' };
    expect(detect('아무 문장', [empty])).toHaveLength(0);
  });

  it('제로폭이 없는 입력은 기존과 같다(무관한 문장은 그대로 통과)', () => {
    expect(detect('전혀 다른 문장', [contains('금지어')])).toHaveLength(0);
  });

  it('한글 결합 자모 등 일반 문자는 제거하지 않는다', () => {
    const e = contains('각');
    expect(detect('ᄀ\u1161ᆨ', [e])).toHaveLength(1); // NFKC가 결합 — 기존 동작 유지
  });
});

describe('maskText — 삽입 문자가 있어도 마스킹 위치가 어긋나지 않는다(N36-2)', () => {
  it('삽입 문자를 포함한 원문 구간만 *로 가린다', () => {
    const text = '앞 금\u200B지\u200C어 뒤';
    const out = maskText(text, detect(text, [contains('금지어')]));
    expect(out).toBe('앞 ***** 뒤');
  });

  it('앞쪽에 제로폭이 있어도 뒤쪽 위치가 밀리지 않는다', () => {
    const text = '\u200B\u200B가나 금지어 다라';
    const out = maskText(text, detect(text, [contains('금지어')]));
    expect(out).toBe('\u200B\u200B가나 *** 다라');
  });

  it('같은 단어가 여러 번이고 일부만 삽입되어도 모두 가린다', () => {
    const text = '금지어 금\u200B지어 금지어';
    const out = maskText(text, detect(text, [contains('금지어')]));
    expect(out).toBe('*** **** ***');
  });

  it('제로폭이 없는 텍스트는 기존 결과와 바이트 동일', () => {
    const text = '이런 나쁜말이 섞인 문장';
    expect(maskText(text, detect(text, [contains('나쁜말')]))).toBe('이런 ***이 섞인 문장');
  });
});

describe('공유 normalizeText 불변 보증(N36-2) — 저장 정규화 컬럼·해시 입력이 바뀌지 않는다', () => {
  it('normalizeText는 보이지 않는 문자를 그대로 둔다(탐지 경로에서만 로컬로 제거)', () => {
    expect(normalizeText('금\u200B지어')).toBe('금\u200B지어');
    expect(normalizeText('금\uFEFF지어')).toBe('금 지어'); // FEFF는 \s 로 공백 치환 — 기존 동작 그대로
    expect(normalizeText('  ABC  Def ')).toBe('abc def');
  });
});

describe('detect·maskText 제거 집합 대칭(N36-2 리뷰 보통-2)', () => {
  it('U+FFA0(반각 한글 채움 — NFKC가 U+1160을 만든다)를 끼워도 탐지와 마스킹이 함께 동작한다', () => {
    const text = '욕\uFFA0설 입니다';
    const dict = [contains('욕설')];
    const matches = detect(text, dict);
    expect(matches).toHaveLength(1);
    const masked = maskText(text, matches);
    expect(masked).toBe('*** 입니다');
    expect(masked).not.toContain('욕');
  });

  it('U+3164·U+115F·U+1160 채움 문자도 마스킹에서 새지 않는다', () => {
    for (const z of ['\u3164', '\u115F', '\u1160']) {
      const text = `욕${z}설 입니다`;
      expect(maskText(text, detect(text, [contains('욕설')]))).toBe('*** 입니다');
    }
  });
});

describe('빈 needle은 모든 입력에 적중하지 않는다(리뷰 낮음-4)', () => {
  it('wordNormalized가 이미 빈 항목(기존에는 모든 입력에 적중)도 적중하지 않는다', () => {
    const empty: BannedWordEntry = { word: '', wordNormalized: '', matchType: 'CONTAINS', policy: 'BLOCK' };
    expect(detect('아무 문장', [empty])).toHaveLength(0);
  });
});

describe('사전 변경 후 needle 갱신(리뷰 낮음-6 ⑤)', () => {
  it('항목을 새 객체로 교체(캐시 무효화 후 재적재)하면 새 표현 기준으로 탐지한다', () => {
    const before: BannedWordEntry = { word: '금지', wordNormalized: '금지', matchType: 'CONTAINS', policy: 'BLOCK' };
    expect(detect('새\u200B단어', [before])).toHaveLength(0);
    // 사전 수정 = 캐시 무효화 후 새 행에서 새 항목 객체 생성
    const after: BannedWordEntry = { word: '새\u200B단어', wordNormalized: '새\u200B단어', matchType: 'CONTAINS', policy: 'BLOCK' };
    expect(detect('새\u200B단어', [after])).toHaveLength(1);
    expect(detect('새단어', [after])).toHaveLength(1);
    // 이전 항목 객체의 캐시는 새 객체에 영향을 주지 않는다.
    expect(detect('새단어', [before])).toHaveLength(0);
  });
});
