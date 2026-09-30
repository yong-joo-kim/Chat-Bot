import { isLearningCandidate } from './learning-candidate';

describe('learning-candidate — 학습 후보 판정(설계서 §9.3)', () => {
  it('답하지 못했으면 점수와 무관하게 후보다', () => {
    expect(isLearningCandidate({ answered: false, top1Score: 0.99, threshold: 0.8 })).toBe(true);
    expect(isLearningCandidate({ answered: false, top1Score: null, threshold: 0 })).toBe(true);
  });

  it('답했어도 가장 비슷한 예문과의 점수가 기준 미만이면 후보다(경계 = 기준 이상은 후보 아님)', () => {
    expect(isLearningCandidate({ answered: true, top1Score: 0.79, threshold: 0.8 })).toBe(true);
    expect(isLearningCandidate({ answered: true, top1Score: 0.8, threshold: 0.8 })).toBe(false);
    expect(isLearningCandidate({ answered: true, top1Score: 0.95, threshold: 0.8 })).toBe(false);
  });

  it('의미 매칭이 꺼져 점수가 없으면 답함 여부만 본다', () => {
    expect(isLearningCandidate({ answered: true, top1Score: null, threshold: 0.8 })).toBe(false);
  });

  it('기준을 0으로 두면 "답하지 못한 발화만"이다', () => {
    expect(isLearningCandidate({ answered: true, top1Score: 0.01, threshold: 0 })).toBe(false);
    expect(isLearningCandidate({ answered: false, top1Score: 0.01, threshold: 0 })).toBe(true);
  });
});
