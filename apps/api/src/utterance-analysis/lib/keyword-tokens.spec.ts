import { maskPii } from '@chat-bot/pii-mask';
import type { MorphAnalyzerPort, MorphToken } from '../../learning/morph/morph-analyzer.port';
import { extractKeywordTerms, isExcludedTerm } from './keyword-tokens';

/**
 * garu-ko@0.9.18 실측 출력(2026-09-30 스크래치 스크립트로 실제 호출한 값 — 태그 확인 근거).
 * jest 환경에서는 ESM 동적 import가 안 되어 실제 garu를 로드할 수 없으므로 기록된 출력을 재생한다.
 */
const GARU: Record<string, Array<[string, string]>> = {
  'ATM에서 카드가 안 나와요': [['ATM', 'SL'], ['에서', 'JKB'], ['카드', 'NNG'], ['가', 'JKS'], ['안', 'MAG'], ['나오', 'VV'], ['아요', 'EF']],
  '환불 받고 싶은데 어떻게 하나요?': [['환불', 'NNG'], ['받', 'VV'], ['고', 'EC'], ['싶', 'VX'], ['은데', 'EC'], ['어떻', 'VA'], ['게', 'EC'], ['하', 'VV'], ['나요', 'EF'], ['?', 'SF']],
  '간편 결제 조건이 궁금합니다': [['간편', 'XR'], ['결제', 'NNG'], ['조건', 'NNG'], ['이', 'JKS'], ['궁금하', 'VA'], ['ㅂ니다', 'EF']],
  '아이폰15 요금제 변경 가능한가요': [['아이폰', 'NNP'], ['15', 'SN'], ['요금', 'NNG'], ['제', 'XSN'], ['변경', 'NNG'], ['가능', 'NNG'], ['하', 'XSA'], ['ㄴ가요', 'EF']],
  '너무 좋아요 ㅋㅋ 감사합니다': [['너무', 'MAG'], ['좋', 'VA'], ['아요', 'EF'], ['ㅋ', 'NNG'], ['ㅋ', 'NNG'], ['감사', 'NNG'], ['하', 'XSV'], ['ㅂ니다', 'EF']],
  '저는 그것이 무엇인지 모르겠어요': [['저', 'NP'], ['는', 'JX'], ['그것', 'NP'], ['이', 'JKS'], ['무엇', 'NP'], ['이', 'VCP'], ['ㄴ지', 'EC'], ['모르', 'VV'], ['겠', 'EP'], ['어요', 'EF']],
  '세 개 주문 첫째 항목': [['세', 'MM'], ['개', 'NNB'], ['주문', 'NNG'], ['첫째', 'NR'], ['항목', 'NNG']],
  '결제 결제 취소': [['결제', 'NNG'], ['결제', 'NNG'], ['취소', 'NNG']],
};

function fakeGaru(): Pick<MorphAnalyzerPort, 'analyze'> {
  return {
    analyze(text: string): readonly MorphToken[] {
      const rows = GARU[text];
      if (!rows) throw new Error(`기록되지 않은 문장: ${text}`);
      return rows.map(([surface, pos]) => ({ surface, pos, start: 0, end: surface.length }));
    },
  };
}

/** 공백 분할 + 모두 NNG로 태깅 — 마스킹 표식이 분석기에 들어가면 그대로 후보가 되므로 제거 여부를 드러낸다. */
const naive: Pick<MorphAnalyzerPort, 'analyze'> = {
  analyze: (text) => text.split(/\s+/).filter(Boolean).map((surface) => ({ surface, pos: 'NNG', start: 0, end: surface.length })),
};

describe('extractKeywordTerms', () => {
  it('명사만(기본): NNG·NNP·SL만 남고 동사·형용사·부사·조사·어미·숫자·대명사·의존명사는 빠진다', () => {
    expect(extractKeywordTerms('ATM에서 카드가 안 나와요', fakeGaru())).toEqual(['atm', '카드']);
    expect(extractKeywordTerms('환불 받고 싶은데 어떻게 하나요?', fakeGaru())).toEqual(['환불']);
    expect(extractKeywordTerms('아이폰15 요금제 변경 가능한가요', fakeGaru())).toEqual(['아이폰', '요금', '변경', '가능']);
    expect(extractKeywordTerms('저는 그것이 무엇인지 모르겠어요', fakeGaru())).toEqual([]);
    expect(extractKeywordTerms('세 개 주문 첫째 항목', fakeGaru())).toEqual(['주문', '항목']);
  });

  it('명사만 끔: 동사·형용사 어간(VV·VA)과 어근(XR)이 추가된다', () => {
    const on = { nounsOnly: false };
    expect(extractKeywordTerms('환불 받고 싶은데 어떻게 하나요?', fakeGaru(), on)).toEqual(['환불', '어떻']); // '받'은 한 글자 어간이라 제외(한 글자 규칙 — 동사 어간은 1음절이 많다)
    expect(extractKeywordTerms('간편 결제 조건이 궁금합니다', fakeGaru(), on)).toEqual(['간편', '결제', '조건', '궁금하']);
    expect(extractKeywordTerms('간편 결제 조건이 궁금합니다', fakeGaru())).toEqual(['결제', '조건']);
  });

  it('한글 한 글자·자모(ㅋ)·불용어는 제외하고, 발화 안 중복은 1회다', () => {
    expect(extractKeywordTerms('너무 좋아요 ㅋㅋ 감사합니다', fakeGaru())).toEqual(['감사']);
    expect(extractKeywordTerms('결제 결제 취소', fakeGaru())).toEqual(['결제', '취소']);
  });

  it('마스킹 결합: 마스킹 출력(PARTIAL·FULL)의 표식은 분석기에 들어가기 전에 제거된다', () => {
    for (const mode of ['PARTIAL', 'FULL'] as const) {
      const masked = maskPii('010-1234-5678 번호로 해지 문의 abcdef@example.com', { mode }).maskedText;
      const terms = extractKeywordTerms(masked, naive);
      expect(terms).toEqual(['번호로', '해지', '문의']);
      for (const t of terms) expect(t).not.toMatch(/[*\[\]]|전화번호|이메일|\d/);
    }
    expect(extractKeywordTerms('이 ** 정말 싫어요', naive)).toEqual(['정말', '싫어요']);
  });

  it('표식만 있는 문장은 후보 0개', () => {
    expect(extractKeywordTerms(maskPii('010-1234-5678', { mode: 'FULL' }).maskedText, naive)).toEqual([]);
  });

  it('휴리스틱 분석기 폴백(UNK 어간)도 후보로 인정한다', () => {
    const heuristic: Pick<MorphAnalyzerPort, 'analyze'> = {
      analyze: () => [
        { surface: '배송', start: 0, end: 2, pos: 'UNK' },
        { surface: '이', start: 2, end: 3, pos: 'JX' },
      ],
    };
    expect(extractKeywordTerms('배송이', heuristic)).toEqual(['배송']);
  });
});

describe('isExcludedTerm', () => {
  it('제외 규칙(§6.1 ④)', () => {
    for (const t of ['', '1234', '가', 'ㅋ', '이거', '그냥', '에서', '으로부터', 'a*b']) expect(isExcludedTerm(t)).toBe(true);
    for (const t of ['환불', 'atm', '카드3']) expect(isExcludedTerm(t)).toBe(false);
  });
});
