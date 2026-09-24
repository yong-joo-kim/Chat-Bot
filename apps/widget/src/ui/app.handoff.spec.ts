// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import type { HandoffPollResponse, PublicChatbotConfig, PublicMessageResponse } from '@chat-bot/shared-types';
import { mountWidgetRoot } from './shadow-root';
import { createWidgetApp } from './app';
import { loadHandoffToken } from '../core/handoff-storage';
import { loadConversationState } from '../core/session';
import { MESSAGES } from '../constants/messages';

/**
 * 하이브리드 CS(No.24) 위젯 상담 모드 통합 시험(ADR-0036 §14). `app.pending.spec.ts`와 같은 방식으로
 * 실제 타이머를 쓰되, 서버가 지정하는 `pollAfterMs`를 아주 작게 줘서(수 ms) 시험을 빠르게 만든다.
 */

const SLUG = 'order-bot';
const API_BASE = 'https://api.example.test/api/v1';

function makeConfig(): PublicChatbotConfig {
  return {
    slug: SLUG,
    name: '주문 상담봇',
    skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' },
    greetingMessage: undefined,
    quickReplies: [],
    launcherPosition: 'RIGHT',
    showLauncher: true,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function baseMessageResponse(overrides: Partial<PublicMessageResponse> = {}): PublicMessageResponse {
  return {
    messageId: '11111111-1111-4111-8111-111111111111',
    outputs: [],
    state: { version: 1, contextSession: null } as never,
    stateReset: false,
    ...overrides,
  } as PublicMessageResponse;
}

interface SetupOptions {
  config?: PublicChatbotConfig;
  /** `/messages` POST 응답 목록(순서대로 소비, 마지막 값은 반복). */
  messageResponses?: PublicMessageResponse[];
  /** `/handoff` GET 응답 목록(순서대로 소비, 마지막 값은 반복). `{ httpStatus }`이면 오류 상태코드로 응답한다. */
  handoffResponses?: Array<HandoffPollResponse | { httpStatus: number }>;
}

function setupFetch(opts: SetupOptions): { fetchMock: ReturnType<typeof vi.fn>; handoffCallCount: () => number; messageCallCount: () => number } {
  let messageCallCount = 0;
  let handoffCallCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/config')) return jsonResponse(opts.config ?? makeConfig());
    if (url.includes('/messages') && init?.method === 'POST') {
      const list = opts.messageResponses ?? [baseMessageResponse()];
      const idx = Math.min(messageCallCount, list.length - 1);
      messageCallCount += 1;
      return jsonResponse(list[idx]);
    }
    if (url.includes('/handoff?')) {
      const list = opts.handoffResponses ?? [];
      const idx = Math.min(handoffCallCount, Math.max(list.length - 1, 0));
      const item = list[idx];
      handoffCallCount += 1;
      if (item && 'httpStatus' in item) return jsonResponse({}, item.httpStatus);
      return jsonResponse(item ?? { status: 'NONE', messages: [], cursor: 0, pollAfterMs: null });
    }
    throw new Error(`예상치 못한 fetch 호출: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, handoffCallCount: () => handoffCallCount, messageCallCount: () => messageCallCount };
}

function mount(): { shadow: ShadowRoot } {
  const root = mountWidgetRoot();
  createWidgetApp(root, { slug: SLUG, apiBase: API_BASE, mode: 'desktop', autoOpen: false });
  return { shadow: root.container as ShadowRoot };
}

async function openAndWaitReady(shadow: ShadowRoot): Promise<void> {
  shadow.querySelector<HTMLButtonElement>('#cb-launcher')!.click();
  await vi.waitFor(() => expect(shadow.querySelector<HTMLElement>('#cb-panel')!.hidden).toBe(false));
}

async function sendQuestion(shadow: ShadowRoot, text = '상담원 연결해줘'): Promise<void> {
  const input = shadow.querySelector<HTMLTextAreaElement>('#cb-input')!;
  const form = shadow.querySelector<HTMLFormElement>('#cb-composer')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe('위젯 상담 모드(No.24, ADR-0036 §14)', () => {
  it('handoff 필드가 없는 응답에서는 상담 폴링을 전혀 시작하지 않는다(바이트 동일 원칙)', async () => {
    const { fetchMock } = setupFetch({
      messageResponses: [baseMessageResponse({ outputs: [{ type: 'TEXT', payload: { text: '평소와 같은 응답입니다.' } }] })],
    });
    const { shadow } = mount();
    await openAndWaitReady(shadow);
    await sendQuestion(shadow, '안녕하세요');

    await vi.waitFor(() => expect(shadow.querySelector('#cb-messages')?.textContent).toContain('평소와 같은 응답입니다.'));
    await new Promise((r) => setTimeout(r, 60));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/handoff?'))).toBe(false);
  });

  it(
    'CONNECTED 전환 → 상담원 말풍선(aria-live 로그 안) 렌더 → ENDED에서 폴링이 멈추고 이후 재요청이 없다(타이머 정리)',
    async () => {
      const { handoffCallCount } = setupFetch({
        messageResponses: [
          baseMessageResponse({ outputs: [], handoff: { status: 'CONNECTED', token: 'tok-connect-1', pollAfterMs: 5 } }),
        ],
        handoffResponses: [
          {
            status: 'CONNECTED',
            token: undefined,
            messages: [{ seq: 1, sender: 'AGENT', text: '안녕하세요, 상담원입니다.', sentAt: new Date().toISOString() }],
            cursor: 1,
            pollAfterMs: 5,
          },
          {
            status: 'ENDED',
            messages: [{ seq: 2, sender: 'SYSTEM', text: '상담이 종료되었어요. 이제 챗봇이 도와드릴게요.', sentAt: new Date().toISOString() }],
            cursor: 2,
            pollAfterMs: null,
          },
        ],
      });
      const { shadow } = mount();
      await openAndWaitReady(shadow);
      await sendQuestion(shadow, '상담원 연결해줘');

      // 사용자 발화는 outputs:[]인 상담 구간 응답이므로 새 봇 말풍선을 만들지 않는다.
      await vi.waitFor(() => expect(shadow.querySelectorAll('.cb-msg-user')).toHaveLength(1));

      await vi.waitFor(() => expect(shadow.querySelector('.cb-msg-agent')).not.toBeNull());
      const agentBubble = shadow.querySelector('.cb-msg-agent')!;
      expect(agentBubble.querySelector('.cb-agent-label')?.textContent).toBe('상담원');
      expect(agentBubble.textContent).toContain('안녕하세요, 상담원입니다.');
      // 상담원 말풍선은 기존 role="log" aria-live="polite" 로그 컨테이너 안에 있다(NFR-CSA5 — 새 aria-* 없음).
      const log = shadow.querySelector('#cb-messages')!;
      expect(log.getAttribute('role')).toBe('log');
      expect(log.getAttribute('aria-live')).toBe('polite');
      expect(log.contains(agentBubble)).toBe(true);

      await vi.waitFor(() => expect(shadow.querySelector('#cb-messages')?.textContent).toContain('상담이 종료되었어요'));
      await vi.waitFor(() => expect(shadow.querySelector('#cb-status')?.textContent).toBe(MESSAGES.handoffEndAnnounce));

      const countAtEnd = handoffCallCount();
      await new Promise((r) => setTimeout(r, 150)); // 정상 간격(5ms)이면 이 사이 수십 회 더 불렸을 시간
      expect(handoffCallCount()).toBe(countAtEnd); // 타이머가 정리되어 더 이상 폴링하지 않는다

      // 토큰은 정리되고(§6.3), 봉투(state)에는 애초에 섞이지 않는다.
      expect(loadHandoffToken(SLUG)).toBeUndefined();
      const envelope = loadConversationState(SLUG);
      expect(JSON.stringify(envelope)).not.toContain('tok-connect-1');
    },
    8000,
  );

  it(
    '관찰 창(watch, trigger=NOW) — 미응답 턴 뒤 화면 변화 없이 백그라운드 폴링만 하다가 연결되면 안내한다',
    async () => {
      const { handoffCallCount } = setupFetch({
        messageResponses: [
          baseMessageResponse({
            outputs: [{ type: 'TEXT', payload: { text: '죄송해요, 잘 이해하지 못했어요.' } }],
            handoff: { status: 'NONE', watch: { windowMs: 60_000, pollAfterMs: 5, trigger: 'NOW' } },
          }),
        ],
        handoffResponses: [
          { status: 'NONE', messages: [], cursor: 0, pollAfterMs: 5 },
          {
            status: 'CONNECTED',
            token: 'tok-watch-1',
            messages: [{ seq: 1, sender: 'SYSTEM', text: '상담원이 연결되었어요. 잠시만 기다려 주세요.', sentAt: new Date().toISOString() }],
            cursor: 1,
            pollAfterMs: 5,
          },
        ],
      });
      const { shadow } = mount();
      await openAndWaitReady(shadow);
      await sendQuestion(shadow, '아무 말이나');

      await vi.waitFor(() => expect(shadow.querySelector('#cb-messages')?.textContent).toContain('죄송해요'));
      // 관찰 창 자체는 화면에 아무 것도 표시하지 않는다(WATCHING, FR-CS9-2) — 상담원 말풍선이 없다.
      expect(shadow.querySelector('.cb-msg-agent')).toBeNull();
      await vi.waitFor(() => expect(handoffCallCount()).toBeGreaterThanOrEqual(1));

      await vi.waitFor(() => expect(shadow.querySelector('#cb-messages')?.textContent).toContain('상담원이 연결되었어요'));
      await vi.waitFor(() => expect(loadHandoffToken(SLUG)?.token).toBe('tok-watch-1'));
    },
    8000,
  );

  it('상담 폴링이 429를 받으면 곧바로 재시도하지 않는다(§7.3 백오프)', async () => {
    const { handoffCallCount } = setupFetch({
      messageResponses: [
        baseMessageResponse({ outputs: [], handoff: { status: 'CONNECTED', token: 'tok-rl-1', pollAfterMs: 5 } }),
      ],
      handoffResponses: [{ httpStatus: 429 }],
    });
    const { shadow } = mount();
    await openAndWaitReady(shadow);
    await sendQuestion(shadow, '상담원');

    await vi.waitFor(() => expect(handoffCallCount()).toBeGreaterThanOrEqual(1));
    const afterFirst = handoffCallCount();
    // 정상 간격(5ms)이라면 이 사이 수십 회 재시도했을 시간이지만, 429 백오프(10초) 중이라 늘지 않는다.
    await new Promise((r) => setTimeout(r, 200));
    expect(handoffCallCount()).toBe(afterFirst);
  });

  it('상담 중 전송에는 x-cb-handoff-token 헤더가 실린다(Content-Type 유지)', async () => {
    const { fetchMock } = setupFetch({
      messageResponses: [
        baseMessageResponse({ outputs: [], handoff: { status: 'CONNECTED', token: 'tok-header-1', pollAfterMs: 5 } }),
        baseMessageResponse({ outputs: [], handoff: { status: 'CONNECTED', pollAfterMs: 5 } }),
      ],
      handoffResponses: [{ status: 'CONNECTED', messages: [], cursor: 0, pollAfterMs: 5 }],
    });
    const { shadow } = mount();
    await openAndWaitReady(shadow);
    await sendQuestion(shadow, '첫 메시지');
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u, i]) => String(u).includes('/messages') && (i as RequestInit)?.method === 'POST')).toHaveLength(1),
    );
    // 입력창이 다시 활성화될 때까지 기다린다 — 그 전에 두 번째 전송을 시도하면 조용히 무시된다(composer.ts).
    await vi.waitFor(() => expect(shadow.querySelector<HTMLTextAreaElement>('#cb-input')!.getAttribute('aria-disabled')).toBe('false'));

    await sendQuestion(shadow, '두번째 메시지(연결된 상태)');
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([u, i]) => String(u).includes('/messages') && (i as RequestInit)?.method === 'POST')).toHaveLength(2),
    );

    const secondCall = fetchMock.mock.calls.filter(([u, i]) => String(u).includes('/messages') && (i as RequestInit)?.method === 'POST')[1];
    const headers = secondCall[1]?.headers as Record<string, string>;
    expect(headers['x-cb-handoff-token']).toBe('tok-header-1');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
