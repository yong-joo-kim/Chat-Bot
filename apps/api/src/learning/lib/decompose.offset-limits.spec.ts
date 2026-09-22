import { decompose } from './decompose';
import { DEFAULT_STOPWORDS } from './stopwords';
import { JOSA_ENDINGS } from './josa-endings';
import type { MorphToken } from '../morph/morph-analyzer.port';

/**
 * `decompose()` — gazetteer 우선순위 및 어절 단위 오프셋 한계 보강 테스트.
 * `decompose.spec.ts`(기존, 재작성 금지)가 이미 다루는 "최장일치 우선"·"어절 겹침 시 통째 유지"
 * 기본 케이스를 보완해, **부분 겹침**(gazetteer 스팬이 형태소 토큰의 일부만 덮는 경우)의 동작을
 * 명시적으로 고정한다 — 이 함수의 문서화된 한계(`morphTokens`가 어절 단위 오프셋이라는 전제)가
 * 실제로 어떻게 나타나는지 보여준다.
 */
describe('decompose() — gazetteer 우선순위 · 어절 단위 오프셋 한계 보강(ADR-0028 §3)', () => {
  const emptyDeps = { morphTokens: [] as MorphToken[], gazetteer: [], stopwords: DEFAULT_STOPWORDS, josaEndings: JOSA_ENDINGS };

  it('⚠ 오프셋 한계 — gazetteer 스팬이 형태소(폴백 어절) 토큰의 일부만 덮으면, 그 어절 전체가 통째로 스킵되어 나머지 부분(접두/접미)은 별도 스팬으로 복원되지 않는다', () => {
    // "해외배송비 문의"(공백 폴백 토큰화 시 "해외배송비"가 하나의 어절 토큰) 중간의 "배송"만
    // gazetteer에 등록된 상황 — "해외"(접두)·"비"(접미)는 별도 스팬으로 나타나지 않는다(어절
    // 단위 오프셋 한계, morph-analyzer.port.ts 문서와 동일 계열의 제약).
    const spans = decompose('해외배송비 문의', {
      ...emptyDeps,
      gazetteer: [{ keywordId: 'kw-1', name: '배송', surface: '배송', viaSynonym: false }],
    });

    const matched = spans.find((s) => s.text === '배송');
    expect(matched?.matchedKeyword?.id).toBe('kw-1');

    // "해외"·"비"는 독립 스팬으로 존재하지 않는다(어절 전체가 gazetteer와 겹쳐 스킵됐기 때문).
    expect(spans.find((s) => s.text === '해외')).toBeUndefined();
    expect(spans.find((s) => s.text === '비')).toBeUndefined();
    // 뒤 어절("문의")은 앞 어절의 부분 겹침과 무관하게 정상적으로 계속 분해된다(조사 "의" 절단 폴백).
    expect(spans.some((s) => s.text === '문')).toBe(true);
    expect(spans.some((s) => s.text === '의' && s.role === 'IGNORED')).toBe(true);
  });

  it('gazetteer 항목 길이가 동일하면 배열에 먼저 등장한 항목이 채택된다(결정론 — stable sort)', () => {
    const spans = decompose('해외', {
      ...emptyDeps,
      gazetteer: [
        { keywordId: 'kw-first', name: '해외1', surface: '해외', viaSynonym: false },
        { keywordId: 'kw-second', name: '해외2', surface: '해외', viaSynonym: false },
      ],
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].matchedKeyword?.id).toBe('kw-first');
  });

  it('같은 gazetteer 표제어가 문장에 두 번 등장하면 두 번 모두 스팬으로 잡힌다', () => {
    const spans = decompose('해외 배송 후 해외 반품', {
      ...emptyDeps,
      gazetteer: [{ keywordId: 'kw-1', name: '국가', surface: '해외', viaSynonym: false }],
    });
    const matches = spans.filter((s) => s.text === '해외');
    expect(matches).toHaveLength(2);
    expect(matches.every((s) => s.matchedKeyword?.id === 'kw-1')).toBe(true);
  });

  it('형태소 토큰의 start/end가 원문 범위를 벗어나면(분석기 이상값) 해당 토큰은 조용히 무시된다', () => {
    const morphTokens: MorphToken[] = [
      { surface: '해외', start: 0, end: 2, pos: 'NNG' },
      { surface: '오류', start: 5, end: 999, pos: 'UNK' }, // 원문 길이(2)를 벗어난 비정상 토큰
    ];
    const spans = decompose('해외', { ...emptyDeps, morphTokens });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe('해외');
  });

  it('gazetteer 스팬이 형태소 토큰과 정확히 같은 경계를 공유하면(완전 일치) 형태소 스팬은 중복 생성되지 않는다', () => {
    const morphTokens: MorphToken[] = [{ surface: '해외', start: 0, end: 2, pos: 'NNG' }];
    const spans = decompose('해외', {
      ...emptyDeps,
      morphTokens,
      gazetteer: [{ keywordId: 'kw-1', name: '국가', surface: '해외', viaSynonym: false }],
    });
    // gazetteer 스팬 1개만 남고, 형태소 스팬이 같은 구간에 중복으로 추가되지 않는다.
    expect(spans).toHaveLength(1);
    expect(spans[0].matchedKeyword?.id).toBe('kw-1');
  });
});
