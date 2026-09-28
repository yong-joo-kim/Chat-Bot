import { setBounded } from './bounded-map';

describe('setBounded — 인스턴스 메모리 맵 상한(RG-20⑦)', () => {
  it('상한을 넘으면 가장 오래된 항목부터 버린다', () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 10; i += 1) setBounded(m, `k${i}`, i, 3);
    expect([...m.keys()]).toEqual(['k7', 'k8', 'k9']);
  });
  it('이미 있는 키를 다시 쓰면 가장 최근으로 옮겨 버려지지 않는다', () => {
    const m = new Map<string, number>();
    setBounded(m, 'a', 1, 2);
    setBounded(m, 'b', 2, 2);
    setBounded(m, 'a', 3, 2); // a가 가장 최근이 된다
    setBounded(m, 'c', 4, 2); // b가 버려진다
    expect([...m.entries()]).toEqual([
      ['a', 3],
      ['c', 4],
    ]);
  });
  it('상한 안이면 아무것도 버리지 않는다', () => {
    const m = new Map<number, number>();
    for (let i = 0; i < 5; i += 1) setBounded(m, i, i, 5);
    expect(m.size).toBe(5);
  });
});
