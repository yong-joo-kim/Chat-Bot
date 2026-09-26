import { describe, expect, it } from 'vitest';
import type { OutputView } from '@chat-bot/shared-types/output-view';
import { splitQuickReply } from './quick-reply';

function textView(text: string): OutputView {
  return { type: 'TEXT', payload: { text } };
}

function quickReplyView(label: string): OutputView {
  return { type: 'BUTTON', payload: { buttons: [{ label, action: 'MESSAGE', value: label }], display: 'QUICK_REPLY' } };
}

describe('core/quick-reply — splitQuickReply(EX-RM-11)', () => {
  it('바로연결이 없으면 그대로 반환하고 quickReply는 null이다', () => {
    const views = [textView('안녕하세요')];
    const result = splitQuickReply(views);
    expect(result.quickReply).toBeNull();
    expect(result.views).toEqual(views);
  });

  it('바로연결이 1개면 칩으로 분리하고 메인 흐름에서 제거한다', () => {
    const qr = quickReplyView('반품 문의');
    const views = [textView('무엇을 도와드릴까요?'), qr];
    const result = splitQuickReply(views);
    expect(result.quickReply).toBe(qr);
    expect(result.views).toEqual([textView('무엇을 도와드릴까요?')]);
  });

  it('바로연결이 2개 이상이면 마지막만 칩이 되고 앞선 것은 display 없는 일반 버튼으로 남는다', () => {
    const first = quickReplyView('첫번째');
    const second = quickReplyView('두번째');
    const views = [first, second];
    const result = splitQuickReply(views);
    expect(result.quickReply).toBe(second);
    expect(result.views).toHaveLength(1);
    const remaining = result.views[0];
    expect(remaining.type).toBe('BUTTON');
    if (remaining.type === 'BUTTON') {
      expect(remaining.payload.display).toBeUndefined();
      expect(remaining.payload.buttons[0].label).toBe('첫번째');
    }
  });

  it('display가 없는 일반 BUTTON은 건드리지 않는다', () => {
    const normalButton: OutputView = { type: 'BUTTON', payload: { buttons: [{ label: '일반', action: 'MESSAGE', value: '일반' }] } };
    const result = splitQuickReply([normalButton]);
    expect(result.quickReply).toBeNull();
    expect(result.views).toEqual([normalButton]);
  });
});
