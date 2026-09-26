import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { DialogOutput } from '@chat-bot/shared-types';
import { OutputRenderer } from './OutputRenderer';

function carouselOutput(cards: Array<{ title: string }>): DialogOutput {
  return { type: 'CAROUSEL', payload: { version: 1, cards } } as DialogOutput;
}

function quickReplyOutput(labels: string[]): DialogOutput {
  return {
    type: 'BUTTON',
    payload: { buttons: labels.map((label) => ({ label, action: 'MESSAGE', value: label })), display: 'QUICK_REPLY' },
  } as DialogOutput;
}

describe('OutputRenderer — CAROUSEL(RM-3·RM-6)', () => {
  it('카드마다 output-carousel-card를 렌더하고 위치 텍스트를 보여준다', () => {
    const { container } = render(
      <OutputRenderer outputs={[carouselOutput([{ title: '스타터' }, { title: '스탠다드' }])]} onButtonClick={vi.fn()} />,
    );
    expect(container.querySelectorAll('.output-carousel-card')).toHaveLength(2);
    expect(container.querySelector('.output-carousel-nav span')?.textContent).toBe('1 / 2');
  });

  it('다음 버튼 클릭 시 위치 텍스트가 갱신된다', () => {
    const { container } = render(
      <OutputRenderer outputs={[carouselOutput([{ title: 'A' }, { title: 'B' }, { title: 'C' }])]} onButtonClick={vi.fn()} />,
    );
    const next = container.querySelector('.output-carousel-nav-btn[aria-label="다음 카드"]') as HTMLButtonElement;
    fireEvent.click(next);
    expect(container.querySelector('.output-carousel-nav span')?.textContent).toBe('2 / 3');
  });
});

describe('OutputRenderer — 바로연결 칩(RM-3·RM-6)', () => {
  it('말풍선 아래 칩 묶음을 렌더한다', () => {
    const { container } = render(<OutputRenderer outputs={[quickReplyOutput(['반품 문의', '교환 문의'])]} onButtonClick={vi.fn()} />);
    const group = container.querySelector('.output-quick-replies');
    expect(group).not.toBeNull();
    expect(group?.querySelectorAll('button')).toHaveLength(2);
  });

  it('hideQuickReply=true면 칩 묶음을 렌더하지 않는다(사용 후 숨김, D-4)', () => {
    const { container } = render(
      <OutputRenderer outputs={[quickReplyOutput(['반품 문의'])]} onButtonClick={vi.fn()} hideQuickReply />,
    );
    expect(container.querySelector('.output-quick-replies')).toBeNull();
  });

  it('한 턴에 바로연결이 2개면 마지막만 칩이고 앞선 것은 일반 버튼으로 보인다(EX-RM-11)', () => {
    const outputs: DialogOutput[] = [quickReplyOutput(['첫번째']), quickReplyOutput(['두번째'])];
    const { container } = render(<OutputRenderer outputs={outputs} onButtonClick={vi.fn()} />);
    const chipGroup = container.querySelector('.output-quick-replies');
    expect(chipGroup?.textContent).toBe('두번째');
    const inlineBlock = container.querySelector('.output-button-block');
    expect(inlineBlock?.textContent).toContain('첫번째');
  });

  it('칩 클릭은 onButtonClick으로 위임된다', () => {
    const onButtonClick = vi.fn();
    const { container } = render(<OutputRenderer outputs={[quickReplyOutput(['반품 문의'])]} onButtonClick={onButtonClick} />);
    fireEvent.click(container.querySelector('.output-quick-reply') as HTMLButtonElement);
    expect(onButtonClick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MESSAGE', text: '반품 문의' }));
  });
});
