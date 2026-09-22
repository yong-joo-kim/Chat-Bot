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
                  // 카드 버튼은 되묻기(FR-N1-12)가 절대 쓰지 않는 경로다(엔진은 되묻기를 항상
                  // 최상위 BUTTON 아웃풋으로만 반환한다, resolver.ts). 세로 스택 판정에서 구조적으로
                  // 제외해 카드 버튼 레이아웃은 이번 기능과 무관하게 항상 그대로 유지한다.
                  <ButtonGroup buttons={view.payload.buttons} onButtonClick={onButtonClick} allowStackedLayout={false} />
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

/**
 * 되묻기 후보가 FAQ/의도 원문(수십 자)일 수 있는 경우 세로 스택 레이아웃으로 전환한다
 * (`nlu-rag-answering-ui-spec.md` §4.5.2). 백엔드 계약에 버튼 그룹의 "출처"(동음이의어/의미매칭)를
 * 구분하는 별도 필드가 없어(둘 다 동일한 `BUTTON` 아웃풋 + `MESSAGE` 액션), 라벨 길이를 휴리스틱으로
 * 쓴다 — 다만 **이 휴리스틱이 평가되는 범위 자체를 구조적으로 좁힌다**(code-reviewer 지적, Medium):
 *   1) 호출부가 `allowStackedLayout={false}`를 넘긴 곳(카드 버튼)은 애초에 평가하지 않는다.
 *   2) 그룹 내 모든 버튼이 `action:'MESSAGE'`일 때만 평가한다 — 되묻기(동음이의어/의미매칭)는
 *      항상 전부 `MESSAGE` 액션이지만(DD-27, FR-N1-12), 기존 대화노드 퀵메뉴는 `NODE`/`LINK` 액션을
 *      섞어 쓰므로 이 조건만으로 자연히 제외된다.
 * 동음이의어 후보(예: "과일"/"선박")는 실무상 짧아 임계값에 잘 걸리지 않고, 의미매칭 후보는 FAQ
 * 질문 원문이라 상대적으로 길다 — 둘 다 "되묻기" UI 계열이므로 같은 스택 규칙을 공유해도
 * 무방하다(§4.5.1, 100% 동일 흐름). 정확한 구분이 필요해지면 백엔드에 `variant` 필드 추가를 요청할 것.
 */
const STACKED_LABEL_LENGTH_THRESHOLD = 10;

function ButtonGroup({
  buttons,
  onButtonClick,
  allowStackedLayout = true,
}: {
  buttons: ButtonItem[];
  onButtonClick: (action: ButtonActionView) => void;
  /** `false`면 세로 스택 평가 자체를 하지 않는다(예: 카드 버튼 — 되묻기가 쓰지 않는 경로). */
  allowStackedLayout?: boolean;
}): JSX.Element {
  const stacked =
    allowStackedLayout &&
    buttons.every((b) => b.action === 'MESSAGE') &&
    buttons.some((b) => b.label.length > STACKED_LABEL_LENGTH_THRESHOLD);
  return (
    <div className={`output-buttons${stacked ? ' output-buttons--stacked' : ''}`} role="group" aria-label="선택지">
      {buttons.map((btn, i) => (
        <button key={i} type="button" className="btn btn-secondary output-button" onClick={() => onButtonClick(resolveButtonAction(btn))}>
          {btn.label}
        </button>
      ))}
    </div>
  );
}
