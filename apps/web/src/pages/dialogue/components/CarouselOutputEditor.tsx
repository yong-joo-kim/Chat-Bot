import { useRef } from 'react';
import type { CarouselCard, CarouselOutputPayloadV1, RichUrlHostRule } from '@chat-bot/shared-types';
import { CAROUSEL_LIMITS, RICH_URL_ERROR_MESSAGES, hostMatchesRules, inspectRichUrl } from '@chat-bot/shared-types';
import { InlineFieldError } from '../../../components/InlineFieldError';
import { ReorderableList } from '../../../components/ReorderableList';
import { MESSAGES } from '../../../constants/messages';
import { ButtonListEditor } from './DialogOutputEditor';

export interface CarouselOutputEditorProps {
  value: CarouselOutputPayloadV1;
  onChange: (value: CarouselOutputPayloadV1) => void;
  chatbotId: string;
  /** DOM id 접두어(예: `output-3`) — 한 노드에 캐러셀 아웃풋이 2개 이상이어도 id가 충돌하지 않게 한다. */
  idPrefix: string;
  /** 서버 `details[].field` 경로 접두어(예: `outputs.3.payload`). */
  errorFieldPrefix: string;
  fieldErrors: Record<string, string>;
  /** [신규 No.46] 챗봇에 등록된 허용 도메인 목록 — 있으면 목록 밖 호스트를 경고(§3.1 하단). */
  allowedHosts?: RichUrlHostRule[];
  firstFieldRef: React.MutableRefObject<HTMLElement | null>;
}

/** [신규 No.46] 이미지·LINK 주소 인라인 검사 결과(오류/경고)를 계산한다(§3.1 인라인 검증 상세). */
function inspectCarouselUrl(url: string, allowedHosts?: RichUrlHostRule[]): { error?: string; warning?: string } {
  if (!url) return {};
  const r = inspectRichUrl(url);
  if (!r.ok) return { error: RICH_URL_ERROR_MESSAGES[r.error] };
  const msg = MESSAGES.dialogue.outputFields;
  if (allowedHosts && allowedHosts.length > 0 && !hostMatchesRules(r.host, allowedHosts)) {
    return { warning: msg.richUrlOutsideAllowlistWarning };
  }
  if (r.warnings.includes('PUNYCODE')) return { warning: msg.richUrlPunycodeWarning };
  if (r.warnings.includes('IP_HOST')) return { warning: msg.richUrlIpHostWarning };
  if (r.warnings.includes('SHORTENER')) return { warning: msg.richUrlShortenerWarning };
  return {};
}

/**
 * RM-1 — 캐러셀 아웃풋 편집기(channel-rich-messages-ui-spec.md §3.1). `ReorderableList`로 카드
 * 2~10장을 관리하고(추가/삭제/순서 이동), 카드 복제는 공용 컴포넌트를 건드리지 않고 이 파일이
 * `renderItem` 안에서 독립 버튼으로 추가한다(D-2).
 */
let keySeq = 0;
function freshKey(): string {
  keySeq += 1;
  return `carousel-card-${keySeq}-${Date.now()}`;
}

interface CardRow {
  card: CarouselCard;
  key: string;
}

