import { isSafeRichUrl } from '@chat-bot/shared-types/output-view';
import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { CarouselCard } from '@chat-bot/shared-types';
import { renderButtonGroup } from './button';
import { clampCardIndex, nearestCardIndex } from '../../core/carousel';
import { MESSAGES } from '../../constants/messages';

export interface CarouselPayload {
  text?: string;
  cards: CarouselCard[];
}

/**
 * `CAROUSEL` 아웃풋(RM-9, §3.9·§12.1) — 카드 전부 DOM 유지(숨김 슬라이드 0, NFR-RMA2) ·
 * 이전/다음 버튼(끝에서 `aria-disabled`, 포커스 유지) · 위치 "K / N"(`aria-hidden`) · 버튼
 * 이동 시에만 `#cb-status` 1회 안내(`onAnnounce`, 손가락 스와이프·Tab 이동은 낭독하지 않음).
 * 자동 넘김 금지(타이머 0) · 이미지는 `isSafeRichUrl` 통과분만(RM-13 정적 검사 대상 — `innerHTML` 0).
 */
export function renderCarousel(
  payload: CarouselPayload,
  onButtonAction: (action: ButtonActionView) => void,
  onAnnounce?: (text: string) => void,
): HTMLElement {
  const m = MESSAGES.carousel;
  const root = document.createElement('div');
  root.className = 'cb-carousel';
  root.setAttribute('role', 'group');
  root.setAttribute('aria-roledescription', m.roleDescriptionGroup);
  root.setAttribute('aria-label', payload.text ? m.containerLabelWithText(payload.text) : m.containerLabelDefault(payload.cards.length));

  if (payload.text) {
    const p = document.createElement('p');
    p.className = 'cb-msg-text';
    p.textContent = payload.text;
    root.appendChild(p);
  }

  const track = document.createElement('div');
  track.className = 'cb-carousel-track';

  const cardEls: HTMLElement[] = [];
  payload.cards.forEach((card, i) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'cb-carousel-card';
    cardEl.setAttribute('role', 'group');
    cardEl.setAttribute('aria-roledescription', m.roleDescriptionCard);
    cardEl.setAttribute('aria-label', m.cardLabel(i + 1, payload.cards.length, card.title));
    cardEl.dir = 'auto';

    if (card.imageUrl && isSafeRichUrl(card.imageUrl)) {
      // [코드 리뷰 R1 Medium] 고정 비율 상자(§12.3) — 로드 실패 전후로 카드 높이가 흔들리지 않게
      // 이미지가 아니라 상자 쪽에 `aspect-ratio`를 둔다(`image.ts`의 대체 텍스트 폴백과 같은 패턴).
      const imageBox = document.createElement('div');
      imageBox.className = 'cb-carousel-image-box';
      const img = document.createElement('img');
      img.className = 'cb-card-image';
      img.src = card.imageUrl;
      img.alt = card.altText ?? '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => {
        const fallback = document.createElement('p');
        fallback.className = 'cb-msg-text';
        fallback.textContent = card.altText ?? '';
        img.replaceWith(fallback);
      });
      imageBox.appendChild(img);
      cardEl.appendChild(imageBox);
    }

    const title = document.createElement('h3');
    title.className = 'cb-card-title';
    title.textContent = card.title;
    cardEl.appendChild(title);

    if (card.description) {
      const desc = document.createElement('p');
      desc.className = 'cb-card-desc';
      desc.textContent = card.description;
      cardEl.appendChild(desc);
    }

    // 서버 우회 주입 방어(AC-RM5-4) — LINK 버튼은 `isSafeRichUrl` 통과분만 그린다.
    const safeButtons = (card.buttons ?? []).filter((b) => b.action !== 'LINK' || isSafeRichUrl(b.value));
    if (safeButtons.length > 0) {
      cardEl.appendChild(renderButtonGroup(safeButtons, onButtonAction, { allowStackedLayout: false }));
    }

    track.appendChild(cardEl);
    cardEls.push(cardEl);
  });
  root.appendChild(track);

  const nav = document.createElement('div');
  nav.className = 'cb-carousel-nav';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'cb-carousel-nav-btn';
  prevBtn.setAttribute('aria-label', m.prevCard);

  const position = document.createElement('span');
  position.setAttribute('aria-hidden', 'true');
  position.className = 'cb-carousel-position';

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'cb-carousel-nav-btn';
  nextBtn.setAttribute('aria-label', m.nextCard);

  nav.append(prevBtn, position, nextBtn);
  root.appendChild(nav);

  let currentIndex = 0;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

  function updateUi(index: number): void {
    currentIndex = clampCardIndex(index, cardEls.length);
    position.textContent = m.position(currentIndex + 1, cardEls.length);
    prevBtn.setAttribute('aria-disabled', String(currentIndex === 0));
    nextBtn.setAttribute('aria-disabled', String(currentIndex === cardEls.length - 1));
  }
  updateUi(0);

  function cardOffsets(): number[] {
    return cardEls.map((el) => el.offsetLeft);
  }

  function goTo(index: number, announce: boolean): void {
    const clamped = clampCardIndex(index, cardEls.length);
    updateUi(clamped);
    cardEls[clamped]?.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', inline: 'start', block: 'nearest' });
    if (announce) {
      onAnnounce?.(m.statusAnnounce(clamped + 1, cardEls.length, payload.cards[clamped]?.title ?? ''));
    }
  }

  prevBtn.addEventListener('click', () => {
    if (currentIndex === 0) return; // 끝 버튼은 aria-disabled(포커스 유지) — 눌러도 무시(R-12)
    goTo(currentIndex - 1, true);
  });
  nextBtn.addEventListener('click', () => {
    if (currentIndex === cardEls.length - 1) return;
    goTo(currentIndex + 1, true);
  });

  // 손가락 스와이프 — 위치 표시만 갱신(낭독 없음, 소음 방지).
  let rafPending = false;
  track.addEventListener('scroll', () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      updateUi(nearestCardIndex(track.scrollLeft, cardOffsets()));
    });
  });

  // Tab 이동으로 카드 안 요소가 포커스를 받으면 그 카드를 현재로(낭독 없음).
  track.addEventListener('focusin', (e) => {
    const target = e.target as HTMLElement;
    const idx = cardEls.findIndex((el) => el.contains(target));
    if (idx >= 0) updateUi(idx);
  });

  return root;
}
