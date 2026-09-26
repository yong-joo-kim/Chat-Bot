import { useRef, useState } from 'react';
import { isSafeHttpUrl, isSafeRichUrl, resolveButtonAction, toOutputViews, type ButtonActionView, type OutputView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem, CarouselOutputPayloadV1, DialogOutput } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

/**
 * [신규 No.46] 한 턴의 표시 아웃풋 중 `display==='QUICK_REPLY'`인 `BUTTON`의 **마지막 1개**만
 * 칩으로 분리한다(FR-RM2-3·EX-RM-11) — 위젯 `core/quick-reply.ts`의 `splitQuickReply`와 같은 규칙.
 */
function findLastQuickReplyIndex(views: OutputView[]): number {
  let last = -1;
  views.forEach((v, i) => {
    if (v.type === 'BUTTON' && v.payload.display === 'QUICK_REPLY') last = i;
  });
  return last;
}

/**
 * 아웃풋 → 화면 렌더러(FR-10-6, NFR-M1, DD-24). `toOutputViews()`가 정한 순서·타입만 그리며,
 * 위젯(`apps/widget`)과 "무엇을 어떤 순서로 보여줄지" 변환 로직을 공유한다(마크업만 앱별).
 * [신규 No.46] `CAROUSEL` case와 바로연결 칩 분기 — 시뮬레이터(`ChatBubble`)와 채널별 미리보기
 * (`ChannelPreviewSection`)가 이 컴포넌트 하나를 공유한다(설계서 §0, 중복 구현 금지).
 */
export function OutputRenderer({
  outputs,
  onButtonClick,
  hideQuickReply = false,
}: {
  outputs: DialogOutput[];
  onButtonClick: (action: ButtonActionView) => void;
  /**
   * [신규 No.46] RM-6 — 응답 테스트 시뮬레이터가 "사용 후 숨김"(D-4, 위젯과 동일한 사용자 경험)을
   * 표현할 때 쓴다. 참이면 바로연결 칩 묶음을 렌더하지 않는다(그 아웃풋 자체가 사라진 것처럼 —
   * 위젯의 `hidden` 토글과 같은 관측 결과). 그 밖의 소비자(채널별 미리보기 등)는 항상 `false`.
   */
  hideQuickReply?: boolean;
}): JSX.Element {
  const views = toOutputViews(outputs);
  const quickReplyIndex = hideQuickReply ? -1 : findLastQuickReplyIndex(views);
  const hiddenQuickReplyIndex = hideQuickReply ? findLastQuickReplyIndex(views) : -1;
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
            // [신규 No.46] 마지막 바로연결은 말풍선 안이 아니라 아래쪽 칩 묶음으로 렌더한다(EX-RM-11) —
            // 여기서는 건너뛰고 전체 목록 렌더 뒤 1회만 그린다. `hideQuickReply`면 칩 자체를
            // 만들지 않는다(사용 후 숨김 — 위젯 `hidden` 토글과 같은 관측 결과).
            if (i === quickReplyIndex || i === hiddenQuickReplyIndex) return null;
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
          case 'CAROUSEL':
            return <CarouselView key={i} payload={view.payload} onButtonClick={onButtonClick} />;
          default: {
            // [신규 No.46] 8종 전부 명시 — 새 표시 타입을 빠뜨리면 컴파일 오류로 걸린다(설계서 §15 #14).
            const unreachable: never = view;
            return unreachable;
          }
        }
      })}
      {quickReplyIndex >= 0 && views[quickReplyIndex].type === 'BUTTON' && (
        <div className="output-quick-replies" role="group" aria-label={MESSAGES.richMessages.quickReplyGroupLabel}>
          {(views[quickReplyIndex] as Extract<OutputView, { type: 'BUTTON' }>).payload.buttons
            .filter((b) => b.action !== 'LINK')
            .map((btn, i) => (
              <button key={i} type="button" className="btn btn-secondary output-quick-reply" onClick={() => onButtonClick(resolveButtonAction(btn))}>
                {btn.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** [신규 No.46] RM-3·RM-6 공용 캐러셀 렌더 — 위젯(`ui/renderers/carousel.ts`)과 같은 구조(§3.9). */
function CarouselView({
  payload,
  onButtonClick,
}: {
  payload: CarouselOutputPayloadV1;
  onButtonClick: (action: ButtonActionView) => void;
}): JSX.Element {
  const [index, setIndex] = useState(0);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const cards = payload.cards;
  const clamped = Math.min(index, cards.length - 1);

  function goTo(next: number): void {
    if (next < 0 || next >= cards.length) return;
    setIndex(next);
    cardRefs.current[next]?.scrollIntoView?.({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }

  return (
    <div className="output-carousel" role="group" aria-roledescription="캐러셀" aria-label={payload.text || `카드 ${cards.length}개`}>
      {payload.text && <p className="output-text">{payload.text}</p>}
      <div className="output-carousel-track">
        {cards.map((c, i) => (
          <div
            key={i}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="output-carousel-card"
            role="group"
            aria-roledescription="카드"
            aria-label={`${cards.length}개 중 ${i + 1}번째: ${c.title}`}
          >
            {c.imageUrl && isSafeRichUrl(c.imageUrl) && <img className="output-card-image" src={c.imageUrl} alt={c.altText ?? ''} loading="lazy" />}
            <h4 className="output-card-title">{c.title}</h4>
            {c.description && <p className="output-card-desc">{c.description}</p>}
            {c.buttons && c.buttons.length > 0 && <ButtonGroup buttons={c.buttons} onButtonClick={onButtonClick} allowStackedLayout={false} />}
          </div>
        ))}
      </div>
      <div className="output-carousel-nav">
        <button
          type="button"
          className="btn btn-secondary output-carousel-nav-btn"
          aria-label={MESSAGES.richMessages.carouselPrevCard}
          aria-disabled={clamped === 0}
          onClick={() => goTo(clamped - 1)}
        >
          ◀
        </button>
        <span aria-hidden="true">{MESSAGES.richMessages.carouselPosition(clamped + 1, cards.length)}</span>
        <button
          type="button"
          className="btn btn-secondary output-carousel-nav-btn"
          aria-label={MESSAGES.richMessages.carouselNextCard}
          aria-disabled={clamped === cards.length - 1}
          onClick={() => goTo(clamped + 1)}
        >
          ▶
        </button>
      </div>
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
