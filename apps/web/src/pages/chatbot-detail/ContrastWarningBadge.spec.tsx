import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContrastWarningBadge } from './ContrastWarningBadge';

/** AC-4-3: 대비 4.5:1 미만일 때만 경고 배지가 노출되고, 저장을 막지 않는(배지만 표시) 형태여야 한다. */
describe('ContrastWarningBadge', () => {
  it('대비 기준을 만족하는 색상에서는 아무것도 렌더링하지 않는다', () => {
    const { container } = render(<ContrastWarningBadge primaryColor="#4F46E5" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('대비 기준(4.5:1) 미달 색상에서는 경고 배지와 대비 수치, 대안을 표시한다', () => {
    render(<ContrastWarningBadge primaryColor="#FFF176" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('⚠ 헤더 텍스트(흰색) 대비');
    expect(badge).toHaveTextContent('— 기준(4.5:1) 미달');
    expect(badge).toHaveTextContent('권장: 검정 텍스트로 전환');
  });
});
