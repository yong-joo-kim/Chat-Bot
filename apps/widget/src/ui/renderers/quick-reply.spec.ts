// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ButtonItem } from '@chat-bot/shared-types';
import { renderQuickReplies } from './quick-reply';

describe('renderQuickReplies — RM-10(§3.10·§12.2)', () => {
  it('버튼마다 44px 이상의 <button>을 만들고 role=group·aria-label="바로 선택"이다', () => {
    const buttons: ButtonItem[] = [
      { label: '반품 문의', action: 'MESSAGE', value: '반품 문의' },
      { label: '교환 문의', action: 'MESSAGE', value: '교환 문의' },
    ];
    const group = renderQuickReplies(buttons, vi.fn());
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('바로 선택');
    const chips = group.querySelectorAll('button');
    expect(chips).toHaveLength(2);
    chips.forEach((c) => expect(c.tagName).toBe('BUTTON'));
  });

  it('클릭하면 onButtonAction으로 위임된다', () => {
    const onButtonAction = vi.fn();
    const buttons: ButtonItem[] = [{ label: '반품 문의', action: 'MESSAGE', value: '반품하고 싶어요' }];
    const group = renderQuickReplies(buttons, onButtonAction);
    (group.querySelector('button') as HTMLButtonElement).click();
    expect(onButtonAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MESSAGE', text: '반품하고 싶어요' }));
  });

  it('LINK 액션 버튼은 방어적으로 걸러진다(서버가 배치를 검증하지만 클라이언트도 방어)', () => {
    const buttons: ButtonItem[] = [
      { label: '반품 문의', action: 'MESSAGE', value: '반품 문의' },
      { label: '링크', action: 'LINK', value: 'https://example.com' },
    ];
    const group = renderQuickReplies(buttons, vi.fn());
    expect(group.querySelectorAll('button')).toHaveLength(1);
  });
});
