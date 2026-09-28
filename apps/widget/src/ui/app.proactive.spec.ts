// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';

/**
 * [신규 No.35] 선제 안내(Proactive Messaging) 위젯 통합 시험 — `app.handoff.spec.ts`와 같은 방식으로
 * 실제 fetch를 목으로 바꾸고 가짜 타이머로 체류 시간을 흘려보낸다.
 */

const SLUG = 'order-bot';
const API_BASE = 'https://api.example.test/api/v1';

function makeConfig(overrides: Partial<PublicChatbotConfig> = {}): PublicChatbotConfig {
  return {
    slug: SLUG,
    name: '주문 상담봇',
    skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
    greetingMessage: undefined,
    quickReplies: [],
    launcherPosition: 'RIGHT',
    showLauncher: true,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function baseMessageResponse(overrides: Partial<PublicMessageResponse> = {}): PublicMessageResponse {
  return {
    messageId: '11111111-1111-4111-8111-111111111111',
    outputs: [{ type: 'TEXT', payload: { text: '배송지를 알려 주세요' } }],
    state: { version: 1, contextSession: null } as never,
    stateReset: false,
    ...overrides,
  } as PublicMessageResponse;
}

interface FetchLog {
  url: string;
  init?: RequestInit;
}

function setupFetch(opts: { config?: PublicChatbotConfig; proactiveConfig?: unknown; messageResponse?: PublicMessageResponse }): {
  fetchMock: ReturnType<typeof vi.fn>;
  log: FetchLog[];
} {
  const log: FetchLog[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    log.push({ url, init });
    if (url.includes('/config?proactive=1')) {
      return jsonResponse(opts.proactiveConfig ?? { ...makeConfig(), proactive: undefined });
    }
    if (url.endsWith('/config')) return jsonResponse(opts.config ?? makeConfig());
    if (url.includes('/proactive-events')) return jsonResponse(undefined, 204);
    if (url.includes('/messages') && init?.method === 'POST') return jsonResponse(opts.messageResponse ?? baseMessageResponse());
    if (url.includes('/handoff?')) return jsonResponse({ status: 'NONE', messages: [], cursor: 0, pollAfterMs: null });
    throw new Error(`예상치 못한 fetch 호출: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, log };
}

function mount(proactive: boolean): { shadow: ShadowRoot } {
  const root = mountWidgetRoot();
  createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false, proactive });
  return { shadow: root.container as ShadowRoot };
}

function proactivePayload(overrides: Record<string, unknown> = {}) {
  return {
    ...makeConfig(),
    proactive: {
      caps: { maxPerSession: 1, minIntervalSec: 30, quietAfterUserMessageSec: 300 },
      rules: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          trigger: { kind: 'PAGE_DWELL', pathInclude: ['/order/**'], pathExclude: [], dwellSec: 5 },
          text: '주문·배송 조회를 도와드릴까요?',
          buttons: [{ label: '배송 조회하기', action: 'NODE', value: '33333333-3333-4333-8333-333333333333' }],
          devices: ['DESKTOP'],
        },
      ],
      ...overrides,
    },
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('위젯 선제 안내(No.35) — 삽입 속성 게이트', () => {
  it('data-proactive 속성이 없으면(proactive:false) 요청을 전혀 보내지 않는다(FR-0-246)', async () => {
    const { fetchMock } = setupFetch({});
    mount(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proactive:true면 부팅 시 GET .../config?proactive=1을 1회 보낸다(no-referrer)', async () => {
    history.pushState(null, '', '/home');
    const { fetchMock, log } = setupFetch({ proactiveConfig: { ...makeConfig(), proactive: undefined } });
    mount(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log[0].url).toContain('/config?proactive=1');
    expect(log[0].init?.referrerPolicy).toBe('no-referrer');
  });

  it('규칙이 0개(proactive 키 없음)면 그 이후로 추가 요청·타이머가 없다', async () => {
    history.pushState(null, '', '/order/1');
    const { fetchMock } = setupFetch({ proactiveConfig: { ...makeConfig(), proactive: undefined } });
    mount(true);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterBoot = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(callsAfterBoot);
  });
});

describe('위젯 선제 안내(No.35) — 표시·클릭 흐름', () => {
  it('규칙 경로에서 5초 머물면 말풍선이 뜨고 SHOWN 사건을 보낸다', async () => {
    history.pushState(null, '', '/order/123');
    const { fetchMock, log } = setupFetch({ proactiveConfig: proactivePayload() });
    const { shadow } = mount(true);
    await vi.advanceTimersByTimeAsync(0); // config 로드 완료

    await vi.advanceTimersByTimeAsync(5000);

    const bubble = shadow.querySelector<HTMLElement>('#cb-pa-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble!.hidden).toBe(false);

    const shownEvent = log.find((l) => l.url.includes('/proactive-events'));
    expect(shownEvent).toBeDefined();
    const body = JSON.parse(String(shownEvent!.init?.body));
    expect(body).toEqual({ sessionId: expect.any(String), ruleId: '22222222-2222-4222-8222-222222222222', kind: 'SHOWN' });
    expect(shownEvent!.init?.referrerPolicy).toBe('no-referrer');
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/proactive-events'))).toBe(true);
  });

  it('NODE 버튼을 클릭하면 패널이 열리고 기존 handleButtonAction으로 NODE 버튼 턴을 보낸다(엔진 변경 0)', async () => {
    history.pushState(null, '', '/order/123');
    const { log } = setupFetch({ proactiveConfig: proactivePayload() });
    const { shadow } = mount(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    const nodeButton = Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent === '배송 조회하기')!;
    nodeButton.click();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    const panel = shadow.querySelector<HTMLElement>('#cb-panel')!;
    expect(panel.hidden).toBe(false);

    const messagesCall = log.find((l) => l.url.includes('/messages') && l.init?.method === 'POST');
    expect(messagesCall).toBeDefined();
    const body = JSON.parse(String(messagesCall!.init?.body));
    expect(body.buttonAction).toEqual({ kind: 'NODE', nodeId: '33333333-3333-4333-8333-333333333333', label: '배송 조회하기' });

    const clickedEvent = log
      .filter((l) => l.url.includes('/proactive-events'))
      .map((l) => JSON.parse(String(l.init?.body)) as { kind: string })
      .find((b) => b.kind === 'CLICKED');
    expect(clickedEvent).toBeDefined();
  });

  it('안내 닫기를 누르면 sessionStorage에만 기록되고(localStorage 0) 다시 뜨지 않는다', async () => {
    history.pushState(null, '', '/order/1');
    setupFetch({ proactiveConfig: proactivePayload() });
    const { shadow } = mount(true);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    const dismissBtn = Array.from(shadow.querySelectorAll('button')).find((b) => b.textContent === '안내 닫기')!;
    dismissBtn.click();

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.getItem('cb.pa.order-bot')).not.toBeNull();

    history.pushState(null, '', '/order/2');
    await vi.advanceTimersByTimeAsync(6000);
    const bubble = shadow.querySelector<HTMLElement>('#cb-pa-bubble')!;
    expect(bubble.hidden).toBe(true);
  });
});
