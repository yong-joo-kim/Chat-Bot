// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProactiveButton, ProactiveEventKind } from '@chat-bot/shared-types';
import { createProactiveController, type ProactiveControllerDeps } from './proactive-controller';
import type { ProactiveBubbleController, ProactiveBubbleHandlers } from '../ui/proactive-bubble';
import type { WireProactivePayload, WireProactiveRule } from '../api/public-client';

const SLUG = 'order-bot';

function makeRule(overrides: Partial<WireProactiveRule> = {}): WireProactiveRule {
  return {
    id: 'rule-1',
    trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 5 },
    text: '주문 조회를 도와드릴까요?',
    buttons: [],
    devices: ['DESKTOP'],
    ...overrides,
  };
}

function makePayload(rules: WireProactiveRule[]): WireProactivePayload {
  return { caps: { maxPerSession: 1, minIntervalSec: 30, quietAfterUserMessageSec: 60 }, rules };
}

class FakeBubble implements ProactiveBubbleController {
  root = document.createElement('div');
  statusRegion = document.createElement('div');
  visible = false;
  shownCalls: { rule: WireProactiveRule; handlers: ProactiveBubbleHandlers }[] = [];
  hideCalls = 0;

  show(rule: WireProactiveRule, handlers: ProactiveBubbleHandlers): void {
    this.visible = true;
    this.shownCalls.push({ rule, handlers });
  }
  hide(): void {
    this.visible = false;
    this.hideCalls += 1;
  }
  isVisible(): boolean {
    return this.visible;
  }
}

function makeDeps(overrides: Partial<ProactiveControllerDeps> = {}): {
  deps: ProactiveControllerDeps;
  bubble: FakeBubble;
  events: { ruleId: string; kind: ProactiveEventKind }[];
  activated: (ProactiveButton | undefined)[];
} {
  const bubble = new FakeBubble();
  const events: { ruleId: string; kind: ProactiveEventKind }[] = [];
  const activated: (ProactiveButton | undefined)[] = [];
  const deps: ProactiveControllerDeps = {
    slug: SLUG,
    device: 'DESKTOP',
    payload: makePayload([makeRule()]),
    bubble,
    getPanelOpen: () => false,
    getHandoffConnected: () => false,
    getLauncherVisible: () => true,
    sendEvent: (ruleId, kind) => events.push({ ruleId, kind }),
    onActivate: (button) => activated.push(button),
    ...overrides,
  };
  return { deps, bubble, events, activated };
}

