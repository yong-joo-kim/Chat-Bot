import { describe, expect, it } from 'vitest';
import { clampCardIndex, nearestCardIndex } from './carousel';

describe('core/carousel — 순수 함수(§12.1)', () => {
  it('nearestCardIndex는 스크롤 위치에 가장 가까운 카드를 고른다', () => {
    const offsets = [0, 240, 480, 720];
    expect(nearestCardIndex(0, offsets)).toBe(0);
    expect(nearestCardIndex(230, offsets)).toBe(1);
    expect(nearestCardIndex(500, offsets)).toBe(2);
    expect(nearestCardIndex(719, offsets)).toBe(3);
  });

  it('nearestCardIndex는 빈 배열이면 0을 반환한다', () => {
    expect(nearestCardIndex(100, [])).toBe(0);
  });

  it('clampCardIndex는 범위를 벗어나면 자른다', () => {
    expect(clampCardIndex(-1, 5)).toBe(0);
    expect(clampCardIndex(10, 5)).toBe(4);
    expect(clampCardIndex(2, 5)).toBe(2);
    expect(clampCardIndex(0, 0)).toBe(0);
  });
});
