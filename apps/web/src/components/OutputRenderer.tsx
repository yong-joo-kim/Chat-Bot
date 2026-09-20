import { isSafeHttpUrl, resolveButtonAction, toOutputViews, type ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem, DialogOutput } from '@chat-bot/shared-types';

/**
 * 아웃풋 → 화면 렌더러(FR-10-6, NFR-M1, DD-24). `toOutputViews()`가 정한 순서·타입만 그리며,
 * 위젯(`apps/widget`)과 "무엇을 어떤 순서로 보여줄지" 변환 로직을 공유한다(마크업만 앱별).
 */
export function OutputRenderer({
  outputs,
  onButtonClick,
}: {
  outputs: DialogOutput[];
  onButtonClick: (action: ButtonActionView) => void;
}): JSX.Element {
  const views = toOutputViews(outputs);
  return (
    <div className="output-renderer">
      {views.map((view, i) => {
        switch (view.type) {
          case 'TEXT':
            return (
              <p key={i} className="output-text">
                {view.payload.text}
              </p>
            );
          case 'CARD':
            return (
              <div key={i} className="output-card">
                {view.payload.imageUrl && isSafeHttpUrl(view.payload.imageUrl) && (
                  <img className="output-card-image" src={view.payload.imageUrl} alt={view.payload.altText ?? ''} loading="lazy" />
                )}
                <h4 className="output-card-title">{view.payload.title}</h4>
                {view.payload.description && <p className="output-card-desc">{view.payload.description}</p>}
                {view.payload.buttons && view.payload.buttons.length > 0 && (
                  <ButtonGroup buttons={view.payload.buttons} onButtonClick={onButtonClick} />
                )}
              </div>
            );
          case 'IMAGE':
            return isSafeHttpUrl(view.payload.imageUrl) ? (
              <img key={i} className="output-image" src={view.payload.imageUrl} alt={view.payload.altText} loading="lazy" />
            ) : (
              <p key={i} className="output-image-fallback">
                {view.payload.altText}
              </p>
            );
          case 'BUTTON':
            return (
              <div key={i} className="output-button-block">
                {view.payload.text && <p className="output-text">{view.payload.text}</p>}
                <ButtonGroup buttons={view.payload.buttons} onButtonClick={onButtonClick} />
              </div>
            );
          case 'LINK':
            return isSafeHttpUrl(view.payload.url) ? (
              <a
                key={i}
                className="output-link btn btn-secondary"
                href={view.payload.url}
                target={view.payload.openInNewTab ? '_blank' : undefined}
                rel="noopener noreferrer"
              >
                {view.payload.label}
              </a>
            ) : null;
          case 'PHONE_CALL':
            return (
              <a key={i} className="output-phone-call btn btn-secondary" href={`tel:${view.payload.phoneNumber}`}>
                {view.payload.label}
              </a>
            );
          case 'PAUSE':
            // 위젯은 이 지점에서 타이핑 인디케이터를 지연 표시한다(FR-W-7). 콘솔은 전체 응답을 한 번에
            // 렌더하므로 시각 요소를 만들지 않는다(§5.4 — "DOM 요소를 만들지 않는다"와 동일 원칙).
            return null;
          default:
            return null;
        }
      })}
    </div>
  );
}

function ButtonGroup({
  buttons,
  onButtonClick,
}: {
  buttons: ButtonItem[];
  onButtonClick: (action: ButtonActionView) => void;
}): JSX.Element {
  return (
    <div className="output-buttons" role="group" aria-label="선택지">
      {buttons.map((btn, i) => (
        <button key={i} type="button" className="btn btn-secondary output-button" onClick={() => onButtonClick(resolveButtonAction(btn))}>
          {btn.label}
        </button>
      ))}
    </div>
  );
}
