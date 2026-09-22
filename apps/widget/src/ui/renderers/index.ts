import type { ButtonActionView, OutputView } from '@chat-bot/shared-types/output-view';
import { renderText } from './text';
import { renderCard } from './card';
import { renderImage } from './image';
import { renderButtonBlock, type ButtonGroupOptions } from './button';
import { renderLink } from './link';
import { renderPhoneCall } from './phone-call';

export { renderButtonGroup, type ButtonGroupOptions } from './button';

/**
 * 아웃풋 1건 → DOM 노드(FR-W-5). `PAUSE`는 요소를 만들지 않는다(`message-list.ts`가 지연만 처리).
 * `buttonGroupOptions`는 최상위 `BUTTON` 아웃풋에만 적용된다(예: 퀵리플라이가 세로 스택 평가에서
 * 제외되도록 호출부가 `{ allowStackedLayout: false }`를 넘긴다) — `CARD`는 자체적으로 항상 제외한다.
 */
export function renderOutputView(
  view: OutputView,
  onButtonAction: (action: ButtonActionView) => void,
  buttonGroupOptions?: ButtonGroupOptions,
): HTMLElement | null {
  switch (view.type) {
    case 'TEXT':
      return renderText(view.payload.text);
    case 'CARD':
      return renderCard(view.payload, onButtonAction);
    case 'IMAGE':
      return renderImage(view.payload);
    case 'BUTTON':
      return renderButtonBlock(view.payload, onButtonAction, buttonGroupOptions);
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
