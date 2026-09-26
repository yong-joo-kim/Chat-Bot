import type { ButtonActionView, OutputView } from '@chat-bot/shared-types/output-view';
import { renderText } from './text';
import { renderCard } from './card';
import { renderImage } from './image';
import { renderButtonBlock, type ButtonGroupOptions } from './button';
import { renderLink } from './link';
import { renderPhoneCall } from './phone-call';
import { renderCarousel } from './carousel';

export { renderButtonGroup, type ButtonGroupOptions } from './button';
export { renderQuickReplies } from './quick-reply';

/**
 * 아웃풋 1건 → DOM 노드(FR-W-5). `PAUSE`는 요소를 만들지 않는다(`message-list.ts`가 지연만 처리).
 * `buttonGroupOptions`는 최상위 `BUTTON` 아웃풋에만 적용된다(예: 퀵리플라이가 세로 스택 평가에서
 * 제외되도록 호출부가 `{ allowStackedLayout: false }`를 넘긴다) — `CARD`는 자체적으로 항상 제외한다.
 * [신규 No.46] `onCarouselAnnounce`는 `CAROUSEL`의 이전/다음 버튼 이동 안내(`#cb-status` 1회)만
 * 쓴다 — 그 밖의 타입은 무시한다.
 */
export function renderOutputView(
  view: OutputView,
  onButtonAction: (action: ButtonActionView) => void,
  buttonGroupOptions?: ButtonGroupOptions,
  onCarouselAnnounce?: (text: string) => void,
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
    case 'CAROUSEL':
      return renderCarousel(view.payload, onButtonAction, onCarouselAnnounce);
    default: {
      // [신규 No.46] 8종 전부 명시 — 새 표시 타입을 빠뜨리면 컴파일 오류로 걸린다(설계서 §15 #13).
      const unreachable: never = view;
      return unreachable;
    }
  }
}
