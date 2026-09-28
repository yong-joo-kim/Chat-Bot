import { KbHostPacer } from './kb-host-pacer';

describe('KbHostPacer — 호스트별 간격(pass 6 · RG-17)', () => {
  it('release 뒤에는 간격이 지나야 준비되고, 남은 지연(msUntilReady)을 알려 준다', () => {
    const p = new KbHostPacer();
    expect(p.msUntilReady('a', 1000)).toBe(0);
    p.acquire('a');
    p.release('a', 1000, 500);
    expect(p.msUntilReady('a', 1000)).toBe(500);
    expect(p.msUntilReady('a', 1300)).toBe(200);
    expect(p.msUntilReady('a', 1500)).toBe(0);
    expect(p.isReady('a', 1499)).toBe(false);
    expect(p.isReady('a', 1500)).toBe(true);
  });

  it('호스트마다 따로다(다른 호스트는 기다리지 않는다)', () => {
    const p = new KbHostPacer();
    p.release('a', 0, 10_000);
    expect(p.msUntilReady('b', 0)).toBe(0);
  });

  it('다른 요청이 호스트를 쥐고 있으면(acquire ~ release) 잠깐 뒤 다시 확인하도록 양수를 돌려준다(동시 연결 1)', () => {
    const p = new KbHostPacer();
    p.acquire('a');
    expect(p.msUntilReady('a', 0)).toBeGreaterThan(0);
    p.release('a', 0, 0);
    expect(p.msUntilReady('a', 0)).toBe(0);
  });

  it('시계·대기는 교체할 수 있다(시험은 가짜 시계를 끼운다) — 기본은 실시계', () => {
    const p = new KbHostPacer();
    expect(Math.abs(p.now() - Date.now())).toBeLessThan(50);
    let t = 100;
    p.now = () => t;
    p.sleep = async (ms) => {
      t += ms;
    };
    void p.sleep(250);
    expect(p.now()).toBe(350);
  });

  it('호스트 항목이 500개를 넘으면 이미 지난 항목을 정리한다(RG-20⑦)', () => {
    const p = new KbHostPacer();
    for (let i = 0; i < 600; i += 1) p.release(`h${i}`, 0, 10);
    p.release('last', 1_000, 10); // 앞의 항목은 다음 가능 시각(10)이 지났다
    const size = (p as unknown as { nextAllowedAt: Map<string, number> }).nextAllowedAt.size;
    expect(size).toBeLessThan(50);
  });
});
