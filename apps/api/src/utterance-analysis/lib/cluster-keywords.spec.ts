import { autoClusterName, computeClusterKeywords } from './cluster-keywords';

describe('computeClusterKeywords (c-TF-IDF, §6.2)', () => {
  const docs = (...rows: string[][]) => rows;

  it('그 묶음에서 자주 나오고 다른 묶음에서 드문 단어가 먼저다', () => {
    const [a, b] = computeClusterKeywords(
      [
        { docs: docs(['환불', '주문'], ['환불', '카드'], ['환불', '주문'], ['환불']) },
        { docs: docs(['배송', '주문'], ['배송', '지연'], ['배송', '주문'], ['배송']) },
      ],
      3,
    );
    // '주문'은 양쪽에 있어 점수가 낮다 → 묶음 고유 단어가 앞
    expect(a[0].term).toBe('환불');
    expect(b[0].term).toBe('배송');
    expect(a.find((k) => k.term === '주문')!.score).toBeLessThan(a[0].score);
    expect(a[0]).toEqual({ term: '환불', score: expect.any(Number), count: 4 });
  });

  it('점수 공식: (tf/|c|) × ln(1 + A/f) — 소수 4자리', () => {
    const [a] = computeClusterKeywords(
      [
        { docs: docs(['가나'], ['가나'], ['가나'], ['다라']) }, // |c|=4, tf(가나)=3
        { docs: docs(['마바'], ['마바'], ['마바'], ['마바']) },
      ],
      5,
    );
    const A = 8 / 2;
    const expected = Math.round((3 / 4) * Math.log(1 + A / 3) * 10000) / 10000;
    expect(a[0]).toEqual({ term: '가나', score: expected, count: 3 });
  });

  it('후보 조건: 묶음 발화가 4개 이상이면 tf ≥ 2, 4개 미만이면 tf ≥ 1', () => {
    const [big, small] = computeClusterKeywords(
      [
        { docs: docs(['공통', '하나'], ['공통', '둘'], ['공통', '셋'], ['공통', '넷']) },
        { docs: docs(['희귀'], ['희귀2']) },
      ],
      10,
    );
    expect(big.map((k) => k.term)).toEqual(['공통']); // 한 문장에만 나온 단어는 제외
    expect(small.map((k) => k.term).sort()).toEqual(['희귀', '희귀2']);
  });

  it('발생 횟수를 쓰지 않는다 — 입력은 고유 발화뿐이며 같은 결과가 재현된다', () => {
    const input = [{ docs: docs(['가나', '다라'], ['가나']) }, { docs: docs(['마바', '사아'], ['마바']) }];
    expect(computeClusterKeywords(input, 5)).toEqual(computeClusterKeywords(input, 5));
  });

  it('동점 정렬: 점수 → tf → 용어 순(코드 유닛)', () => {
    const [a] = computeClusterKeywords([{ docs: docs(['나', '가'], ['가', '나']) }], 5);
    expect(a.map((k) => k.term)).toEqual(['가', '나']);
  });

  it('상위 keywordCount개만, 0개·빈 묶음은 빈 배열', () => {
    const many = { docs: docs(['a1', 'a2', 'a3'], ['a1', 'a2', 'a3']) };
    expect(computeClusterKeywords([many], 2)[0]).toHaveLength(2);
    expect(computeClusterKeywords([many], 0)[0]).toEqual([]);
    expect(computeClusterKeywords([{ docs: [] }], 3)[0]).toEqual([]);
  });

  it('발화 안 중복 용어는 1표로 센다', () => {
    const [a] = computeClusterKeywords([{ docs: docs(['가나', '가나'], ['다라']) }], 5);
    expect(a.find((k) => k.term === '가나')!.count).toBe(1);
  });
});

describe('autoClusterName (FR-DC4-3)', () => {
  it('상위 3개를 " · "로 잇고, 키워드 0개면 "묶음 N", 미분류는 고정', () => {
    const kw = ['가', '나', '다', '라'].map((term) => ({ term, score: 1, count: 2 }));
    expect(autoClusterName(kw, 1, false)).toBe('가 · 나 · 다');
    expect(autoClusterName([], 4, false)).toBe('묶음 4');
    expect(autoClusterName(kw, 9, true)).toBe('미분류');
  });
});
