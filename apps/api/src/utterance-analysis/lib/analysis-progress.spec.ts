import { progressOf, stageRange } from './analysis-progress';

describe('analysis-progress — 단계 → 진행률(설계서 §8.1)', () => {
  const both = { probe: true, nameSuggest: true };
  const noProbe = { probe: false, nameSuggest: true };

  it('임베딩 0→60 · 묶기 60→75 · 키워드 75→80 · 대조 80→95 · 이름 제안 95→99 · 저장 100', () => {
    expect(stageRange('EMBEDDING', both)).toEqual({ from: 0, to: 60 });
    expect(stageRange('CLUSTERING', both)).toEqual({ from: 60, to: 75 });
    expect(stageRange('KEYWORDS', both)).toEqual({ from: 75, to: 80 });
    expect(stageRange('PROBING', both)).toEqual({ from: 80, to: 95 });
    expect(stageRange('NAMING', both)).toEqual({ from: 95, to: 99 });
    expect(stageRange('SAVING', both)).toEqual({ from: 99, to: 100 });
  });

  it('대조를 끄면 80→95 구간을 이름 제안이 이어받는다', () => {
    expect(stageRange('NAMING', noProbe)).toEqual({ from: 80, to: 99 });
  });

  it('단계 안 비율을 전체 진행률로 바꾸고 범위를 벗어난 값은 잘라낸다', () => {
    expect(progressOf('EMBEDDING', 0.5, both)).toBe(30);
    expect(progressOf('EMBEDDING', 2, both)).toBe(60);
    expect(progressOf('EMBEDDING', -1, both)).toBe(0);
    expect(progressOf('EMBEDDING', Number.NaN, both)).toBe(0);
    expect(progressOf('SAVING', 1, both)).toBe(100);
  });

  it('진행률은 단계 순서대로 단조 증가한다', () => {
    const order = ['EMBEDDING', 'CLUSTERING', 'KEYWORDS', 'PROBING', 'NAMING', 'SAVING'] as const;
    let prev = -1;
    for (const s of order) {
      const start = progressOf(s, 0, both);
      const end = progressOf(s, 1, both);
      expect(start).toBeGreaterThanOrEqual(prev);
      expect(end).toBeGreaterThanOrEqual(start);
      prev = end;
    }
  });
});
