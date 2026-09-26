import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DegradePreview } from '@chat-bot/shared-types';
import { DegradePreviewNotice } from './DegradePreviewNotice';

function preview(overrides: Partial<DegradePreview> = {}): DegradePreview {
  return {
    channelType: 'KAKAOTALK',
    source: 'ASSUMED',
    outputs: [{ type: 'TEXT', payload: { text: '요약 텍스트' } }],
    changes: [{ outputIndex: 0, kind: 'CAROUSEL_TO_TEXT' }],
    ...overrides,
  };
}

describe('DegradePreviewNotice — RM-7(§3.7)', () => {
  it("'NOT_DEFINED'면 아무것도 렌더하지 않는다(하위 호환)", () => {
    const { container } = render(<DegradePreviewNotice preview="NOT_DEFINED" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('changes가 0건이면 아무것도 렌더하지 않는다(노이즈 방지)', () => {
    const { container } = render(<DegradePreviewNotice preview={preview({ changes: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('changes가 있으면 "예상 모습" 배지와 바뀐 점을 보여준다(ASSUMED)', () => {
    render(<DegradePreviewNotice preview={preview()} />);
    expect(screen.getByText('예상 모습(실제 규격 확인 전 추정)')).toBeInTheDocument();
    expect(screen.getByText('카드 대신 목록 텍스트로 보입니다.')).toBeInTheDocument();
  });

  it('MEASURED 소스는 "예상 모습" 배지가 없다', () => {
    render(<DegradePreviewNotice preview={preview({ source: 'MEASURED' })} />);
    expect(screen.queryByText(/예상 모습/)).not.toBeInTheDocument();
  });

  it('"실제 이 채널 모습 보기"를 누르면 강등된 outputs가 펼쳐진다', () => {
    render(<DegradePreviewNotice preview={preview()} />);
    expect(screen.queryByText('요약 텍스트')).not.toBeInTheDocument();

    const showButton = screen.getByRole('button', { name: '실제 이 채널 모습 보기 ▾' });
    expect(showButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(showButton);
    expect(screen.getByText('요약 텍스트')).toBeInTheDocument();

    const hideButton = screen.getByRole('button', { name: '실제 이 채널 모습 접기 ▴' });
    expect(hideButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hideButton);
    expect(screen.queryByText('요약 텍스트')).not.toBeInTheDocument();
  });
});
