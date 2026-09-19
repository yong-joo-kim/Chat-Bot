import { describe, expect, it } from 'vitest';
import { contrastRatio, evaluateHeaderContrast } from './contrast';

/**
 * FR-4-6/AC-4-3/NFR-A1 대비 경고 배지 노출 조건의 핵심 로직.
 * code-reviewer 지목 항목 (d) "스킨 대비 경고 배지 노출 조건"의 순수 함수 커버리지.
 */
describe('contrastRatio', () => {
  it('흰색과 검정의 대비는 21:1이다(WCAG 최대값)', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });

  it('동일 색상의 대비는 1:1이다', () => {
    expect(contrastRatio('#4F46E5', '#4F46E5')).toBeCloseTo(1, 5);
  });

  it('잘못된 hex 형식이면 null을 반환한다', () => {
    expect(contrastRatio('blue', '#FFFFFF')).toBeNull();
    expect(contrastRatio('#GGGGGG', '#FFFFFF')).toBeNull();
  });
});

describe('evaluateHeaderContrast — AC-4-3', () => {
  it('기본 브랜드 색상(#4F46E5)은 흰 텍스트 대비 기준(4.5:1)을 통과한다', () => {
    const result = evaluateHeaderContrast('#4F46E5');
    expect(result).not.toBeNull();
    expect(result!.passes).toBe(true);
    expect(result!.suggestedTextColor).toBe('white');
  });

  it('밝은 색(#FFF176)은 흰 텍스트 대비 기준 미달로 판정되고 검정 텍스트를 권장한다(AC-4-3 예시)', () => {
    const result = evaluateHeaderContrast('#FFF176');
    expect(result).not.toBeNull();
    expect(result!.passes).toBe(false);
    expect(result!.suggestedTextColor).toBe('black');
    // ratio는 실제 적용을 권장하는 색(검정) 기준 대비 수치를 담으므로 4.5 이상일 수 있다.
    // '기준 미달'은 passes(흰 텍스트 가정) 플래그로만 판단한다.
  });

  it('경계값: 흰 텍스트 대비가 정확히 4.5 이상이면 통과로 판정한다', () => {
    // #767676 on #FFFFFF는 WCAG 예시에서 정확히 4.5:1 경계로 알려진 값이다.
    const result = evaluateHeaderContrast('#767676');
    expect(result).not.toBeNull();
    expect(result!.passes).toBe(true);
  });

  it('색상 형식이 잘못되면 null을 반환해 배지가 렌더링되지 않게 한다', () => {
    expect(evaluateHeaderContrast('not-a-color')).toBeNull();
  });
});
