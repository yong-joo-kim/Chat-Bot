import { decompose } from './decompose';
import { DEFAULT_STOPWORDS } from './stopwords';
import { JOSA_ENDINGS } from './josa-endings';
import type { MorphToken } from '../morph/morph-analyzer.port';

describe('decompose() — No.23 (A) 요소분해 순수 함수(ADR-0028 §3)', () => {
  const emptyDeps = { morphTokens: [] as MorphToken[], gazetteer: [], stopwords: DEFAULT_STOPWORDS, josaEndings: JOSA_ENDINGS };

  it('AC-L2-1 — gazetteer 동의어와 일치하면 matchedKeyword가 붙고, 조사만 남은 나머지는 IGNORED다', () => {
    const text = '해외로 반품 보낼 수 있나요';
    const spans = decompose(text, {
      ...emptyDeps,
      gazetteer: [{ keywordId: 'kw-1', name: '국가', surface: '해외', viaSynonym: true }],
    });

    const gukga = spans.find((s) => s.text === '해외');
    expect(gukga?.role).toBe('ENTITY_CANDIDATE');
    expect(gukga?.matchedKeyword).toEqual({ id: 'kw-1', name: '국가', viaSynonym: true });

    const josa = spans.find((s) => s.start === gukga!.end && s.text === '로');
    expect(josa?.role).toBe('IGNORED');
  });

  it('AC-L2-2 — 미등록 토큰은 matchedKeyword 없이 ENTITY_CANDIDATE로 분류된다', () => {
    const spans = decompose('반품 가능한가요', emptyDeps);
    const span = spans.find((s) => s.text === '반품');
    expect(span?.role).toBe('ENTITY_CANDIDATE');
    expect(span?.matchedKeyword).toBeUndefined();
  });

  it('종결 표현(예: "가능한가요")은 INTENT_SIGNAL로 분류된다', () => {
    const spans = decompose('반품 가능한가요', emptyDeps);
    const span = spans.find((s) => s.text === '가능한가요');
    expect(span?.role).toBe('INTENT_SIGNAL');
  });

  it('EX-L2-3 — gazetteer 최장일치가 결정론적이다(짧은 표제어가 긴 표제어를 가로채지 않는다)', () => {
    const spans = decompose('해외배송비 문의', {
      ...emptyDeps,
      gazetteer: [
        { keywordId: 'kw-short', name: '해외', surface: '해외', viaSynonym: false },
        { keywordId: 'kw-long', name: '해외배송', surface: '해외배송', viaSynonym: false },
      ],
    });
    const span = spans.find((s) => s.text.startsWith('해외'));
    expect(span?.matchedKeyword?.id).toBe('kw-long');
    expect(span?.text).toBe('해외배송');
  });

  it('형태소 토큰이 어절 단위로 겹치면(garu 한계) 어절 전체가 1스팬으로 유지된다', () => {
    // "해외로"의 두 형태소가 같은 [0,3) 범위를 공유하는 garu 한계를 흉내낸다.
    const morphTokens: MorphToken[] = [
      { surface: '해외', start: 0, end: 3, pos: 'NNG' },
      { surface: '로', start: 0, end: 3, pos: 'JX' },
    ];
    const spans = decompose('해외로', { ...emptyDeps, morphTokens });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ start: 0, end: 3, text: '해외로' });
  });

  it('형태소 분석기가 비어 있으면(morphTokens: []) 공백+조사 절단 폴백으로 동작한다', () => {
    const spans = decompose('배송비 얼마예요', emptyDeps);
    expect(spans.map((s) => s.text)).toContain('배송비');
  });

  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(decompose('', emptyDeps)).toEqual([]);
  });

  it('숫자만 있는 토큰은 IGNORED다', () => {
    const spans = decompose('123 문의', emptyDeps);
    const span = spans.find((s) => s.text === '123');
    expect(span?.role).toBe('IGNORED');
  });

  it('스팬은 원문 순서(start 오름차순)로 정렬되어 반환된다', () => {
    const spans = decompose('해외 반품 문의', {
      ...emptyDeps,
      gazetteer: [{ keywordId: 'kw-1', name: '국가', surface: '해외', viaSynonym: false }],
    });
    const starts = spans.map((s) => s.start);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
