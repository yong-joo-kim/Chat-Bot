// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { ProactiveButton } from '@chat-bot/shared-types';
import { createProactiveBubble, type ProactiveBubbleHandlers } from './proactive-bubble';
import type { WireProactiveRule } from '../api/public-client';

function makeRule(overrides: Partial<WireProactiveRule> = {}): WireProactiveRule {
  return {
    id: 'rule-1',
    trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 5 },
    text: '주문·배송 조회를 도와드릴까요?',
    buttons: [],
    devices: ['DESKTOP'],
    ...overrides,
  };
}

function makeHandlers(): ProactiveBubbleHandlers & { activated: (ProactiveButton | undefined)[]; dismissed: number; optedOut: number } {
  const activated: (ProactiveButton | undefined)[] = [];
  return {
    activated,
    dismissed: 0,
    optedOut: 0,
    onActivate(button) {
      activated.push(button);
    },
    onDismiss() {
      (this as unknown as { dismissed: number }).dismissed += 1;
    },
    onOptOut() {
      (this as unknown as { optedOut: number }).optedOut += 1;
    },
  };
}

describe('ui/proactive-bubble — 말풍선 DOM·접근성(PA-W1)', () => {
  it('생성 직후에는 hidden 상태다(등장 전 DOM 존재 — 깜빡임 없는 표시를 위함)', () => {
    const bubble = createProactiveBubble(vi.fn());
    expect(bubble.root.hidden).toBe(true);
    expect(bubble.isVisible()).toBe(false);
  });

  it('버튼 0개 규칙은 본문 전체가 버튼이다(FR-PA1-7)', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    bubble.show(makeRule({ buttons: [] }), handlers);
    const bodyBtn = bubble.root.querySelector('.cb-pa-body-button');
    expect(bodyBtn).not.toBeNull();
    expect(bubble.root.hidden).toBe(false);
    expect(bubble.isVisible()).toBe(true);

    (bodyBtn as HTMLButtonElement).click();
    expect(handlers.activated).toEqual([undefined]);
    expect(bubble.root.hidden).toBe(true); // 클릭 즉시 숨김
  });

  it('버튼이 있으면 라벨 텍스트로 렌더하고 클릭 시 그 버튼으로 onActivate를 호출한다', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    const button: ProactiveButton = { label: '배송 조회하기', action: 'NODE', value: '11111111-1111-4111-8111-111111111111' };
    bubble.show(makeRule({ buttons: [button] }), handlers);

    const btnEl = Array.from(bubble.root.querySelectorAll('button')).find((b) => b.textContent === '배송 조회하기');
    expect(btnEl).toBeDefined();
    btnEl!.click();
    expect(handlers.activated).toEqual([button]);
  });

  it('LINK 버튼은 <a target=_blank rel=noopener noreferrer>로 렌더한다', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    const button: ProactiveButton = { label: '도움말 보기', action: 'LINK', value: 'https://example.com/help' };
    bubble.show(makeRule({ buttons: [button] }), handlers);

    const anchor = bubble.root.querySelector('a.cb-pa-link') as HTMLAnchorElement;
    expect(anchor).not.toBeNull();
    expect(anchor.target).toBe('_blank');
    expect(anchor.rel).toBe('noopener noreferrer');
    expect(anchor.href).toBe('https://example.com/help');
  });

  it('안전하지 않은 LINK 주소(javascript:)는 href에 그대로 쓰지 않는다', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    const button: ProactiveButton = { label: '위험', action: 'LINK', value: 'javascript:alert(1)' };
    bubble.show(makeRule({ buttons: [button] }), handlers);
    const anchor = bubble.root.querySelector('a.cb-pa-link') as HTMLAnchorElement;
    expect(anchor.getAttribute('href')).toBe('#');
  });

  it('문구는 textContent로만 렌더한다(HTML 해석 0, AC-PA7-3)', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    bubble.show(makeRule({ text: '<img src=x onerror=alert(1)>', buttons: [{ label: '보기', action: 'MESSAGE', value: '보기' }] }), handlers);
    const textEl = bubble.root.querySelector('.cb-pa-text')!;
    expect(textEl.innerHTML).not.toContain('<img');
    expect(textEl.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('안내 닫기 버튼을 누르면 onDismiss 호출 후 런처로 포커스를 옮긴다', () => {
    const focusLauncher = vi.fn();
    const bubble = createProactiveBubble(focusLauncher);
    const handlers = makeHandlers();
    bubble.show(makeRule({ buttons: [{ label: '보기', action: 'MESSAGE', value: '보기' }] }), handlers);

    const dismissBtn = Array.from(bubble.root.querySelectorAll('button')).find((b) => b.textContent === '안내 닫기')!;
    dismissBtn.click();
    expect(handlers.dismissed).toBe(1);
    expect(focusLauncher).toHaveBeenCalledTimes(1);
    expect(bubble.isVisible()).toBe(false);
  });

  it('이번 방문 동안 안내 끄기 버튼을 누르면 onOptOut 호출 후 런처로 포커스를 옮긴다', () => {
    const focusLauncher = vi.fn();
    const bubble = createProactiveBubble(focusLauncher);
    const handlers = makeHandlers();
    bubble.show(makeRule({ buttons: [{ label: '보기', action: 'MESSAGE', value: '보기' }] }), handlers);

    const optOutBtn = Array.from(bubble.root.querySelectorAll('button')).find((b) => b.textContent === '이번 방문 동안 안내 끄기')!;
    optOutBtn.click();
    expect(handlers.optedOut).toBe(1);
    expect(focusLauncher).toHaveBeenCalledTimes(1);
  });

  it('닫기·끄기 버튼은 44×44px 이상 터치 영역 클래스(cb-pa-btn)를 공유한다(동등 노출, FR-0-247 ④)', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    bubble.show(makeRule({ buttons: [{ label: '보기', action: 'MESSAGE', value: '보기' }] }), handlers);
    const dismissBtn = Array.from(bubble.root.querySelectorAll('button')).find((b) => b.textContent === '안내 닫기')!;
    const optOutBtn = Array.from(bubble.root.querySelectorAll('button')).find((b) => b.textContent === '이번 방문 동안 안내 끄기')!;
    expect(dismissBtn.className).toBe(optOutBtn.className);
  });

  it('Esc 키를 누르면 닫히고 onDismiss + 런처 포커스가 호출된다', () => {
    const focusLauncher = vi.fn();
    const bubble = createProactiveBubble(focusLauncher);
    const handlers = makeHandlers();
    bubble.show(makeRule({ buttons: [{ label: '보기', action: 'MESSAGE', value: '보기' }] }), handlers);

    bubble.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(handlers.dismissed).toBe(1);
    expect(focusLauncher).toHaveBeenCalledTimes(1);
    expect(bubble.isVisible()).toBe(false);
  });

  it('같은 규칙을 다시 show해도 알림 영역 문구를 반복 기록하지 않는다(AC-PA8-2)', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    const rule = makeRule({ text: '문구 A' });
    bubble.show(rule, handlers);
    const first = bubble.statusRegion.textContent;
    bubble.statusRegion.textContent = '__마킹__';
    bubble.show(rule, handlers);
    expect(bubble.statusRegion.textContent).toBe('__마킹__'); // 재기록되지 않았다
    expect(first).toBe('챗봇 안내: 문구 A');
  });

  it('다른 규칙을 show하면 알림 영역 문구를 새로 기록한다', () => {
    const bubble = createProactiveBubble(vi.fn());
    const handlers = makeHandlers();
    bubble.show(makeRule({ id: 'rule-1', text: '문구 A' }), handlers);
    bubble.show(makeRule({ id: 'rule-2', text: '문구 B' }), handlers);
    expect(bubble.statusRegion.textContent).toBe('챗봇 안내: 문구 B');
  });

  it('statusRegion은 role=status·aria-live=polite다(NFR-PAA2)', () => {
    const bubble = createProactiveBubble(vi.fn());
    expect(bubble.statusRegion.getAttribute('role')).toBe('status');
    expect(bubble.statusRegion.getAttribute('aria-live')).toBe('polite');
  });
});
