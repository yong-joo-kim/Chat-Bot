// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { CarouselCard } from '@chat-bot/shared-types';
import { renderCarousel } from './carousel';

function card(title: string, extra: Partial<CarouselCard> = {}): CarouselCard {
  return { title, ...extra };
}

describe('renderCarousel — RM-9(§3.9·§12.1)', () => {
  it('카드 전부가 DOM에 존재한다(숨김 슬라이드 0)', () => {
    const el = renderCarousel({ cards: [card('A'), card('B'), card('C')] }, vi.fn());
    const cards = el.querySelectorAll('.cb-carousel-card');
    expect(cards).toHaveLength(3);
    cards.forEach((c) => expect(c.hasAttribute('hidden')).toBe(false));
  });

  it('컨테이너·카드에 role/aria-roledescription/aria-label이 붙는다', () => {
    const el = renderCarousel({ cards: [card('스타터 요금제'), card('스탠다드 요금제')] }, vi.fn());
    expect(el.getAttribute('role')).toBe('group');
    expect(el.getAttribute('aria-roledescription')).toBe('캐러셀');
    expect(el.getAttribute('aria-label')).toBe('카드 2개');
    const firstCard = el.querySelectorAll('.cb-carousel-card')[0];
    expect(firstCard.getAttribute('role')).toBe('group');
    expect(firstCard.getAttribute('aria-roledescription')).toBe('카드');
    expect(firstCard.getAttribute('aria-label')).toBe('2개 중 1번째: 스타터 요금제');
    // RM-13 정적 검사 대상 — 카드 요소에 aria-hidden을 설정하지 않는다.
    expect(firstCard.hasAttribute('aria-hidden')).toBe(false);
  });

  it('안내 문구가 있으면 컨테이너 aria-label에 그대로 쓰인다', () => {
    const el = renderCarousel({ text: '이번 달 추천', cards: [card('A'), card('B')] }, vi.fn());
    expect(el.getAttribute('aria-label')).toBe('이번 달 추천');
  });

  it('첫 카드에서 이전 버튼은 aria-disabled=true, 마지막 카드에서 다음 버튼은 aria-disabled=true다', () => {
    const el = renderCarousel({ cards: [card('A'), card('B')] }, vi.fn());
    const prev = el.querySelector('.cb-carousel-nav-btn[aria-label="이전 카드"]') as HTMLButtonElement;
    const next = el.querySelector('.cb-carousel-nav-btn[aria-label="다음 카드"]') as HTMLButtonElement;
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBe('false');
  });

  it('다음 버튼 클릭 시 위치 텍스트가 갱신되고 1회 안내 콜백이 호출된다', () => {
    const announce = vi.fn();
    const el = renderCarousel({ cards: [card('A'), card('B'), card('C')] }, vi.fn(), announce);
    const next = el.querySelector('.cb-carousel-nav-btn[aria-label="다음 카드"]') as HTMLButtonElement;
    next.click();
    expect(el.querySelector('.cb-carousel-position')?.textContent).toBe('2 / 3');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('3개 중 2번째 카드: B');
  });

  it('첫 카드에서 이전 버튼을 눌러도 무시된다(끝 경계)', () => {
    const announce = vi.fn();
    const el = renderCarousel({ cards: [card('A'), card('B')] }, vi.fn(), announce);
    const prev = el.querySelector('.cb-carousel-nav-btn[aria-label="이전 카드"]') as HTMLButtonElement;
    prev.click();
    expect(announce).not.toHaveBeenCalled();
    expect(el.querySelector('.cb-carousel-position')?.textContent).toBe('1 / 2');
  });

  it('https가 아닌 이미지 URL은 <img>를 만들지 않는다(서버 우회 주입 방어)', () => {
    const el = renderCarousel({ cards: [card('A', { imageUrl: 'http://example.com/a.png', altText: 'a' })] }, vi.fn());
    expect(el.querySelector('img')).toBeNull();
  });

  it('이미지 상자는 고정 비율(aspect-ratio)이고, 로드 실패 시 <img>가 대체 텍스트로 교체된다(§12.3, 코드 리뷰 R1 Medium)', () => {
    const el = renderCarousel({ cards: [card('A', { imageUrl: 'https://img.example.com/a.png', altText: '대체 텍스트입니다' })] }, vi.fn());
    const box = el.querySelector('.cb-carousel-image-box') as HTMLElement;
    expect(box).not.toBeNull();
    const img = box.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();

    img.dispatchEvent(new Event('error'));

    expect(box.querySelector('img')).toBeNull();
    expect(box.querySelector('.cb-msg-text')?.textContent).toBe('대체 텍스트입니다');
    // 상자 자체는 그대로 남아 카드 높이가 흔들리지 않는다(AC-RM7-4).
    expect(el.querySelector('.cb-carousel-image-box')).toBe(box);
  });

  it('https 이미지는 loading=lazy·referrerPolicy=no-referrer로 렌더된다', () => {
    const el = renderCarousel({ cards: [card('A', { imageUrl: 'https://img.example.com/a.png', altText: 'a' })] }, vi.fn());
    const img = el.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.loading).toBe('lazy');
    expect(img.referrerPolicy).toBe('no-referrer');
  });

  it('카드 버튼의 LINK가 https가 아니면 걸러진다(AC-RM5-4)', () => {
    const card1 = card('A', { buttons: [{ label: '자세히', action: 'LINK', value: 'http://insecure.example.com' }] });
    const el = renderCarousel({ cards: [card1, card('B')] }, vi.fn());
    expect(el.querySelector('.cb-btn')).toBeNull();
  });

  it('카드 버튼 클릭은 onButtonAction으로 위임된다', () => {
    const onButtonAction = vi.fn();
    const card1 = card('A', { buttons: [{ label: '자세히 보기', action: 'MESSAGE', value: '자세히 보기' }] });
    const el = renderCarousel({ cards: [card1, card('B')] }, onButtonAction);
    (el.querySelector('.cb-btn') as HTMLButtonElement).click();
    expect(onButtonAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MESSAGE', label: '자세히 보기' }));
  });
});
