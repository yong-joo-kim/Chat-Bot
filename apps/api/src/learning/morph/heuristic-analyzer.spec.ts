import { HeuristicAnalyzer } from './heuristic-analyzer';

describe('HeuristicAnalyzer (M0)', () => {
  const analyzer = new HeuristicAnalyzer();

  it('항상 ready=true다(의존성 0)', () => {
    expect(analyzer.ready).toBe(true);
    expect(analyzer.analyzerId).toBe('heuristic@0');
  });

  it('공백으로 어절을 나누고 조사를 접미 절단한다', () => {
    const tokens = analyzer.analyze('해외로 반품 보낼 수 있나요');
    const surfaces = tokens.map((t) => t.surface);
    expect(surfaces).toContain('해외');
    expect(surfaces).toContain('로');
  });

  it('오프셋이 원문과 정확히 일치한다(문자 단위)', () => {
    const text = '해외로 반품 보낼 수 있나요';
    const tokens = analyzer.analyze(text);
    for (const t of tokens) {
      expect(text.slice(t.start, t.end)).toBe(t.surface);
    }
  });

  it('조사가 없는 어절은 통째로 1개 토큰이다', () => {
    const tokens = analyzer.analyze('안녕하세요');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].surface).toBe('안녕하세요');
  });

  it('빈 문자열은 빈 배열을 반환한다', () => {
    expect(analyzer.analyze('')).toEqual([]);
  });

  it('연속 공백을 안전하게 처리한다', () => {
    const text = '해외   배송비';
    const tokens = analyzer.analyze(text);
    const surfaces = tokens.map((t) => t.surface);
    expect(surfaces).toContain('해외');
    expect(surfaces).toContain('배송비');
  });
});
