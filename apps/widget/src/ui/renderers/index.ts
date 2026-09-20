import type { ButtonActionView, OutputView } from '@chat-bot/shared-types/output-view';
import { renderText } from './text';
import { renderCard } from './card';
import { renderImage } from './image';
import { renderButtonBlock } from './button';
import { renderLink } from './link';
import { renderPhoneCall } from './phone-call';

export { renderButtonGroup } from './button';

/** 아웃풋 1건 → DOM 노드(FR-W-5). `PAUSE`는 요소를 만들지 않는다(`message-list.ts`가 지연만 처리). */
export function renderOutputView(view: OutputView, onButtonAction: (action: ButtonActionView) => void): HTMLElement | null {
  switch (view.type) {
    case 'TEXT':
      return renderText(view.payload.text);
    case 'CARD':
      return renderCard(view.payload, onButtonAction);
    case 'IMAGE':
      return renderImage(view.payload);
    case 'BUTTON':
      return renderButtonBlock(view.payload, onButtonAction);
    case 'LINK':
      return renderLink(view.payload);
    case 'PHONE_CALL':
      return renderPhoneCall(view.payload);
    case 'PAUSE':
      return null;
    default:
      return null;
  }
}