export function CarouselOutputEditor({ value, onChange, chatbotId, idPrefix, errorFieldPrefix, fieldErrors, allowedHosts, firstFieldRef }: CarouselOutputEditorProps): JSX.Element {
  const msg = MESSAGES.dialogue.outputFields;
  // [코드 리뷰 R1 High] 카드 키는 **행(row) 단위로만** 바뀐다 — 이동·삭제는 `ReorderableList`가
  // 넘겨주는 `next`(이미 올바르게 짝지어진 {card,key} 배열)를 그대로 반영하고, 인덱스로 다시
  // 짝짓지 않는다(그러면 이동·중간 삭제 후 key가 카드와 어긋나 포커스가 엉뚱한 위치에 남는다,
  // AC-5-8 위반). `cardKeys`는 오직 "이 컴포넌트가 마지막으로 만든 순서"를 기억하는 캐시일 뿐이다.
  const cardKeys = useRef<string[]>(value.cards.map(() => freshKey()));
  if (cardKeys.current.length !== value.cards.length) {
    // 안전망 — 외부(부모)가 카드 배열 길이를 우리 손을 거치지 않고 바꾼 드문 경우에만 재동기화한다.
    cardKeys.current = value.cards.map((_c, i) => cardKeys.current[i] ?? freshKey());
  }
  const rows: CardRow[] = value.cards.map((c, i) => ({ card: c, key: cardKeys.current[i] }));

  /** 행(카드+키) 배열을 그대로 반영한다 — 순서·키 짝을 절대 다시 계산하지 않는다. */
  function setRows(nextRows: CardRow[]): void {
    cardKeys.current = nextRows.map((r) => r.key);
    onChange({ ...value, cards: nextRows.map((r) => r.card) });
  }

  function err(suffix: string): string | undefined {
    return fieldErrors[`${errorFieldPrefix}.${suffix}`];
  }

  return (
    <div className="carousel-output-editor">
      <div className="form-field">
        <label htmlFor={`${idPrefix}-text`}>{msg.carouselText}</label>
        <textarea
          id={`${idPrefix}-text`}
          ref={(el) => (firstFieldRef.current = el)}
          value={value.text ?? ''}
          maxLength={CAROUSEL_LIMITS.textMax}
          rows={2}
          onChange={(e) => onChange({ ...value, text: e.target.value || undefined })}
        />
        <p className="char-counter">
          {(value.text ?? '').length}/{CAROUSEL_LIMITS.textMax}자
        </p>
      </div>

      <span className="field-label-static">{msg.carouselCards}</span>
      <ReorderableList
        items={rows}
        getKey={(r) => r.key}
        onChange={(next) => setRows(next)}
        minItems={CAROUSEL_LIMITS.cardsMin}
        maxItems={CAROUSEL_LIMITS.cardsMax}
        removeDisabled={value.cards.length <= CAROUSEL_LIMITS.cardsMin}
        removeDisabledReason={msg.carouselRemoveDisabledReason}
        onAdd={() => setRows([...rows, { card: { title: '' }, key: freshKey() }])}
        addLabel={msg.carouselAddCard}
        addLimitLabel={msg.carouselCardMaxError}
        onRemove={(key) => setRows(rows.filter((r) => r.key !== key))}
        itemLabel={(r, i) => msg.carouselCardLabel(i, r.card.title)}
        renderItem={(r, index) => {
          const card = r.card;
          const cardErrPrefix = `cards.${index}`;
          const imageInspect = inspectCarouselUrl(card.imageUrl ?? '', allowedHosts);
          const imageError = err(`${cardErrPrefix}.imageUrl`) ?? imageInspect.error;
          const duplicateDisabled = value.cards.length >= CAROUSEL_LIMITS.cardsMax;

          function updateCard(patch: Partial<CarouselCard>): void {
            const nextRows = [...rows];
            nextRows[index] = { ...r, card: { ...card, ...patch } };
            setRows(nextRows);
          }

          return (
            <div className="carousel-card-fields">
              <div className="form-field">
                <label htmlFor={`${idPrefix}-card-${index}-title`}>
                  {msg.carouselCardTitle} <span className="required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id={`${idPrefix}-card-${index}-title`}
                  type="text"
                  maxLength={CAROUSEL_LIMITS.titleMax}
                  value={card.title}
                  onChange={(e) => updateCard({ title: e.target.value })}
                  aria-invalid={Boolean(err(`${cardErrPrefix}.title`))}
                />
                <InlineFieldError id={`${idPrefix}-card-${index}-title-error`} message={err(`${cardErrPrefix}.title`)} />
              </div>
              <div className="form-field">
                <label htmlFor={`${idPrefix}-card-${index}-description`}>{msg.carouselCardDescription}</label>
                <textarea
                  id={`${idPrefix}-card-${index}-description`}
                  maxLength={CAROUSEL_LIMITS.descriptionMax}
                  rows={2}
                  value={card.description ?? ''}
                  onChange={(e) => updateCard({ description: e.target.value || undefined })}
                />
              </div>
              <div className="form-field">
                <label htmlFor={`${idPrefix}-card-${index}-image-url`}>{msg.carouselCardImageUrl}</label>
                <input
                  id={`${idPrefix}-card-${index}-image-url`}
                  type="text"
                  value={card.imageUrl ?? ''}
                  onChange={(e) => updateCard({ imageUrl: e.target.value || undefined })}
                  aria-invalid={Boolean(imageError)}
                />
                <InlineFieldError id={`${idPrefix}-card-${index}-image-url-error`} message={imageError} />
                {!imageError && imageInspect.warning && (
                  <p className="field-hint field-hint--warning">
                    <span aria-hidden="true">⚠</span> {imageInspect.warning}
                  </p>
                )}
              </div>
              {card.imageUrl && (
                <div className="form-field">
                  <label htmlFor={`${idPrefix}-card-${index}-alt-text`}>{msg.carouselCardAltText}</label>
                  <input
                    id={`${idPrefix}-card-${index}-alt-text`}
                    type="text"
                    maxLength={CAROUSEL_LIMITS.altTextMax}
                    value={card.altText ?? ''}
                    onChange={(e) => updateCard({ altText: e.target.value || undefined })}
                    aria-invalid={Boolean(err(`${cardErrPrefix}.altText`))}
                  />
                  <InlineFieldError
                    id={`${idPrefix}-card-${index}-alt-text-error`}
                    message={err(`${cardErrPrefix}.altText`) ?? (card.imageUrl && !card.altText ? msg.altTextRequiredError : undefined)}
                  />
                </div>
              )}
              <ButtonListEditor
                buttons={card.buttons ?? []}
                onChange={(buttons) => updateCard({ buttons: buttons.length > 0 ? buttons : undefined })}
                chatbotId={chatbotId}
                idPrefix={`${idPrefix}-card-${index}-btn`}
                maxItems={CAROUSEL_LIMITS.cardButtonsMax}
                richUrlCheck
              />
              <div className="carousel-card-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={duplicateDisabled}
                  onClick={() => {
                    const nextRows = [...rows];
                    nextRows.splice(index + 1, 0, { card: { ...card }, key: freshKey() });
                    setRows(nextRows);
                  }}
                >
                  {msg.carouselDuplicateCard}
                </button>
                {/* [코드 리뷰 R1 Low] 비활성 이유 병기 — addLimitLabel과 같은 원칙(색상 단독 금지). */}
                {duplicateDisabled && <span className="field-hint">{msg.carouselCardMaxError}</span>}
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
