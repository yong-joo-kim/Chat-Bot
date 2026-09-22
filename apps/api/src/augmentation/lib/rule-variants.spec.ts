import { generateRuleVariants, generateRuleVariantsForSeeds } from './rule-variants';

describe('generateRuleVariants (G1 규칙 기반 증강)', () => {
  it('종결형 변형을 만든다', () => {
    const out = generateRuleVariants('환불은 어떻게 하나요?', { synonyms: new Map() });
    expect(out.some((c) => c.technique === 'ENDING')).toBe(true);
    expect(out.every((c) => c.text !== '환불은 어떻게 하나요?')).toBe(true);
  });

  it('동의어 사전을 주입받아 치환한다', () => {
    const synonyms = new Map<string, readonly string[]>([['환불', ['반품', '취소']]]);
    const out = generateRuleVariants('환불 규정 안내', { synonyms });
    const texts = out.map((c) => c.text);
    expect(texts).toContain('반품 규정 안내');
    expect(texts).toContain('취소 규정 안내');
  });

  it('조사를 교체한다', () => {
    const out = generateRuleVariants('배송은 얼마나 걸리나요', { synonyms: new Map() });
    expect(out.some((c) => c.technique === 'JOSA' && c.text.startsWith('배송는'))).toBe(true);
  });

  it('경어·구어를 상호 변환한다', () => {
    const formal = generateRuleVariants('환불 규정을 받습니다', { synonyms: new Map() });
    expect(formal.some((c) => c.technique === 'REGISTER' && c.text === '환불 규정을 받해요')).toBe(true);

    const casual = generateRuleVariants('환불 규정이에요', { synonyms: new Map() });
    expect(casual.some((c) => c.technique === 'REGISTER' && c.text === '환불 규정입니다')).toBe(true);
  });

  it('빈 문자열은 후보 0건을 반환한다', () => {
    expect(generateRuleVariants('   ', { synonyms: new Map() })).toEqual([]);
  });

  it('같은 입력 → 같은 출력(결정론)', () => {
    const deps = { synonyms: new Map<string, readonly string[]>([['배송', ['택배']]]) };
    const a = generateRuleVariants('배송 조회 방법 안내', deps);
    const b = generateRuleVariants('배송 조회 방법 안내', deps);
    expect(a).toEqual(b);
  });

  it('중복 후보를 만들지 않는다(자기 자신 포함)', () => {
    const out = generateRuleVariants('환불은 어떻게 하나요?', { synonyms: new Map() });
    const texts = out.map((c) => c.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts).not.toContain('환불은 어떻게 하나요?');
  });
});

describe('generateRuleVariantsForSeeds', () => {
  it('여러 시드를 라운드로빈으로 섞어 targetCount까지 채운다', () => {
    const seeds = ['환불 규정 안내', '배송 조회 방법 안내'];
    const out = generateRuleVariantsForSeeds(seeds, { synonyms: new Map() }, 5);
    expect(out.length).toBeLessThanOrEqual(5);
    expect(new Set(out).size).toBe(out.length);
  });

  it('예문 0건(빈 시드 배열)이면 빈 배열을 반환한다', () => {
    expect(generateRuleVariantsForSeeds([], { synonyms: new Map() }, 5)).toEqual([]);
  });
});