beforeEach(() => {
  window.sessionStorage.clear();
  history.pushState(null, '', '/home');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('core/proactive-controller — 체류 판정기(§6.2)', () => {
  it('경로가 맞고 5초 머물면 말풍선을 표시하고 SHOWN을 보낸다(4초까지는 표시 안 함)', () => {
    history.pushState(null, '', '/order/123');
    const { deps, bubble, events } = makeDeps();
    const controller = createProactiveController(deps);
    controller.start();

    vi.advanceTimersByTime(4000);
    expect(bubble.visible).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(bubble.visible).toBe(true);
    expect(bubble.shownCalls[0].rule.id).toBe('rule-1');
    expect(events).toEqual([{ ruleId: 'rule-1', kind: 'SHOWN' }]);
  });

  it('제외 경로에 걸리면 표시되지 않는다', () => {
    history.pushState(null, '', '/order/complete');
    const { deps, bubble } = makeDeps({
      payload: makePayload([makeRule({ trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: ['/order/complete'], dwellSec: 5 } })]),
    });
    createProactiveController(deps).start();
    vi.advanceTimersByTime(10000);
    expect(bubble.visible).toBe(false);
  });

  it('SPA 경로 변경(history.pushState)으로 페이지가 바뀌면 머문 시간이 초기화된다', () => {
    history.pushState(null, '', '/order/1');
    const { deps, bubble } = makeDeps();
    createProactiveController(deps).start();

    vi.advanceTimersByTime(3000); // 3초만 머묾
    history.pushState(null, '', '/order/2'); // 새 페이지 — 다음 틱에 감지
    vi.advanceTimersByTime(3000); // 누적 3초(5초 미만)
    expect(bubble.visible).toBe(false);

    vi.advanceTimersByTime(3000); // 경로 전환 틱(1회) 손실을 포함해 5초 충족
    expect(bubble.visible).toBe(true);
  });

  it('탭이 숨겨진 동안은 머문 시간이 누적되지 않는다(FR-PA2-2)', () => {
    history.pushState(null, '', '/order/1');
    const { deps, bubble } = makeDeps();
    createProactiveController(deps).start();

    vi.advanceTimersByTime(2000);
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(10000); // 숨김 동안 아무리 지나도 누적 안 됨(타이머 자체가 멎는다)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    vi.advanceTimersByTime(2000); // 누적 2+2=4초
    expect(bubble.visible).toBe(false);
    vi.advanceTimersByTime(1000); // 5초 충족
    expect(bubble.visible).toBe(true);
  });

  it('끄기(OPTED_OUT)를 누르면 이 탭의 모든 선제 안내가 즉시 멈춘다(타이머 해제)', () => {
    history.pushState(null, '', '/order/1');
    const { deps, bubble, events } = makeDeps();
    createProactiveController(deps).start();
    vi.advanceTimersByTime(5000);
    expect(bubble.visible).toBe(true);

    const handlers = bubble.shownCalls[0].handlers;
    handlers.onOptOut();
    expect(events).toContainEqual({ ruleId: 'rule-1', kind: 'OPTED_OUT' });

    const clearSpy = vi.spyOn(window, 'clearInterval');
    // 규칙 1개뿐이라 이미 stop() 되었어야 한다 — 더 진행해도 다시 표시되지 않는다.
    vi.advanceTimersByTime(60000);
    expect(bubble.shownCalls.length).toBe(1);
    clearSpy.mockRestore();
  });

  it('닫기(DISMISSED)를 누른 규칙은 같은 탭에서 다시 표시되지 않는다', () => {
    history.pushState(null, '', '/order/1');
    const { deps, bubble, events } = makeDeps();
    createProactiveController(deps).start();
    vi.advanceTimersByTime(5000);
    bubble.shownCalls[0].handlers.onDismiss();
    expect(events).toContainEqual({ ruleId: 'rule-1', kind: 'DISMISSED' });

    history.pushState(null, '', '/order/2');
    vi.advanceTimersByTime(6000);
    expect(bubble.shownCalls.length).toBe(1); // 다시 뜨지 않음
  });

  it('버튼 클릭 시 CLICKED를 보내고 onActivate로 넘긴다(엔진 처리는 앱 쪽 책임)', () => {
    history.pushState(null, '', '/order/1');
    const button: ProactiveButton = { label: '배송 조회', action: 'NODE', value: '11111111-1111-4111-8111-111111111111' };
    const { deps, bubble, events, activated } = makeDeps({ payload: makePayload([makeRule({ buttons: [button] })]) });
    createProactiveController(deps).start();
    vi.advanceTimersByTime(5000);
    bubble.shownCalls[0].handlers.onActivate(button);
    expect(events).toContainEqual({ ruleId: 'rule-1', kind: 'CLICKED' });
    expect(activated).toEqual([button]);
  });

  it('세션당 최대 표시 수(1)에 도달하면 더 표시되지 않는다(CAP_REACHED)', () => {
    history.pushState(null, '', '/order/1');
    const rules = [makeRule({ id: 'rule-1' }), makeRule({ id: 'rule-2' })];
    const { deps, bubble } = makeDeps({ payload: makePayload(rules) });
    createProactiveController(deps).start();
    vi.advanceTimersByTime(5000);
    expect(bubble.shownCalls.length).toBe(1);
    bubble.shownCalls[0].handlers.onDismiss();
    history.pushState(null, '', '/order/2');
    vi.advanceTimersByTime(6000);
    expect(bubble.shownCalls.length).toBe(1); // maxPerSession=1 — rule-2도 뜨지 않는다
  });

  it('사용자가 메시지를 보낸 뒤(noteUserSend) 조용한 시간 동안은 표시되지 않는다', () => {
    history.pushState(null, '', '/order/1');
    const { deps, bubble } = makeDeps({ payload: makePayload([makeRule({ trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 1 } })]) });
    const controller = createProactiveController(deps);
    controller.noteUserSend(Date.now());
    controller.start();
    vi.advanceTimersByTime(59_000); // quietAfterUserMessageSec=60초 안
    expect(bubble.visible).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(bubble.visible).toBe(true);
  });

  it('런처가 숨겨져 있으면(getLauncherVisible=false) 표시되지 않고 더 진행하지 않는다', () => {
    history.pushState(null, '', '/order/1');
    const { deps, bubble } = makeDeps({ getLauncherVisible: () => false });
    createProactiveController(deps).start();
    vi.advanceTimersByTime(10000);
    expect(bubble.visible).toBe(false);
  });

  it('대화 패널이 열려 있으면(getPanelOpen=true) 표시를 미루고, 닫히면 표시한다', () => {
    history.pushState(null, '', '/order/1');
    let panelOpen = true;
    const { deps, bubble } = makeDeps({ getPanelOpen: () => panelOpen });
    createProactiveController(deps).start();
    vi.advanceTimersByTime(6000);
    expect(bubble.visible).toBe(false);
    panelOpen = false;
    vi.advanceTimersByTime(1000);
    expect(bubble.visible).toBe(true);
  });

  it('이미 끄기 상태(optedOut)로 시작하면 아예 타이머를 시작하지 않는다', () => {
    window.sessionStorage.setItem('cb.pa.order-bot', JSON.stringify({ v: 1, shownCount: 0, closedRuleIds: [], optedOut: true }));
    history.pushState(null, '', '/order/1');
    const { deps, bubble } = makeDeps();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    createProactiveController(deps).start();
    vi.advanceTimersByTime(10000);
    expect(bubble.visible).toBe(false);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it('stop() 이후에는 tick이 더 이상 실행되지 않는다', () => {
    history.pushState(null, '', '/order/1');
    const { deps, bubble } = makeDeps();
    const controller = createProactiveController(deps);
    controller.start();
    controller.stop();
    vi.advanceTimersByTime(10000);
    expect(bubble.visible).toBe(false);
  });

  it('stop() 호출 시 등록된 리스너(visibilitychange · 모바일의 focusin/focusout)가 실제로 해제된다', () => {
    history.pushState(null, '', '/order/1');
    const rule = makeRule({ devices: ['MOBILE'] });
    const { deps } = makeDeps({ device: 'MOBILE', payload: makePayload([rule]) });
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const controller = createProactiveController(deps);
    controller.start(); // MOBILE이므로 focusin/focusout까지 등록된다(§6.2 · FR-PA3-9)
    controller.stop();
    const removedEvents = removeSpy.mock.calls.map((call) => call[0]);
    expect(removedEvents).toContain('visibilitychange');
    expect(removedEvents).toContain('focusin');
    expect(removedEvents).toContain('focusout');
    removeSpy.mockRestore();
  });

  describe('FR-PA3-9·K-10 — 모바일 가상 키보드(호스트 입력 포커스) 표시 미루기', () => {
    it('모바일 대상 규칙에서 호스트 입력이 포커스 중이면 표시를 미루고, 포커스가 빠지면 다음 틱에 다시 평가되어 표시한다', () => {
      history.pushState(null, '', '/order/1');
      const rule = makeRule({ devices: ['MOBILE'] });
      const { deps, bubble } = makeDeps({ device: 'MOBILE', payload: makePayload([rule]) });
      createProactiveController(deps).start();

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      vi.advanceTimersByTime(6000); // dwellSec=5 충족해도 호스트 입력 포커스 중이라 표시 안 함(HOST_INPUT_FOCUSED)
      expect(bubble.visible).toBe(false);

      input.blur();
      vi.advanceTimersByTime(1000); // 다음 틱에서 재평가(final:false — R-6) → 표시
      expect(bubble.visible).toBe(true);

      document.body.removeChild(input);
    });

    it('contenteditable 요소가 포커스 중이어도 표시를 미룬다', () => {
      history.pushState(null, '', '/order/1');
      const rule = makeRule({ devices: ['MOBILE'] });
      const { deps, bubble } = makeDeps({ device: 'MOBILE', payload: makePayload([rule]) });
      createProactiveController(deps).start();

      const editable = document.createElement('div');
      editable.setAttribute('contenteditable', 'true'); // jsdom은 .contentEditable 프로퍼티/isContentEditable을 구현하지 않아 속성으로 직접 설정
      editable.tabIndex = 0; // jsdom은 contenteditable만으로는 포커스 가능 처리를 하지 않는다 — 명시적으로 포커스 가능하게 함
      document.body.appendChild(editable);
      editable.focus();

      vi.advanceTimersByTime(6000);
      expect(bubble.visible).toBe(false);

      document.body.removeChild(editable);
    });

    it('데스크톱 대상 규칙에서는 호스트 focusin/focusout 리스너를 등록하지 않는다(계산 비용 0)', () => {
      history.pushState(null, '', '/order/1');
      const { deps } = makeDeps({ device: 'DESKTOP' });
      const addSpy = vi.spyOn(document, 'addEventListener');
      createProactiveController(deps).start();
      const eventNames = addSpy.mock.calls.map((call) => call[0]);
      expect(eventNames).not.toContain('focusin');
      expect(eventNames).not.toContain('focusout');
      addSpy.mockRestore();
    });

    it('되돌림 검증 — 데스크톱에서 호스트 입력 포커스는 표시를 막지 않는다(모바일에서만 작동)', () => {
      history.pushState(null, '', '/order/1');
      const { deps, bubble } = makeDeps({ device: 'DESKTOP' });
      createProactiveController(deps).start();

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      vi.advanceTimersByTime(5000);
      expect(bubble.visible).toBe(true); // 데스크톱은 HOST_INPUT_FOCUSED 영향을 받지 않는다

      document.body.removeChild(input);
    });
  });
});
