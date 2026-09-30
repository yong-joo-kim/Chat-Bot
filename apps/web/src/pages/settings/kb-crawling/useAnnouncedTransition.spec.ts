import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAnnouncedTransition } from './useAnnouncedTransition';

describe('useAnnouncedTransition — 상태가 바뀔 때만 1회 낭독(No.43 → No.21에서 문구 주입으로 일반화)', () => {
  it('기본 문구(kbRuns.liveStatusChanged)는 기존 동작 그대로다', () => {
    const { result, rerender } = renderHook(({ label }) => useAnnouncedTransition(label), { initialProps: { label: '대기' } });
    expect(result.current).toBe('');

    rerender({ label: '수집 중' });
    expect(result.current).toBe('대기 → 수집 중');
  });

  it('두 번째 인자로 전환 문구 생성 함수를 바꿀 수 있고, 같은 값 재렌더에는 낭독하지 않는다', () => {
    const { result, rerender } = renderHook(({ label }) => useAnnouncedTransition(label, (a, b) => `${a}에서 ${b} 단계로 넘어갔습니다`), {
      initialProps: { label: '문장 분석' },
    });
    expect(result.current).toBe(''); // 최초 마운트 낭독 없음

    rerender({ label: '문장 분석' });
    expect(result.current).toBe('');

    rerender({ label: '묶기' });
    expect(result.current).toBe('문장 분석에서 묶기 단계로 넘어갔습니다');
  });

  it('빈 문자열(추적 대상 없음)에서 처음 값으로 가는 전환은 기준값 설정이라 낭독하지 않는다', () => {
    const { result, rerender } = renderHook(({ label }) => useAnnouncedTransition(label), { initialProps: { label: '' } });
    rerender({ label: '대기' });

    expect(result.current).toBe('');
  });
});
